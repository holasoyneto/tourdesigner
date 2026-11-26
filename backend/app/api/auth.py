"""Auth, sessions, key login (Web & Mobile PWA), and owner admin routes."""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.common import (
    created,
    current_user,
    err,
    get_app_settings,
    get_repo,
    get_tenant_id,
    ok,
    record_audit,
    require_member,
    require_owner,
)
from app.domain.auth import (
    AUTH_LIMITER,
    clear_session_cookie,
    constant_time_equals,
    hash_secret,
    mint_session_cookie,
    requester_ip,
    verify_owner_password,
)
from app.domain.models import AuditEvent, Project, Role, User, now_iso
from app.domain.roles import allowed_project_ids
from app.repo.tenants import get_hosted_usage, parse_scoped_token, scope_token

router = APIRouter(prefix="/api", tags=["auth"])
PROJECTS_SETTING_KEY = "projects"
_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_OAUTH_COOKIE = "td_oauth_state"
_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"


def _public_origin(request: Request) -> str:
    settings = get_app_settings(request)
    if settings.public_origin.strip():
        return settings.public_origin.strip().rstrip("/")
    proto = request.headers.get("x-forwarded-proto") or request.url.scheme or "http"
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or "127.0.0.1"
    return f"{proto}://{host}"


def _oauth_redirect_uri(request: Request) -> str:
    settings = get_app_settings(request)
    return f"{_public_origin(request)}{settings.normalized_base_path}/api/auth/google/callback"


async def _exchange_google_code(
    *,
    code: str,
    code_verifier: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str,
) -> dict[str, Any]:
    """Exchange Google OAuth authorization code (PKCE) and return verified OIDC profile."""
    async with httpx.AsyncClient(timeout=12.0) as client:
        tok_resp = await client.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
        tok_resp.raise_for_status()
        tokens = tok_resp.json()
        access_token = str(tokens.get("access_token") or "")
        if not access_token:
            raise ValueError("missing_access_token")
        info_resp = await client.get(
            _GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        info_resp.raise_for_status()
        return info_resp.json()


def _load_projects(repo) -> list[Project]:
    raw = repo.get_setting(PROJECTS_SETTING_KEY, [])
    if not isinstance(raw, list):
        return []
    out: list[Project] = []
    for entry in raw:
        if isinstance(entry, dict):
            try:
                out.append(Project.model_validate(entry))
            except Exception:
                continue
    return out


def _save_projects(repo, projects: list[Project]) -> None:
    repo.set_setting(PROJECTS_SETTING_KEY, [p.model_dump(mode="json") for p in projects])


def _clean_artist_ids(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    seen: list[str] = []
    for item in raw:
        pid = str(item or "").strip()
        if pid and pid not in seen:
            seen.append(pid)
    return seen


def _user_wire(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "name": u.name,
        "email": u.email,
        "role": str(u.role.value if isinstance(u.role, Role) else u.role),
        "artist_ids": list(u.artist_ids or []),
        "travel_person_id": u.travel_person_id,
        "revoked": u.revoked,
        "has_login_key": bool(u.login_key_hash),
        "has_mcp_key": bool(u.mcp_key_hash),
        "last_seen_at": u.last_seen_at,
    }


@router.get("/auth/me")
def auth_me(request: Request) -> JSONResponse:
    settings = get_app_settings(request)
    user = current_user(request)
    community_active = bool(
        settings.community_share_enabled
        and (
            settings.tenancy_mode == "multi"
            or settings.community_share_url.strip()
            or settings.bitcoin_donation_address.strip()
            or settings.bitcoin_lightning_address.strip()
        )
    )
    base_meta = {
        "auth_enforced": settings.auth_enforced,
        "tenancy_mode": settings.tenancy_mode,
        "base_path": settings.normalized_base_path,
        "google_oauth_enabled": settings.google_oauth_enabled,
        "email_password_enabled": settings.tenancy_mode == "multi",
        "password_login_enabled": bool(settings.basic_auth_password.strip()),
        "hosted_plan": settings.hosted_plan_name if settings.tenancy_mode == "multi" else None,
        "landing_video_url": settings.landing_video_url.strip(),
        "share_footer_branding": bool(settings.tenancy_mode == "multi" or settings.share_footer_branding),
        "community": {
            "enabled": community_active,
            "milestone_gigs": max(1, int(settings.community_share_milestone_gigs or 7)),
            "share_url": settings.community_share_url.strip(),
            "btc_address": settings.bitcoin_donation_address.strip(),
            "lightning_address": settings.bitcoin_lightning_address.strip(),
        },
        "legal": {
            "operator_name": settings.legal_operator_name,
            "contact_email": settings.legal_contact_email,
            "operator_address": settings.legal_operator_address,
            "effective_date": settings.legal_effective_date,
        },
    }
    if user is None:
        reason = getattr(request.state, "auth_failure_reason", None)
        return ok(authenticated=False, user=None, reason=reason, **base_meta)
    hosted_usage = (
        get_hosted_usage(get_repo(request), settings) if settings.tenancy_mode == "multi" else None
    )
    from app.api.platform_admin import is_platform_admin

    return ok(
        authenticated=True,
        user=_user_wire(user),
        tenant_id=get_tenant_id(request),
        hosted_usage=hosted_usage,
        is_platform_admin=is_platform_admin(user, settings),
        **base_meta,
    )


@router.get("/legal/info")
def legal_info(request: Request) -> JSONResponse:
    """Public metadata for US (CCPA/CPRA/COPPA) & Mexico (LFPDPPP/ARCO) legal pages."""
    settings = get_app_settings(request)
    return ok(
        operator_name=settings.legal_operator_name,
        contact_email=settings.legal_contact_email,
        operator_address=settings.legal_operator_address,
        effective_date=settings.legal_effective_date,
        tenancy_mode=settings.tenancy_mode,
        hosted_plan=settings.hosted_plan_name,
        hosted_ai_daily_limit=settings.hosted_ai_daily_limit,
        hosted_max_gigs=settings.hosted_max_gigs,
        hosted_max_files_mb=settings.hosted_max_files_mb,
    )


@router.get("/auth/google/start")
def google_oauth_start(
    request: Request,
    consent: str = Query(default="1"),
):
    """Initiate Google OAuth 2.0 + PKCE Sign Up / Sign In flow."""
    settings = get_app_settings(request)
    if not settings.google_oauth_enabled:
        return err("google_oauth_not_configured", status=503)
    state = secrets.token_urlsafe(24)
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest())
        .decode("ascii")
        .rstrip("=")
    )
    params = urlencode(
        {
            "client_id": settings.google_oauth_client_id,
            "redirect_uri": _oauth_redirect_uri(request),
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
            "prompt": "select_account",
        }
    )
    resp = RedirectResponse(url=f"{_GOOGLE_AUTH_URL}?{params}", status_code=302)
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    cookie_path = settings.normalized_base_path or "/"
    consent_flag = "1" if consent == "1" else "0"
    resp.set_cookie(
        key=_OAUTH_COOKIE,
        value=f"{state}.{verifier}.{consent_flag}",
        max_age=600,
        httponly=True,
        samesite="lax",
        secure=secure,
        path=cookie_path,
    )
    return resp


@router.get("/auth/google/callback")
async def google_oauth_callback(
    request: Request,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    """Verify Google OAuth callback, provision/load isolated tenant workspace, and mint session."""
    settings = get_app_settings(request)
    base = settings.normalized_base_path

    def _fail(reason: str) -> RedirectResponse:
        r = RedirectResponse(url=f"{base}/login?auth_error={reason}", status_code=302)
        r.delete_cookie(key=_OAUTH_COOKIE, path=base or "/")
        return r

    if not settings.google_oauth_enabled:
        return _fail("google_disabled")
    if error or not code or not state:
        return _fail("google_cancelled")

    raw_cookie = request.cookies.get(_OAUTH_COOKIE) or ""
    parts = raw_cookie.split(".")
    if len(parts) < 2:
        return _fail("oauth_state_missing")
    expected_state, verifier = parts[0], parts[1]
    consent_accepted = len(parts) >= 3 and parts[2] == "1"
    if not constant_time_equals(state, expected_state):
        return _fail("oauth_state_mismatch")

    try:
        profile = await _exchange_google_code(
            code=code,
            code_verifier=verifier,
            redirect_uri=_oauth_redirect_uri(request),
            client_id=settings.google_oauth_client_id,
            client_secret=settings.google_oauth_client_secret,
        )
    except Exception:
        return _fail("google_exchange_failed")

    sub = str(profile.get("sub") or "").strip()
    email = str(profile.get("email") or "").strip().lower()
    email_verified = bool(profile.get("email_verified", False))
    name = str(profile.get("name") or email.split("@")[0] or "User").strip()[:80]
    if not sub or not email or not email_verified:
        return _fail("google_unverified_email")

    if settings.tenancy_mode == "multi":
        tenant_mgr = request.app.state.tenant_manager
        tenant_id, tenant_repo, created_new = tenant_mgr.get_or_create_google_tenant(
            google_sub=sub,
            email=email,
            name=name,
        )
        owner = tenant_repo.ensure_owner(name, email)
        if consent_accepted or created_new:
            tenant_repo.set_setting(
                "legal_consent",
                {
                    "accepted_at": now_iso(),
                    "effective_date": settings.legal_effective_date,
                    "age_confirmed_18_plus": True,
                    "email": email,
                },
            )
        resp = RedirectResponse(url=f"{base}/tour", status_code=302)
        resp.delete_cookie(key=_OAUTH_COOKIE, path=base or "/")
        mint_session_cookie(tenant_repo, owner, resp, request, tenant_id=tenant_id)
        return resp

    # Single-tenant mode: allow configured owner_email or an existing non-revoked team member
    repo = get_repo(request)
    matched: User | None = None
    if settings.owner_email and constant_time_equals(email, settings.owner_email.strip().lower()):
        matched = repo.ensure_owner(settings.owner_name or name, email)
    else:
        for u in repo.list_users():
            if not u.revoked and u.email and constant_time_equals(email, u.email.strip().lower()):
                matched = u
                break
    if matched is None:
        return _fail("not_invited")
    resp = RedirectResponse(url=f"{base}/tour", status_code=302)
    resp.delete_cookie(key=_OAUTH_COOKIE, path=base or "/")
    mint_session_cookie(repo, matched, resp, request)
    return resp


@router.post("/auth/owner-login")
def owner_login(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    settings = get_app_settings(request)
    if settings.tenancy_mode == "multi":
        return err("use_google_or_email_signin", status=400)
    password = str(body.get("password") or "")
    username = body.get("username")
    verdict = verify_owner_password(request, password, username=str(username) if username else None)
    if verdict == "rate_limited":
        return err("rate_limited", status=429)
    if verdict is not None:
        return err("invalid_password", status=401)
    repo = get_repo(request)
    owner = repo.ensure_owner(settings.owner_name, settings.owner_email)
    resp = ok(user=_user_wire(owner))
    mint_session_cookie(repo, owner, resp, request)
    record_audit(request, "login", owner.id, "Owner password login")
    return resp


@router.post("/auth/register")
def register_email_account(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Old-school Email + Password sign-up for public multi-tenant workspaces (with US/MX consent)."""
    settings = get_app_settings(request)
    if settings.tenancy_mode != "multi":
        return err("registration_disabled", status=400)
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("register", ip):
        return err("rate_limited", status=429)

    email = str(body.get("email") or "").strip().lower()
    name = str(body.get("name") or "").strip()
    password = str(body.get("password") or "")
    consent = bool(body.get("consent", False))

    if not consent:
        return err("privacy_consent_required", status=400)
    if not email or "@" not in email or "." not in email.split("@", 1)[-1] or len(email) > 160:
        return err("invalid_email", status=400)
    if len(password) < 8 or len(password) > 256:
        return err("password_too_short", status=400)

    tm = request.app.state.tenant_manager
    try:
        tenant_id, tenant_repo = tm.register_email_tenant(
            email=email,
            name=name or email.split("@")[0],
            password=password,
        )
    except ValueError:
        AUTH_LIMITER.record("register", ip)
        return err("email_already_registered", status=409)

    owner = tenant_repo.ensure_owner(name or email.split("@")[0], email)
    resp = created(user=_user_wire(owner), tenant_id=tenant_id)
    mint_session_cookie(tenant_repo, owner, resp, request, tenant_id=tenant_id)
    tenant_repo.append_audit(
        AuditEvent(
            actor_id=owner.id,
            actor_name=owner.name,
            channel="auth",
            action="email_signup",
            target_id=owner.id,
            summary="Signed up with email & password (privacy notice accepted)",
        )
    )
    return resp


@router.post("/auth/password-login")
def password_login(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Old-school Email + Password sign-in for public multi-tenant workspaces."""
    settings = get_app_settings(request)
    if settings.tenancy_mode != "multi":
        return err("use_owner_login", status=400)
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("password_login", ip):
        return err("rate_limited", status=429)

    email = str(body.get("email") or "").strip().lower()
    password = str(body.get("password") or "")
    if not email or not password:
        return err("email_and_password_required", status=400)

    tm = request.app.state.tenant_manager
    res = tm.authenticate_email_tenant(email=email, password=password)
    if res is None:
        AUTH_LIMITER.record("password_login", ip)
        return err("invalid_credentials", status=401)
    tenant_id, tenant_repo = res
    owner = tenant_repo.ensure_owner(email.split("@")[0], email)
    resp = ok(user=_user_wire(owner), tenant_id=tenant_id)
    mint_session_cookie(tenant_repo, owner, resp, request, tenant_id=tenant_id)
    return resp


@router.post("/auth/key-login")
def key_login(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("key_login", ip):
        return err("rate_limited", status=429)
    raw_input = str(body.get("key") or "").strip()
    if not raw_input:
        return err("missing_key", status=400)
    settings = get_app_settings(request)
    tenant_id, raw_key = parse_scoped_token(raw_input)
    if settings.tenancy_mode == "multi":
        repo = request.app.state.tenant_manager.get_repo(tenant_id)
        if repo is None:
            AUTH_LIMITER.record("key_login", ip)
            return err("invalid_key", status=401)
    else:
        repo = get_repo(request)
        tenant_id = None
    user = repo.find_user_by_login_key_hash(hash_secret(raw_key))
    if not user or user.revoked:
        AUTH_LIMITER.record("key_login", ip)
        return err("invalid_key", status=401)
    device = bool(body.get("device", False))
    ttl = settings.device_session_ttl_days if device else settings.session_ttl_days
    resp = ok(user=_user_wire(user))
    mint_session_cookie(repo, user, resp, request, ttl_days=ttl, tenant_id=tenant_id)
    return resp


@router.post("/auth/logout")
def logout(request: Request) -> JSONResponse:
    settings = get_app_settings(request)
    raw_cookie = request.cookies.get(settings.session_cookie_name)
    if raw_cookie:
        _, raw_token = parse_scoped_token(raw_cookie)
        get_repo(request).delete_session(hash_secret(raw_token))
    resp = ok()
    clear_session_cookie(resp, request)
    return resp


@router.post("/auth/my-mcp-key")
def issue_my_mcp_key(request: Request) -> JSONResponse:
    """Self-service MCP URL generator for signed-in owners & editors (Claude, ChatGPT, Gemini, Grok)."""
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    if str(member.role.value if isinstance(member.role, Role) else member.role) == "viewer":
        return err("editors_or_owners_only", status=403)
    repo = get_repo(request)
    settings = get_app_settings(request)
    raw_secret = f"tdm_{secrets.token_urlsafe(24)}"
    member.mcp_key_hash = hash_secret(raw_secret)
    repo.upsert_user(member)

    tid = get_tenant_id(request)
    scoped_key = scope_token(tid, raw_secret) if (settings.tenancy_mode == "multi" and tid) else raw_secret
    origin = (settings.public_origin or "").rstrip("/") or str(request.base_url).rstrip("/")
    base = settings.normalized_base_path
    mcp_url = f"{origin}{base}/mcp/{scoped_key}"
    bearer_endpoint = f"{origin}{base}/mcp"
    record_audit(request, "rotate_my_mcp_key", member.id, "Generated personal MCP connection URL")
    return ok(
        mcp_key=scoped_key,
        mcp_url=mcp_url,
        bearer_endpoint=bearer_endpoint,
        user=_user_wire(member),
    )


@router.delete("/auth/my-mcp-key")
def revoke_my_mcp_key(request: Request) -> JSONResponse:
    """Revoke the signed-in member's personal MCP URL immediately."""
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    member.mcp_key_hash = None
    repo.upsert_user(member)
    record_audit(request, "revoke_my_mcp_key", member.id, "Revoked personal MCP connection URL")
    return ok(user=_user_wire(member))


# ---- Self-Service Data Rights (US CCPA/CPRA & Mexico LFPDPPP ARCO) ----
@router.get("/account/export")
def account_export(request: Request) -> JSONResponse:
    """Right of Access & Data Portability (ARCO Acceso / CCPA Right to Know)."""
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    gigs_out: list[dict[str, Any]] = []
    for g in repo.list_gigs(include_deleted=True):
        gd = g.model_dump(mode="json")
        gd["items"] = [it.model_dump(mode="json") for it in repo.list_items(g.id, include_deleted=True)]
        gigs_out.append(gd)
    payload = {
        "exported_at": now_iso(),
        "tenant_id": get_tenant_id(request),
        "projects": [p.model_dump(mode="json") for p in _load_projects(repo)],
        "gigs": gigs_out,
        "people": [p.model_dump(mode="json") for p in repo.list_people(include_merged=True)],
        "files": [f.model_dump(mode="json") for f in repo.list_files()],
        "share_links": [s.model_dump(mode="json") for s in repo.list_share_links()],
        "users": [_user_wire(u) for u in repo.list_users()],
        "legal_consent": repo.get_setting("legal_consent"),
    }
    record_audit(request, "account_export", get_tenant_id(request) or "workspace", "Exported full workspace JSON")
    return ok(export=payload)


@router.post("/account/delete")
def account_delete(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Right of Erasure / Cancellation (ARCO Cancelacion / CCPA Right to Delete)."""
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    if str(body.get("confirm") or "").strip().upper() != "DELETE":
        return err("confirmation_required", status=400)
    settings = get_app_settings(request)
    tenant_id = get_tenant_id(request)
    repo = get_repo(request)

    # Delete local vault files owned by this workspace
    vault_root = Path(settings.file_vault_local_path).resolve()
    sub_vault = (vault_root / tenant_id).resolve() if tenant_id else vault_root
    for f in repo.list_files():
        p = (sub_vault / f.object_id).resolve()
        if p.is_relative_to(vault_root) and p.is_file():
            p.unlink(missing_ok=True)
        repo.delete_file(f.id)

    for g in repo.list_gigs(include_deleted=True):
        repo.destroy_gig(g.id)
    for s in repo.list_share_links():
        repo.delete_share_link(s.key)
    for u in repo.list_users():
        repo.delete_user_sessions(u.id)
    repo.set_setting(PROJECTS_SETTING_KEY, [])
    repo.set_setting("ai_intake", {})

    if settings.tenancy_mode == "multi" and tenant_id:
        root_repo = request.app.state.repo
        meta = root_repo.get_setting(f"tenant_meta:{tenant_id}")
        if isinstance(meta, dict) and meta.get("google_sub"):
            root_repo.set_setting(f"tenant_google:{meta['google_sub']}", None)
        root_repo.set_setting(f"tenant_meta:{tenant_id}", None)
        # Close and remove isolated SQLite file if running locally
        tm = request.app.state.tenant_manager
        with tm._lock:
            cached = tm._cache.pop(tenant_id, None)
            if cached and hasattr(cached, "close"):
                cached.close()
        if settings.repo_backend == "sqlite":
            t_db = Path(settings.local_db_path).parent / "tenants" / f"{tenant_id}.sqlite3"
            for suffix in ("", "-wal", "-shm"):
                Path(f"{t_db}{suffix}").unlink(missing_ok=True)

    resp = ok(deleted=True)
    clear_session_cookie(resp, request)
    return resp


# ---- Owner Admin ----
@router.get("/admin/users")
def admin_list_users(request: Request) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    users = [_user_wire(u) for u in get_repo(request).list_users()]
    return ok(users=users)


@router.post("/admin/users")
def admin_create_user(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    name = str(body.get("name") or "").strip()
    if not name:
        return err("name_required", status=400)
    try:
        role = Role(str(body.get("role") or "editor"))
    except ValueError:
        return err("invalid_role", status=400)
    if role == Role.owner:
        return err("cannot_create_owner", status=400)
    login_key = secrets.token_urlsafe(24)
    mcp_key = secrets.token_urlsafe(24) if role == Role.editor else None
    artist_ids = _clean_artist_ids(body.get("artist_ids"))
    travel_pid = str(body.get("travel_person_id") or "").strip() or None
    user = User(
        name=name,
        email=str(body.get("email") or "").strip() or None,
        role=role,
        artist_ids=artist_ids,
        travel_person_id=travel_pid,
        login_key_hash=hash_secret(login_key),
        mcp_key_hash=hash_secret(mcp_key) if mcp_key else None,
    )
    get_repo(request).upsert_user(user)
    scope_desc = f"projects={','.join(artist_ids)}" if artist_ids else "all projects"
    record_audit(request, "create_user", user.id, f"Created {role.value} {name} ({scope_desc})")
    tenant_id = get_tenant_id(request)
    return ok(
        user=_user_wire(user),
        login_key=scope_token(tenant_id, login_key),
        mcp_key=scope_token(tenant_id, mcp_key) if mcp_key else None,
    )


@router.patch("/admin/users/{user_id}")
def admin_update_user(user_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Update a team member's role (viewer <-> editor), assigned projects, or linked person."""
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    user = repo.get_user(user_id)
    if not user:
        return err("user_not_found", status=404)
    if str(user.role) == "owner":
        return err("cannot_modify_owner", status=400)

    changes: list[str] = []
    if "name" in body:
        new_name = str(body["name"] or "").strip()
        if not new_name:
            return err("name_required", status=400)
        user.name = new_name[:80]
        changes.append(f"name={user.name}")

    if "role" in body:
        try:
            new_role = Role(str(body["role"]))
        except ValueError:
            return err("invalid_role", status=400)
        if new_role == Role.owner:
            return err("cannot_promote_owner", status=400)
        user.role = new_role
        if new_role == Role.viewer:
            user.mcp_key_hash = None
        changes.append(f"role={new_role.value}")

    if "artist_ids" in body:
        user.artist_ids = _clean_artist_ids(body["artist_ids"])
        changes.append(f"projects={','.join(user.artist_ids) or 'all'}")

    if "travel_person_id" in body:
        user.travel_person_id = str(body["travel_person_id"] or "").strip() or None
        changes.append(f"person={user.travel_person_id or 'none'}")

    repo.upsert_user(user)
    record_audit(
        request,
        "update_user",
        user.id,
        f"Updated {user.name}: {', '.join(changes) or 'no changes'}",
    )
    return ok(user=_user_wire(user))


@router.post("/admin/users/{user_id}/rotate-key")
def admin_rotate_key(user_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    kind = str(body.get("kind") or "login")
    if kind not in {"login", "mcp"}:
        return err("invalid_key_kind", status=400)
    repo = get_repo(request)
    user = repo.get_user(user_id)
    if not user:
        return err("user_not_found", status=404)
    new_key = secrets.token_urlsafe(24)
    if kind == "login":
        user.login_key_hash = hash_secret(new_key)
    else:
        user.mcp_key_hash = hash_secret(new_key)
    repo.upsert_user(user)
    record_audit(request, f"rotate_{kind}_key", user.id, f"Rotated {kind} key for {user.name}")
    tenant_id = get_tenant_id(request)
    return ok(user=_user_wire(user), **{f"{kind}_key": scope_token(tenant_id, new_key)})


@router.post("/admin/users/{user_id}/revoke")
def admin_revoke_user(user_id: str, request: Request, body: dict[str, Any] = Body(default={})) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    user = repo.get_user(user_id)
    if not user:
        return err("user_not_found", status=404)
    if str(user.role) == "owner":
        return err("cannot_revoke_owner", status=400)
    user.revoked = bool(body.get("revoked", True))
    repo.upsert_user(user)
    if user.revoked:
        repo.delete_user_sessions(user.id)
    record_audit(request, "revoke_user", user.id, f"Revoked={user.revoked} for {user.name}")
    return ok(user=_user_wire(user))


@router.get("/admin/audit")
def admin_audit(request: Request, limit: int = 50, writes: bool = False) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    events = get_repo(request).list_audit(limit=min(max(limit, 1), 200), writes_only=writes)
    return ok(events=[e.model_dump(mode="json") for e in events])


# ---- Multi-Artist / Project Agendas ----
@router.get("/projects")
def list_projects(request: Request) -> JSONResponse:
    user = current_user(request)
    if user is None:
        return err("auth_required", status=401)
    allowed = allowed_project_ids(user)
    projects = _load_projects(get_repo(request))
    visible = [
        p.model_dump(mode="json")
        for p in projects
        if not p.archived and (allowed is None or p.id in allowed)
    ]
    return ok(projects=visible)


@router.post("/admin/projects")
def admin_create_project(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    name = str(body.get("name") or "").strip()
    if not name:
        return err("name_required", status=400)
    color = str(body.get("color") or "#f3c64a").strip()
    if not _HEX_COLOR_RE.fullmatch(color):
        color = "#f3c64a"
    repo = get_repo(request)
    projects = _load_projects(repo)
    proj = Project(
        name=name[:80],
        color=color,
        notes=str(body.get("notes") or "").strip()[:400],
    )
    projects.append(proj)
    _save_projects(repo, projects)
    record_audit(request, "create_project", proj.id, f"Created project {proj.name}")
    return created(project=proj.model_dump(mode="json"))


@router.patch("/admin/projects/{project_id}")
def admin_update_project(project_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    projects = _load_projects(repo)
    target = next((p for p in projects if p.id == project_id), None)
    if not target:
        return err("project_not_found", status=404)
    if "name" in body:
        name = str(body["name"] or "").strip()
        if not name:
            return err("name_required", status=400)
        target.name = name[:80]
    if "color" in body:
        color = str(body["color"] or "").strip()
        if _HEX_COLOR_RE.fullmatch(color):
            target.color = color
    if "notes" in body:
        target.notes = str(body["notes"] or "").strip()[:400]
    if "archived" in body:
        target.archived = bool(body["archived"])
    _save_projects(repo, projects)
    record_audit(request, "update_project", target.id, f"Updated project {target.name}")
    return ok(project=target.model_dump(mode="json"))


@router.delete("/admin/projects/{project_id}")
def admin_delete_project(project_id: str, request: Request) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    projects = _load_projects(repo)
    target = next((p for p in projects if p.id == project_id), None)
    if not target:
        return err("project_not_found", status=404)
    # Fail-safe: prevent deleting a project while gigs or single-project users still depend on it
    if any(g.artist_id == project_id for g in repo.list_gigs(include_deleted=True)):
        return err("project_has_gigs", status=409)
    if any(u.artist_ids == [project_id] for u in repo.list_users()):
        return err("project_has_scoped_users", status=409)
    remaining = [p for p in projects if p.id != project_id]
    _save_projects(repo, remaining)
    # Remove from multi-project users safely (never reducing a scoped user to empty [])
    for u in repo.list_users():
        if project_id in (u.artist_ids or []) and len(u.artist_ids) > 1:
            u.artist_ids = [pid for pid in u.artist_ids if pid != project_id]
            repo.upsert_user(u)
    record_audit(request, "delete_project", project_id, f"Deleted project {target.name}")
    return ok(project_id=project_id)
