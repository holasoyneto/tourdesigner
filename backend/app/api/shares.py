"""Public traveler share links (/link/<key>) with role-scrubbed resolution."""

from __future__ import annotations

import re
import secrets
from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from app.api.common import (
    created,
    err,
    get_app_settings,
    get_repo,
    get_tenant_id,
    ok,
    record_audit,
    require_member,
)
from app.domain.auth import AUTH_LIMITER, is_expired, requester_ip
from app.domain.models import ShareLink, now_iso
from app.domain.roles import can_access_gig, scrub_gig_header, scrub_item
from app.repo.tenants import parse_scoped_token, scope_token

router = APIRouter(prefix="/api", tags=["shares"])
_SHARE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{8,80}$")


@router.get("/shares")
def list_shares(
    request: Request,
    gig_id: str | None = None,
    person_id: str | None = None,
) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    links = repo.list_share_links(gig_id=gig_id, person_id=person_id)
    if member.artist_ids:
        visible_gigs = {g.id for g in repo.list_gigs() if can_access_gig(member, g)}
        links = [s for s in links if not s.gig_id or s.gig_id in visible_gigs]
    return ok(shares=[s.model_dump(mode="json") for s in links])


@router.post("/shares")
def create_share(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    scope = str(body.get("scope") or "gig_master")
    if scope not in {"person", "gig_master", "gig_crew"}:
        return err("invalid_scope", status=400)
    if body.get("gig_id") and member.artist_ids:
        gig = get_repo(request).get_gig(str(body.get("gig_id")))
        if not gig or not can_access_gig(member, gig):
            return err("gig_not_found", status=404)
    custom_key = str(body.get("key") or "").strip()
    if custom_key and not _SHARE_KEY_RE.fullmatch(custom_key):
        return err("invalid_share_key", status=400)
    raw_key = custom_key or secrets.token_urlsafe(16)
    link = ShareLink(
        key=scope_token(get_tenant_id(request), raw_key),
        scope=scope,  # type: ignore[arg-type]
        gig_id=body.get("gig_id"),
        person_id=body.get("person_id"),
        label=str(body.get("label") or "").strip()[:120],
        enabled=bool(body.get("enabled", True)),
        can_edit=bool(body.get("can_edit", False)),
    )
    saved = get_repo(request).upsert_share_link(link)
    record_audit(request, "create_share", saved.key, f"Created {scope} share link")
    return created(share=saved.model_dump(mode="json"))


@router.patch("/shares/{key}")
def toggle_share(key: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    link = repo.get_share_link(key)
    if not link:
        return err("share_not_found", status=404)
    if "enabled" in body:
        link.enabled = bool(body["enabled"])
    if "label" in body:
        link.label = str(body["label"]).strip()[:120]
    saved = repo.upsert_share_link(link)
    return ok(share=saved.model_dump(mode="json"))


@router.delete("/shares/{key}")
def delete_share(key: str, request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    if not get_repo(request).delete_share_link(key):
        return err("share_not_found", status=404)
    return ok(key=key)


@router.get("/share/resolve/{key}")
@router.get("/share/person/{key}")
def resolve_share(key: str, request: Request) -> JSONResponse:
    """Resolve a public /link/<key> traveler card with fail-closed scrubbing."""
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("share_resolve", ip):
        return err("rate_limited", status=429)

    settings = get_app_settings(request)
    if settings.tenancy_mode == "multi":
        tenant_id, _ = parse_scoped_token(key)
        repo = request.app.state.tenant_manager.get_repo(tenant_id)
        if repo is None:
            AUTH_LIMITER.record("share_resolve", ip)
            return err("share_not_found", status=404)
    else:
        repo = get_repo(request)
    link = repo.get_share_link(key)
    if not link or not link.enabled or is_expired(link.expires_at):
        AUTH_LIMITER.record("share_resolve", ip)
        return err("share_not_found", status=404)

    link.last_seen = now_iso()
    repo.upsert_share_link(link)

    origin = (settings.public_origin or "").rstrip("/") or str(request.base_url).rstrip("/")
    launch_url = f"{origin}{settings.normalized_base_path}/"
    branding = {
        "show_footer": bool(settings.tenancy_mode == "multi" or settings.share_footer_branding),
        "launch_url": launch_url,
    }

    if link.scope in {"gig_master", "gig_crew"} and link.gig_id:
        gig = repo.get_gig(link.gig_id)
        if not gig:
            return err("gig_not_found", status=404)
        header = scrub_gig_header(gig, None)
        t_pid = link.person_id if link.scope == "gig_crew" else None
        header["items"] = [
            d for it in repo.list_items(gig.id) if (d := scrub_item(it, None, travel_person_id=t_pid)) is not None
        ]
        person = repo.get_person(link.person_id) if link.person_id else None
        return ok(
            scope=link.scope,
            label=link.label,
            person={"id": person.id, "name": person.name, "role": person.role} if person else None,
            gigs=[header],
            **branding,
        )

    person = repo.get_person(link.person_id) if link.person_id else None
    gigs_out: list[dict[str, Any]] = []
    for gig in repo.list_gigs():
        if gig.archived:
            continue
        items = repo.list_items(gig.id)
        if link.person_id:
            in_gig = any(link.person_id in it.person_ids for it in items)
            if not in_gig:
                continue
        header = scrub_gig_header(gig, None)
        header["items"] = [
            d for it in items if (d := scrub_item(it, None, travel_person_id=link.person_id)) is not None
        ]
        gigs_out.append(header)
    return ok(
        scope="person",
        label=link.label or (person.name if person else ""),
        person={"id": person.id, "name": person.name, "role": person.role} if person else None,
        gigs=gigs_out,
        **branding,
    )
