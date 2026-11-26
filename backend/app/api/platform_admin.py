"""Super-admin platform dashboard API: usage metering, analytics, and user support.

Access is strictly limited to configured `PLATFORM_ADMIN_EMAILS` (or the workspace owner
in single-tenant self-hosted mode when no admin email list is set). Never exposes private
tenant content (fees, deals, notes, passports, or file bytes) — only aggregate telemetry,
quotas, and support controls.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from app.api.common import err, get_app_settings, get_repo, ok, require_member
from app.config import Settings
from app.domain.models import User, now_iso
from app.domain.roles import is_owner
from app.repo.tenants import get_hosted_usage, is_valid_tenant_id, reset_hosted_ai_today

router = APIRouter(prefix="/api/platform-admin", tags=["platform-admin"])


def is_platform_admin(user: User | None, settings: Settings) -> bool:
    if user is None:
        return False
    admin_emails = settings.platform_admin_email_set
    if admin_emails:
        return (user.email or "").strip().lower() in admin_emails
    return settings.tenancy_mode == "single" and is_owner(user)


def _require_platform_admin(request: Request) -> User | JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    settings = get_app_settings(request)
    if not is_platform_admin(member, settings):
        return err("forbidden", status=403)
    return member


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except Exception:
        return None


def _tenant_metrics(repo, meta: dict[str, Any], settings: Settings) -> dict[str, Any]:
    usage = get_hosted_usage(repo, settings)
    users = repo.list_users()
    people_count = len(repo.list_people())
    files_count = len(repo.list_files())
    active_users = [u for u in users if not u.revoked]
    mcp_active = any(bool(u.mcp_key_hash) for u in active_users)
    overrides = repo.get_setting("hosted_overrides", {})
    if not isinstance(overrides, dict):
        overrides = {}

    return {
        "tenant_id": str(meta.get("tenant_id") or "single"),
        "name": str(meta.get("name") or "Workspace"),
        "email": str(meta.get("email") or ""),
        "auth_provider": "google" if meta.get("google_sub") else "email",
        "plan": usage["plan"],
        "created_at": str(meta.get("created_at") or ""),
        "last_login_at": str(meta.get("last_login_at") or ""),
        "suspended": bool(meta.get("suspended", False)),
        "admin_notes": str(meta.get("admin_notes") or ""),
        "usage": {
            "gigs_count": usage["gigs_count"],
            "max_gigs": usage["max_gigs"],
            "people_count": people_count,
            "files_count": files_count,
            "storage_mb": usage["storage_mb"],
            "max_files_mb": usage["max_files_mb"],
            "ai_used_today": usage["ai_used_today"],
            "ai_daily_limit": usage["ai_daily_limit"],
            "ai_total": usage["ai_total"],
            "team_count": len(active_users),
            "mcp_active": mcp_active,
        },
        "overrides": {
            "plan": overrides.get("plan"),
            "ai_daily_limit": overrides.get("ai_daily_limit"),
            "max_gigs": overrides.get("max_gigs"),
            "max_files_mb": overrides.get("max_files_mb"),
        },
    }


@router.get("/overview")
def platform_admin_overview(request: Request) -> JSONResponse:
    admin = _require_platform_admin(request)
    if isinstance(admin, JSONResponse):
        return admin

    settings = get_app_settings(request)
    root_repo = getattr(request.app.state, "repo", None) or get_repo(request)
    tm = getattr(request.app.state, "tenant_manager", None)

    now = datetime.now(timezone.utc)
    cutoff_24h = now - timedelta(hours=24)
    cutoff_7d = now - timedelta(days=7)

    tenants_out: list[dict[str, Any]] = []
    if settings.tenancy_mode == "multi" and tm is not None:
        for meta in tm.list_tenant_metas():
            tid = str(meta.get("tenant_id") or "")
            t_repo = tm.get_repo(tid)
            if t_repo is None:
                continue
            tenants_out.append(_tenant_metrics(t_repo, meta, settings))
    else:
        meta = {
            "tenant_id": "single",
            "name": settings.owner_name,
            "email": settings.owner_email,
            "created_at": "",
            "last_login_at": now_iso(),
            "suspended": False,
            "admin_notes": str(root_repo.get_setting("single_admin_notes", "") or ""),
        }
        tenants_out.append(_tenant_metrics(root_repo, meta, settings))

    active_24h = 0
    active_7d = 0
    suspended_count = 0
    total_gigs = 0
    total_people = 0
    total_files = 0
    total_storage_mb = 0.0
    ai_used_today = 0
    ai_total = 0
    mcp_enabled_tenants = 0

    for t in tenants_out:
        last_dt = _parse_iso(t["last_login_at"])
        if last_dt:
            if last_dt >= cutoff_24h:
                active_24h += 1
            if last_dt >= cutoff_7d:
                active_7d += 1
        if t["suspended"]:
            suspended_count += 1
        u = t["usage"]
        total_gigs += u["gigs_count"]
        total_people += u["people_count"]
        total_files += u["files_count"]
        total_storage_mb += float(u["storage_mb"])
        ai_used_today += u["ai_used_today"]
        ai_total += u["ai_total"]
        if u["mcp_active"]:
            mcp_enabled_tenants += 1

    raw_leads = root_repo.get_setting("public_interest_leads", [])
    leads = list(reversed(raw_leads[-50:])) if isinstance(raw_leads, list) else []

    return ok(
        summary={
            "tenancy_mode": settings.tenancy_mode,
            "total_tenants": len(tenants_out),
            "active_24h": active_24h,
            "active_7d": active_7d,
            "suspended_count": suspended_count,
            "total_gigs": total_gigs,
            "total_people": total_people,
            "total_files": total_files,
            "total_storage_mb": round(total_storage_mb, 2),
            "ai_used_today": ai_used_today,
            "ai_total": ai_total,
            "mcp_enabled_tenants": mcp_enabled_tenants,
            "leads_count": len(leads),
            "defaults": {
                "plan": settings.hosted_plan_name,
                "ai_daily_limit": settings.hosted_ai_daily_limit,
                "max_gigs": settings.hosted_max_gigs,
                "max_files_mb": settings.hosted_max_files_mb,
            },
        },
        tenants=tenants_out,
        leads=leads,
    )


@router.patch("/tenants/{tenant_id}")
def platform_admin_update_tenant(
    tenant_id: str,
    request: Request,
    body: dict[str, Any] = Body(...),
) -> JSONResponse:
    admin = _require_platform_admin(request)
    if isinstance(admin, JSONResponse):
        return admin

    settings = get_app_settings(request)
    root_repo = getattr(request.app.state, "repo", None) or get_repo(request)
    tm = getattr(request.app.state, "tenant_manager", None)

    if settings.tenancy_mode == "multi":
        if not is_valid_tenant_id(tenant_id) or tm is None:
            return err("tenant_not_found", status=404)
        meta = root_repo.get_setting(f"tenant_meta:{tenant_id}")
        t_repo = tm.get_repo(tenant_id)
        if not isinstance(meta, dict) or t_repo is None:
            return err("tenant_not_found", status=404)
    else:
        if tenant_id != "single":
            return err("tenant_not_found", status=404)
        t_repo = root_repo
        meta = {
            "tenant_id": "single",
            "name": settings.owner_name,
            "email": settings.owner_email,
            "last_login_at": now_iso(),
        }

    overrides = t_repo.get_setting("hosted_overrides", {})
    if not isinstance(overrides, dict):
        overrides = {}

    if "plan" in body:
        plan_val = str(body.get("plan") or "").strip()[:40]
        overrides["plan"] = plan_val or None
        if settings.tenancy_mode == "multi":
            meta["plan"] = plan_val or settings.hosted_plan_name

    for int_field in ("ai_daily_limit", "max_gigs", "max_files_mb"):
        if int_field in body:
            raw_v = body.get(int_field)
            if raw_v is None or raw_v == "":
                overrides[int_field] = None
            else:
                try:
                    overrides[int_field] = max(0, int(raw_v))
                except (TypeError, ValueError):
                    return err(f"invalid_{int_field}", status=400)

    if "suspended" in body:
        meta["suspended"] = bool(body.get("suspended"))

    if "admin_notes" in body:
        notes_val = str(body.get("admin_notes") or "").strip()[:1000]
        meta["admin_notes"] = notes_val
        if settings.tenancy_mode != "multi":
            root_repo.set_setting("single_admin_notes", notes_val)

    t_repo.set_setting("hosted_overrides", overrides)
    if settings.tenancy_mode == "multi":
        meta["updated_at"] = now_iso()
        root_repo.set_setting(f"tenant_meta:{tenant_id}", meta)

    return ok(tenant=_tenant_metrics(t_repo, meta, settings))


@router.post("/tenants/{tenant_id}/reset-ai")
def platform_admin_reset_ai(tenant_id: str, request: Request) -> JSONResponse:
    admin = _require_platform_admin(request)
    if isinstance(admin, JSONResponse):
        return admin

    settings = get_app_settings(request)
    root_repo = getattr(request.app.state, "repo", None) or get_repo(request)
    tm = getattr(request.app.state, "tenant_manager", None)

    if settings.tenancy_mode == "multi":
        if not is_valid_tenant_id(tenant_id) or tm is None:
            return err("tenant_not_found", status=404)
        meta = root_repo.get_setting(f"tenant_meta:{tenant_id}")
        t_repo = tm.get_repo(tenant_id)
        if not isinstance(meta, dict) or t_repo is None:
            return err("tenant_not_found", status=404)
    else:
        if tenant_id != "single":
            return err("tenant_not_found", status=404)
        t_repo = root_repo
        meta = {
            "tenant_id": "single",
            "name": settings.owner_name,
            "email": settings.owner_email,
            "last_login_at": now_iso(),
        }

    reset_hosted_ai_today(t_repo)
    return ok(tenant=_tenant_metrics(t_repo, meta, settings))
