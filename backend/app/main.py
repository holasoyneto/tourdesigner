"""FastAPI application entrypoint for Tour Designer."""

from __future__ import annotations

import json
import os
import posixpath
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api.auth import router as auth_router
from app.api.files import router as files_router
from app.api.gigs import router as gigs_router
from app.api.intake import router as intake_router
from app.api.integrations import router as integrations_router
from app.api.people import router as people_router
from app.api.shares import router as shares_router
from app.config import Settings, get_settings
from app.domain.auth import (
    check_csrf_origin,
    hash_secret,
    mint_session_cookie,
    needs_touch,
    parse_basic_auth,
    verify_owner_password,
)
from app.domain.models import iso_in_days, now_iso
from app.domain.roles import role_of
from app.mcp.server import router as mcp_router
from app.repo.factory import build_repo
from app.repo.protocol import TourRepo
from app.repo.tenants import TenantManager, parse_scoped_token
from app.seed import seed_demo_if_empty

_PUBLIC_API_EXACT = {
    "/api/health",
    "/api/auth/me",
    "/api/auth/owner-login",
    "/api/auth/key-login",
    "/api/auth/register",
    "/api/auth/password-login",
    "/api/auth/logout",
    "/api/auth/google/start",
    "/api/auth/google/callback",
    "/api/legal/info",
    "/api/public/booking-recipients",
    "/api/public/interest",
    "/api/cron/gig-digest",
    "/api/places/cities",
}
_PUBLIC_API_PREFIXES = ("/api/share/resolve/", "/api/share/person/", "/api/files/mcp/", "/api/calendar/")
_VIEWER_READ_EXACT = {"/api/gigs", "/api/gigs/changes", "/api/places/cities", "/api/projects"}


def _viewer_allowed(path: str) -> bool:
    if path in _VIEWER_READ_EXACT:
        return True
    parts = path.strip("/").split("/")
    return len(parts) == 3 and parts[:2] == ["api", "gigs"]


class _BasePathMiddleware:
    """ASGI prefix stripper so a single build serves at `/` OR any subpath like `/tourdesigner`."""

    def __init__(self, app, base_path: str) -> None:
        self.app = app
        self.base_path = base_path

    async def __call__(self, scope, receive, send):
        if scope["type"] in {"http", "websocket"} and self.base_path:
            raw_path: str = scope.get("path") or "/"
            if raw_path == self.base_path:
                resp = RedirectResponse(url=f"{self.base_path}/", status_code=302)
                await resp(scope, receive, send)
                return
            if raw_path.startswith(f"{self.base_path}/"):
                scope = dict(scope)
                scope["path"] = raw_path[len(self.base_path) :] or "/"
        await self.app(scope, receive, send)


def create_app(settings: Settings | None = None, repo: TourRepo | None = None) -> FastAPI:
    cfg = settings or get_settings()
    base_path = cfg.normalized_base_path

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = cfg
        root_repo = repo or build_repo(cfg)
        app.state.repo = root_repo
        app.state.tenant_manager = TenantManager(cfg, root_repo)
        if cfg.tenancy_mode == "single":
            root_repo.ensure_owner(cfg.owner_name, cfg.owner_email)
            if cfg.env == "local" and not cfg.auth_enforced:
                seed_demo_if_empty(root_repo)
        yield
        app.state.tenant_manager.close_all()
        if hasattr(root_repo, "close"):
            root_repo.close()

    app = FastAPI(
        title=cfg.app_name,
        version="2.0.0",
        lifespan=lifespan,
        docs_url=None if cfg.auth_enforced else "/docs",
        redoc_url=None,
        openapi_url=None if cfg.auth_enforced else "/openapi.json",
    )

    if cfg.cors_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=cfg.cors_list,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["*"],
        )

    @app.middleware("http")
    async def security_and_auth(request: Request, call_next):
        path = "/" + posixpath.normpath(request.url.path).lstrip("/")
        root_repo: TourRepo = request.app.state.repo
        tm: TenantManager = request.app.state.tenant_manager

        active_repo: TourRepo = root_repo
        tenant_id: str | None = None
        user = None
        mint_owner = False
        request.state.auth_failure_reason = None
        request.state.impersonator = None

        raw_cookie = request.cookies.get(cfg.session_cookie_name)
        if raw_cookie:
            if cfg.tenancy_mode == "multi":
                parsed_tid, raw_token = parse_scoped_token(raw_cookie)
                t_repo = tm.get_repo(parsed_tid) if parsed_tid else None
                if t_repo is not None:
                    resolved = t_repo.get_session(hash_secret(raw_token))
                    if resolved:
                        sess, user = resolved
                        active_repo = t_repo
                        tenant_id = parsed_tid
                        if needs_touch(sess.last_seen_at):
                            ts = now_iso()
                            t_repo.touch_session(sess.token_hash, iso_in_days(sess.ttl_days), ts)
                            t_repo.touch_user(user.id, ts)
                    else:
                        request.state.auth_failure_reason = "expired_or_revoked"
                else:
                    request.state.auth_failure_reason = "expired_or_revoked"
            else:
                resolved = root_repo.get_session(hash_secret(raw_cookie))
                if resolved:
                    sess, user = resolved
                    if needs_touch(sess.last_seen_at):
                        ts = now_iso()
                        root_repo.touch_session(sess.token_hash, iso_in_days(sess.ttl_days), ts)
                        root_repo.touch_user(user.id, ts)
                else:
                    request.state.auth_failure_reason = "expired_or_revoked"
        elif cfg.tenancy_mode == "single" and cfg.auth_enforced:
            basic = parse_basic_auth(request)
            if basic:
                verdict = verify_owner_password(request, basic[1], username=basic[0])
                if verdict == "rate_limited":
                    return JSONResponse({"ok": False, "error": "rate_limited"}, status_code=429)
                if verdict is None:
                    user = root_repo.ensure_owner(cfg.owner_name, cfg.owner_email)
                    mint_owner = True
        elif cfg.tenancy_mode == "single" and not cfg.auth_enforced:
            # Open local dev mode (no BASIC_AUTH_PASSWORD or OAuth configured)
            user = root_repo.ensure_owner(cfg.owner_name, cfg.owner_email)

        request.state.repo = active_repo
        request.state.tenant_id = tenant_id
        request.state.user = user

        is_api = path.startswith("/api/")
        is_public = path in _PUBLIC_API_EXACT or any(path.startswith(p) for p in _PUBLIC_API_PREFIXES)

        if is_api and raw_cookie and not check_csrf_origin(request):
            return JSONResponse({"ok": False, "error": "csrf_origin_mismatch"}, status_code=403)

        if cfg.auth_enforced and is_api and not is_public:
            if user is None:
                return JSONResponse({"ok": False, "error": "auth_required"}, status_code=401)
            if role_of(user) == "viewer":
                if request.method not in {"GET", "HEAD", "OPTIONS"}:
                    return JSONResponse({"ok": False, "error": "read_only"}, status_code=403)
                if not _viewer_allowed(path):
                    return JSONResponse({"ok": False, "error": "viewer_scope"}, status_code=403)

        response = await call_next(request)

        # Security headers
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(self), payment=()")
        response.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        response.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self' https://storage.googleapis.com; "
            "frame-src 'self' blob:; frame-ancestors 'self'; base-uri 'self'; object-src 'none'; "
            "form-action 'self'; worker-src 'self'; manifest-src 'self'",
        )
        if is_api and "cache-control" not in response.headers:
            response.headers["Cache-Control"] = "private, no-store"
        elif path.startswith("/static/v3/assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"

        if mint_owner and user is not None:
            mint_session_cookie(active_repo, user, response, request, tenant_id=tenant_id)
        return response

    if base_path:
        app.add_middleware(_BasePathMiddleware, base_path=base_path)

    @app.get("/api/health")
    def health() -> dict:
        return {
            "ok": True,
            "app": cfg.app_name,
            "version": "2.0.0",
            "backend": cfg.repo_backend,
            "tenancy": cfg.tenancy_mode,
            "base_path": base_path,
            "revision": os.environ.get("K_REVISION") or "local",
        }

    for rtr in (
        auth_router,
        gigs_router,
        people_router,
        shares_router,
        files_router,
        intake_router,
        integrations_router,
        mcp_router,
    ):
        app.include_router(rtr)

    static_root = Path(cfg.static_dir)

    @app.get("/static/v3/manifest.webmanifest")
    def dynamic_manifest():
        manifest = {
            "name": "Tour Designer",
            "short_name": "Tour Designer",
            "description": "Offline-first touring desk for artists, DJs & road managers",
            "start_url": f"{base_path}/tour",
            "scope": f"{base_path}/" if base_path else "/",
            "display": "standalone",
            "orientation": "any",
            "background_color": "#0b0d12",
            "theme_color": "#0b0d12",
            "icons": [
                {
                    "src": f"{base_path}/static/v3/icon.svg",
                    "sizes": "any",
                    "type": "image/svg+xml",
                    "purpose": "any maskable",
                }
            ],
        }
        return Response(
            content=json.dumps(manifest),
            media_type="application/manifest+json",
            headers={"Cache-Control": "no-cache"},
        )

    def _render_spa_html(path: str) -> Response:
        index = static_root / "v3" / "index.html"
        if not index.is_file():
            return JSONResponse(
                {"ok": False, "error": "frontend_not_built", "hint": "cd frontend && npm run build"},
                status_code=503,
            )
        html_text = index.read_text(encoding="utf-8")
        meta_tag = f'<meta name="td-base" content="{base_path}" />'
        if base_path:
            html_text = html_text.replace('"/static/v3/', f'"{base_path}/static/v3/')
        if path.startswith("/link/"):
            html_text = html_text.replace("<title>tourdesigner</title>", "<title>tourdesigner — Roadsheet</title>")
        elif path == "/" and cfg.tenancy_mode == "multi":
            html_text = html_text.replace(
                "<title>tourdesigner</title>",
                "<title>Tour Designer — Offline-first touring desk &amp; AI roadsheets</title>",
            )
        if 'name="td-base"' not in html_text and "</head>" in html_text:
            html_text = html_text.replace("</head>", f"    {meta_tag}\n  </head>", 1)
        return HTMLResponse(content=html_text, headers={"Cache-Control": "no-cache, must-revalidate"})

    @app.get("/static/v3/index.html")
    def static_v3_index():
        """Serve SW-precached index.html with runtime td-base and subpath asset prefixes intact."""
        return _render_spa_html("/")

    if static_root.is_dir():
        app.mount("/static", StaticFiles(directory=str(static_root)), name="static")

    @app.get("/sw.js")
    def sw_js():
        sw = static_root / "sw.js"
        if not sw.is_file():
            return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
        if not base_path:
            return FileResponse(str(sw), media_type="application/javascript", headers={"Cache-Control": "no-cache"})
        body = sw.read_text(encoding="utf-8")
        body = body.replace('"/static/v3/', f'"{base_path}/static/v3/').replace(
            '"/api/', f'"{base_path}/api/'
        ).replace('"/mcp/', f'"{base_path}/mcp/')
        return Response(content=body, media_type="application/javascript", headers={"Cache-Control": "no-cache"})

    @app.get("/robots.txt")
    def robots_txt():
        lines = [
            "User-agent: *",
            "Allow: /",
            "Disallow: /link/",
            "Disallow: /api/",
            "Disallow: /mcp/",
        ]
        return Response(content="\n".join(lines) + "\n", media_type="text/plain")

    @app.get("/sitemap.xml")
    def sitemap_xml(request: Request):
        origin = (cfg.public_origin or "").rstrip("/") or str(request.base_url).rstrip("/")
        root = f"{origin}{base_path}"
        urls = [f"{root}/", f"{root}/demo", f"{root}/login", f"{root}/legal/privacy", f"{root}/legal/terms"]
        body = (
            '<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            + "".join(f"  <url><loc>{u}</loc></url>\n" for u in urls)
            + "</urlset>\n"
        )
        return Response(content=body, media_type="application/xml")

    # SPA fallback for client-side routes
    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str, request: Request):
        if full_path.startswith(("api/", "mcp/", "static/")):
            return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
        path = f"/{full_path}"
        is_public_route = (
            path in {"/login", "/revoked", "/legal/privacy", "/legal/terms", "/demo"}
            or (path == "/" and cfg.tenancy_mode == "multi")
            or path.startswith("/link/")
        )
        if cfg.auth_enforced and not is_public_route and getattr(request.state, "user", None) is None:
            return RedirectResponse(url=f"{base_path}/login", status_code=302)
        return _render_spa_html(path)

    return app


app = create_app()
