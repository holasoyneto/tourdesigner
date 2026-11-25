"""Authentication, session cookies, CSRF origin guard, and no-lockout rate limiting."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

from fastapi import Request, Response

from app.config import get_settings
from app.domain.models import Session, User, iso_in_days, now_iso

SESSION_TOUCH_INTERVAL_SEC = 600


def hash_secret(token: str) -> str:
    """Hash bearer tokens/keys with SHA-256 so raw credentials never sit at rest."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def constant_time_equals(a: str | None, b: str | None) -> bool:
    if a is None or b is None:
        return False
    return hmac.compare_digest(a.encode("utf-8"), b.encode("utf-8"))


def is_expired(iso_ts: str | None) -> bool:
    if not iso_ts:
        return False
    try:
        dt = datetime.fromisoformat(iso_ts)
    except ValueError:
        return False
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt < datetime.now(timezone.utc)


def needs_touch(last_seen_at: str | None) -> bool:
    if not last_seen_at:
        return True
    try:
        seen = datetime.fromisoformat(last_seen_at)
    except ValueError:
        return True
    if seen.tzinfo is None:
        seen = seen.replace(tzinfo=timezone.utc)
    return abs((datetime.now(timezone.utc) - seen).total_seconds()) > SESSION_TOUCH_INTERVAL_SEC


class FailureLimiter:
    """Bounded sliding-window failure limiter. Evaluates valid credentials before throttling."""

    def __init__(self, window_sec: int = 300, max_failures: int = 20, max_buckets: int = 4096) -> None:
        self.window_sec = window_sec
        self.max_failures = max_failures
        self.max_buckets = max_buckets
        self._buckets: dict[tuple[str, str], list[float]] = {}
        self._lock = threading.Lock()

    def _prune_locked(self, cutoff: float) -> None:
        if len(self._buckets) < self.max_buckets:
            return
        stale = [k for k, ts_list in self._buckets.items() if not any(t > cutoff for t in ts_list)]
        for k in stale:
            self._buckets.pop(k, None)
        while len(self._buckets) >= self.max_buckets:
            self._buckets.pop(next(iter(self._buckets)), None)

    def is_limited(self, scope: str, requester: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window_sec
        with self._lock:
            key = (scope, requester)
            hits = [t for t in self._buckets.get(key, []) if t > cutoff]
            if hits:
                self._buckets[key] = hits
            else:
                self._buckets.pop(key, None)
            return len(hits) >= self.max_failures

    def record(self, scope: str, requester: str) -> None:
        now = time.monotonic()
        cutoff = now - self.window_sec
        with self._lock:
            self._prune_locked(cutoff)
            key = (scope, requester)
            hits = [t for t in self._buckets.get(key, []) if t > cutoff]
            hits.append(now)
            self._buckets[key] = hits


AUTH_LIMITER = FailureLimiter()


def requester_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return str(getattr(request.client, "host", "unknown") or "unknown")


def parse_basic_auth(request: Request) -> tuple[str, str] | None:
    header = request.headers.get("authorization", "")
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "basic" or len(parts[1]) > 2048:
        return None
    try:
        raw = base64.b64decode(parts[1], validate=True).decode("utf-8")
        user, sep, password = raw.partition(":")
        return (user, password) if sep else None
    except Exception:
        return None


def _req_settings(request: Request | None = None):
    if request is not None:
        s = getattr(request.app.state, "settings", None)
        if s is not None:
            return s
    return get_settings()


def verify_owner_password(request: Request, password: str, username: str | None = None) -> str | None:
    """Returns None on valid owner credential, else 'rate_limited' or 'invalid_password'."""
    settings = _req_settings(request)
    if not settings.basic_auth_password:
        return "owner_password_not_configured"
    ok = len(password) <= 512 and constant_time_equals(password, settings.basic_auth_password)
    if username is not None:
        ok = ok and constant_time_equals(username, settings.basic_auth_user)
    if ok:
        return None
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("owner_login", ip):
        return "rate_limited"
    AUTH_LIMITER.record("owner_login", ip)
    return "invalid_password"


def mint_session_cookie(
    repo,
    user: User,
    response: Response,
    request: Request,
    *,
    ttl_days: int | None = None,
    impersonator_id: str | None = None,
    tenant_id: str | None = None,
) -> Session:
    settings = _req_settings(request)
    ttl = ttl_days or settings.session_ttl_days
    raw_token = secrets.token_urlsafe(32)
    session = Session(
        token_hash=hash_secret(raw_token),
        user_id=user.id,
        impersonator_id=impersonator_id,
        ttl_days=ttl,
        expires_at=iso_in_days(ttl),
    )
    repo.create_session(session)
    repo.touch_user(user.id, now_iso())
    secure = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    cookie_val = f"{tenant_id}.{raw_token}" if tenant_id else raw_token
    cookie_path = settings.normalized_base_path or "/"
    response.set_cookie(
        key=settings.session_cookie_name,
        value=cookie_val,
        max_age=ttl * 86400,
        httponly=True,
        samesite="lax",
        secure=secure,
        path=cookie_path,
    )
    return session


def clear_session_cookie(response: Response, request: Request | None = None) -> None:
    settings = _req_settings(request)
    response.delete_cookie(key=settings.session_cookie_name, path=settings.normalized_base_path or "/")
    if settings.normalized_base_path:
        response.delete_cookie(key=settings.session_cookie_name, path="/")


def check_csrf_origin(request: Request) -> bool:
    """Verify same-origin for cookie-authenticated state-changing browser requests."""
    if request.method in {"GET", "HEAD", "OPTIONS"}:
        return True
    sec_fetch = request.headers.get("sec-fetch-site", "").strip().lower()
    if sec_fetch and sec_fetch not in {"same-origin", "same-site", "none"}:
        return False
    req_host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "").lower()
    if not req_host:
        return True
    origin = request.headers.get("origin", "").strip()
    if origin:
        return urlsplit(origin).netloc.lower() == req_host
    referer = request.headers.get("referer", "").strip()
    if referer:
        return urlsplit(referer).netloc.lower() == req_host
    return True
