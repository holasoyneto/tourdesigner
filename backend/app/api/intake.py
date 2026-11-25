"""Unified AI intake API: /api/intake/extract -> /api/intake/apply + dynamic Google AI model config."""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from app.ai.extract import extract_deterministic, extract_logistics
from app.ai.models import (
    check_active_model_health,
    fetch_google_models,
    get_model_deprecation_alert,
    resolve_ai_config,
    save_ai_config,
)
from app.api.common import (
    actor_from_request,
    err,
    get_app_settings,
    get_repo,
    ok,
    record_audit,
    require_member,
    require_owner,
)
from app.domain.auth import constant_time_equals
from app.domain.models import ALL_COLLECTIONS, GigItem, new_id
from app.domain.roles import (
    can_access_gig,
    check_collection_write,
    check_gig_write_fields,
    scrub_gig_header,
)
from app.repo.protocol import NotFoundError
from app.repo.tenants import check_hosted_ai_quota, record_hosted_ai_use

router = APIRouter(prefix="/api", tags=["intake"])


@router.get("/intake/status")
def intake_status(request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    cfg = resolve_ai_config(get_repo(request), settings=get_app_settings(request))
    return ok(**cfg.to_member_status())


@router.get("/admin/ai-settings")
def admin_get_ai_settings(request: Request) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    cfg = resolve_ai_config(repo, settings=get_app_settings(request))
    return ok(settings=cfg.to_public_dict(), alert=get_model_deprecation_alert(repo))


@router.put("/admin/ai-settings")
def admin_update_ai_settings(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    try:
        cfg = save_ai_config(repo, body, settings=get_app_settings(request))
    except PermissionError as exc:
        return err(str(exc), status=403)
    except ValueError as exc:
        return err(str(exc), status=400)
    record_audit(
        request,
        "update_ai_settings",
        "ai_intake",
        f"AI intake set to {cfg.provider} ({cfg.effective_provider}:{cfg.model})",
    )
    return ok(settings=cfg.to_public_dict())


@router.get("/admin/ai-models")
async def admin_list_ai_models(
    request: Request,
    provider: str | None = Query(default=None),
) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    cfg = resolve_ai_config(get_repo(request), settings=get_app_settings(request))
    if cfg.hosted_locked:
        return ok(
            active_model=cfg.model,
            effective_provider=cfg.effective_provider,
            hosted_locked=True,
            models=[
                {
                    "id": cfg.model,
                    "display_name": f"{cfg.model} (Hosted Free Beta)",
                    "description": "Fast, cost-optimized model included with your hosted workspace. Add your own Gemini API key below to unlock all Google models.",
                    "recommended": True,
                    "provider": "hosted",
                }
            ],
            source="hosted_locked",
            provider_queried="hosted",
            fetched_at=cfg.updated_at or "",
            note=None,
        )
    catalog = await fetch_google_models(cfg, provider_override=provider)
    return ok(active_model=cfg.model, effective_provider=cfg.effective_provider, hosted_locked=False, **catalog)


@router.post("/cron/check-ai-model")
async def cron_check_ai_model(request: Request) -> JSONResponse:
    """Weekly/scheduled watchdog: checks whether the configured Google AI model is still active and emails/webhooks if deprecated."""
    settings = get_app_settings(request)
    token = request.headers.get("x-cron-token") or request.query_params.get("token") or ""
    if settings.digest_cron_token and constant_time_equals(token, settings.digest_cron_token):
        pass
    else:
        denied = require_owner(request)
        if isinstance(denied, JSONResponse):
            return denied
    result = await check_active_model_health(get_repo(request), settings)
    return ok(**result)


@router.post("/admin/ai-test")
async def admin_test_ai(request: Request, body: dict[str, Any] = Body(default={})) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    settings = get_app_settings(request)
    cfg = resolve_ai_config(repo, settings=settings)
    sample = str(
        body.get("text")
        or "AF1181 LHR -> CDG 11:25 13:45 PNR TEST99\n18:30 - 19:30 Soundcheck at Rex Club"
    ).strip()
    uses_hosted_ai = (
        settings.tenancy_mode == "multi"
        and cfg.hosted_locked
        and cfg.effective_provider in {"vertex", "gemini"}
    )
    if uses_hosted_ai:
        allowed, used, limit = check_hosted_ai_quota(repo, settings)
        if not allowed:
            return err(f"hosted_ai_daily_limit_reached ({used}/{limit})", status=429)
        max_chars = settings.hosted_ai_max_input_chars
        if max_chars > 0 and len(sample) > max_chars:
            sample = sample[:max_chars]
    t0 = time.perf_counter()
    proposal = await extract_logistics(
        sample,
        gig_context={"city": "Paris", "venue": "Rex Club"},
        repo=repo,
        config_override=cfg,
        max_output_tokens=settings.hosted_ai_max_output_tokens if uses_hosted_ai else None,
        thinking_level=settings.hosted_ai_thinking_level if uses_hosted_ai else None,
    )
    if uses_hosted_ai and proposal.get("provider") in {"vertex", "gemini"}:
        record_hosted_ai_use(repo)
    latency_ms = int((time.perf_counter() - t0) * 1000)
    return ok(
        latency_ms=latency_ms,
        engine=proposal.get("engine"),
        provider=proposal.get("provider"),
        model=proposal.get("model"),
        configured_model=cfg.model,
        items_count=len(proposal.get("items") or []),
        warnings=proposal.get("warnings") or [],
    )


@router.post("/intake/extract")
async def intake_extract(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    text = str(body.get("text") or "").strip()
    if not text:
        return err("text_required", status=400)
    if len(text) > 120_000:
        return err("text_too_large", status=413)
    repo = get_repo(request)
    gig_id = body.get("gig_id")
    ctx: dict[str, Any] = {}
    if gig_id:
        gig = repo.get_gig(str(gig_id))
        if gig and can_access_gig(member, gig):
            ctx = {"date": gig.date, "city": gig.city, "venue": gig.venue, "timezone": gig.timezone}

    settings = get_app_settings(request)
    ai_cfg = resolve_ai_config(repo, settings=settings)
    uses_hosted_ai = (
        settings.tenancy_mode == "multi"
        and ai_cfg.hosted_locked
        and ai_cfg.effective_provider in {"vertex", "gemini"}
    )
    trimmed_note: str | None = None
    ai_text = text
    if uses_hosted_ai:
        allowed, used, limit = check_hosted_ai_quota(repo, settings)
        if not allowed:
            proposal = extract_deterministic(text)
            proposal["warnings"].append(
                f"Daily {settings.hosted_plan_name} AI limit reached ({used}/{limit}) — used offline parser. Add your own Gemini API key in Settings for unlimited AI."
            )
            return ok(proposal=proposal)
        max_chars = settings.hosted_ai_max_input_chars
        if max_chars > 0 and len(ai_text) > max_chars:
            ai_text = ai_text[:max_chars]
            trimmed_note = f"Input trimmed to {max_chars:,} characters for hosted Free Beta AI."
    proposal = await extract_logistics(
        ai_text,
        gig_context=ctx,
        repo=repo,
        config_override=ai_cfg,
        max_output_tokens=settings.hosted_ai_max_output_tokens if uses_hosted_ai else None,
        thinking_level=settings.hosted_ai_thinking_level if uses_hosted_ai else None,
    )
    if trimmed_note:
        proposal.setdefault("warnings", []).append(trimmed_note)
    if uses_hosted_ai and proposal.get("provider") in {"vertex", "gemini"}:
        record_hosted_ai_use(repo)
    return ok(proposal=proposal)


@router.post("/intake/apply")
def intake_apply(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    gig_id = str(body.get("gig_id") or "")
    if not gig_id:
        return err("gig_id_required", status=400)
    repo = get_repo(request)
    existing_gig = repo.get_gig(gig_id)
    if not existing_gig or not can_access_gig(member, existing_gig):
        return err("gig_not_found", status=404)
    actor = actor_from_request(request, channel="intake")
    batch_id = new_id("bat")

    gig_patch = body.get("gig_patch") if isinstance(body.get("gig_patch"), dict) else {}
    if gig_patch:
        denied = check_gig_write_fields(member, gig_patch)
        if denied:
            return err(denied, status=403)
        try:
            updated_gig = repo.update_gig(gig_id, gig_patch, actor=actor)
        except NotFoundError:
            return err("gig_not_found", status=404)
    else:
        updated_gig = repo.get_gig(gig_id)
        if not updated_gig:
            return err("gig_not_found", status=404)

    raw_items = body.get("items") if isinstance(body.get("items"), list) else []
    to_add: list[GigItem] = []
    for raw in raw_items:
        col = str(raw.get("collection") or "")
        if col not in ALL_COLLECTIONS:
            continue
        if check_collection_write(member, col):
            continue
        to_add.append(
            GigItem(
                gig_id=gig_id,
                collection=col,  # type: ignore[arg-type]
                data=raw.get("data") if isinstance(raw.get("data"), dict) else {},
                person_ids=raw.get("person_ids") if isinstance(raw.get("person_ids"), list) else [],
            )
        )
    added = repo.add_items(gig_id, to_add, batch_id=batch_id, actor=actor) if to_add else []
    record_audit(request, "intake_apply", gig_id, f"Applied intake batch ({len(added)} items)", channel="intake")
    return ok(
        batch_id=batch_id,
        gig=scrub_gig_header(updated_gig, member),
        added=[it.model_dump(mode="json") for it in added],
    )
