"""Multi-tenant workspace isolation manager & hosted fair-use quota tracking.

In single-tenant mode (`TENANCY_MODE=single`), every request uses the single root TourRepo.
In multi-tenant mode (`TENANCY_MODE=multi`), every Google account gets a physically isolated
TourRepo namespace (separate SQLite DB file locally, or separate Firestore collection prefix
`t_<tenant_id>_` in Cloud Run), eliminating cross-tenant data leakage by construction.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import threading
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import Settings
from app.domain.models import Project, now_iso
from app.repo.firestore import FirestoreRepo
from app.repo.protocol import TourRepo
from app.repo.sqlite_local import LocalSqliteRepo

_TENANT_ID_RE = re.compile(r"^ten_[a-f0-9]{12}$")
_MAX_CACHED_REPOS = 128


def is_valid_tenant_id(tenant_id: str | None) -> bool:
    return bool(tenant_id and _TENANT_ID_RE.fullmatch(tenant_id))


def derive_tenant_id(google_sub: str) -> str:
    digest = hashlib.sha256(f"td-tenant:{google_sub}".encode("utf-8")).hexdigest()[:12]
    return f"ten_{digest}"


def hash_password_scrypt(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${dk.hex()}"


def verify_password_scrypt(password: str, stored: str | None) -> bool:
    if not stored or not password:
        return False
    parts = stored.split("$")
    if len(parts) != 6 or parts[0] != "scrypt":
        return False
    try:
        n, r, p = int(parts[1]), int(parts[2]), int(parts[3])
        salt = bytes.fromhex(parts[4])
        expected = bytes.fromhex(parts[5])
    except ValueError:
        return False
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, dklen=len(expected))
    return hmac.compare_digest(dk, expected)


def scope_token(tenant_id: str | None, raw_token: str) -> str:
    """Attach tenant routing prefix in multi-tenant mode; pass through unchanged in single mode."""
    if not tenant_id:
        return raw_token
    if raw_token.startswith(f"{tenant_id}."):
        return raw_token
    return f"{tenant_id}.{raw_token}"


def parse_scoped_token(token: str | None) -> tuple[str | None, str]:
    """Split `<tenant_id>.<secret>` if valid tenant prefix is present, else `(None, token)`."""
    raw = (token or "").strip()
    if "." in raw:
        head, tail = raw.split(".", 1)
        if is_valid_tenant_id(head) and tail:
            return head, tail
    return None, raw


class TenantManager:
    """Manages physically isolated per-tenant TourRepo instances with bounded LRU caching."""

    def __init__(self, settings: Settings, root_repo: TourRepo) -> None:
        self.settings = settings
        self.root_repo = root_repo
        self._lock = threading.Lock()
        self._cache: OrderedDict[str, TourRepo] = OrderedDict()

    @property
    def is_multi(self) -> bool:
        return self.settings.tenancy_mode == "multi"

    def _open_tenant_repo(self, tenant_id: str) -> TourRepo:
        if self.settings.repo_backend == "firestore":
            base_prefix = (self.settings.firestore_prefix or "").strip()
            return FirestoreRepo(
                project=self.settings.firestore_project,
                database=self.settings.firestore_database,
                prefix=f"{base_prefix}t_{tenant_id}_",
            )
        base_db = Path(self.settings.local_db_path)
        tenants_dir = base_db.parent / "tenants"
        tenants_dir.mkdir(parents=True, exist_ok=True)
        return LocalSqliteRepo(str(tenants_dir / f"{tenant_id}.sqlite3"))

    def get_repo(self, tenant_id: str | None) -> TourRepo | None:
        if not self.is_multi:
            return self.root_repo
        if not is_valid_tenant_id(tenant_id):
            return None
        assert tenant_id is not None
        with self._lock:
            existing = self._cache.get(tenant_id)
            if existing is not None:
                self._cache.move_to_end(tenant_id)
                return existing
            # Verify tenant exists in control plane before opening a handle
            meta = self.root_repo.get_setting(f"tenant_meta:{tenant_id}")
            if not isinstance(meta, dict):
                return None
            repo = self._open_tenant_repo(tenant_id)
            self._cache[tenant_id] = repo
            while len(self._cache) > _MAX_CACHED_REPOS:
                _, evicted = self._cache.popitem(last=False)
                if hasattr(evicted, "close"):
                    try:
                        evicted.close()
                    except Exception:
                        pass
            return repo

    def get_or_create_google_tenant(
        self,
        *,
        google_sub: str,
        email: str,
        name: str,
    ) -> tuple[str, TourRepo, bool]:
        """Provision or load the isolated tenant workspace for a Google OIDC identity."""
        sub_key = f"tenant_google:{google_sub}"
        existing = self.root_repo.get_setting(sub_key)
        created_new = False
        if isinstance(existing, dict) and is_valid_tenant_id(existing.get("tenant_id")):
            tenant_id = str(existing["tenant_id"])
            meta = self.root_repo.get_setting(f"tenant_meta:{tenant_id}")
            if isinstance(meta, dict):
                meta["last_login_at"] = now_iso()
                meta["email"] = email
                if name:
                    meta["name"] = name
                self.root_repo.set_setting(f"tenant_meta:{tenant_id}", meta)
        else:
            norm_email = email.strip().lower()
            by_email = self.root_repo.get_setting(f"tenant_email:{norm_email}") if norm_email else None
            if isinstance(by_email, dict) and is_valid_tenant_id(by_email.get("tenant_id")):
                tenant_id = str(by_email["tenant_id"])
                meta = self.root_repo.get_setting(f"tenant_meta:{tenant_id}") or {"tenant_id": tenant_id}
                meta["google_sub"] = google_sub
                meta["email"] = norm_email
                meta["last_login_at"] = now_iso()
                if name:
                    meta["name"] = name
                self.root_repo.set_setting(sub_key, {"tenant_id": tenant_id, "email": norm_email})
                self.root_repo.set_setting(f"tenant_meta:{tenant_id}", meta)
            else:
                tenant_id = derive_tenant_id(google_sub)
                created_new = True
                ts = now_iso()
                record = {
                    "tenant_id": tenant_id,
                    "google_sub": google_sub,
                    "email": norm_email,
                    "name": name or norm_email.split("@")[0],
                    "plan": self.settings.hosted_plan_name,
                    "created_at": ts,
                    "last_login_at": ts,
                }
                self.root_repo.set_setting(sub_key, record)
                if norm_email:
                    self.root_repo.set_setting(f"tenant_email:{norm_email}", {"tenant_id": tenant_id})
                self.root_repo.set_setting(f"tenant_meta:{tenant_id}", record)

        repo = self.get_repo(tenant_id)
        assert repo is not None
        owner_label = (name or email.split("@")[0] or "Owner").strip()[:80]
        repo.ensure_owner(owner_label, email)
        if created_new and not repo.get_setting("projects"):
            first_project = Project(
                id="art_main",
                name=owner_label,
                color="#f3c64a",
                notes="Primary artist agenda",
            )
            repo.set_setting("projects", [first_project.model_dump(mode="json")])
        return tenant_id, repo, created_new

    def register_email_tenant(
        self,
        *,
        email: str,
        name: str,
        password: str,
    ) -> tuple[str, TourRepo]:
        """Register a brand-new isolated tenant workspace via email & password."""
        norm_email = email.strip().lower()
        email_key = f"tenant_email:{norm_email}"
        existing = self.root_repo.get_setting(email_key)
        if isinstance(existing, dict) and is_valid_tenant_id(existing.get("tenant_id")):
            raise ValueError("email_already_registered")

        tenant_id = derive_tenant_id(f"email:{norm_email}")
        ts = now_iso()
        pw_hash = hash_password_scrypt(password)
        owner_label = (name.strip() or norm_email.split("@")[0] or "Owner")[:80]
        record = {
            "tenant_id": tenant_id,
            "email": norm_email,
            "name": owner_label,
            "plan": self.settings.hosted_plan_name,
            "created_at": ts,
            "last_login_at": ts,
        }
        self.root_repo.set_setting(f"tenant_meta:{tenant_id}", record)
        self.root_repo.set_setting(email_key, {"tenant_id": tenant_id, "password_hash": pw_hash})

        repo = self.get_repo(tenant_id)
        assert repo is not None
        repo.ensure_owner(owner_label, norm_email)
        if not repo.get_setting("projects"):
            first_project = Project(
                id="art_main",
                name=owner_label,
                color="#f3c64a",
                notes="Primary artist agenda",
            )
            repo.set_setting("projects", [first_project.model_dump(mode="json")])
        return tenant_id, repo

    def authenticate_email_tenant(self, *, email: str, password: str) -> tuple[str, TourRepo] | None:
        """Verify email + scrypt password for a multi-tenant workspace."""
        norm_email = email.strip().lower()
        entry = self.root_repo.get_setting(f"tenant_email:{norm_email}")
        if not isinstance(entry, dict) or not is_valid_tenant_id(entry.get("tenant_id")):
            return None
        if not verify_password_scrypt(password, entry.get("password_hash")):
            return None
        tenant_id = str(entry["tenant_id"])
        repo = self.get_repo(tenant_id)
        if repo is None:
            return None
        meta = self.root_repo.get_setting(f"tenant_meta:{tenant_id}")
        if isinstance(meta, dict):
            meta["last_login_at"] = now_iso()
            self.root_repo.set_setting(f"tenant_meta:{tenant_id}", meta)
        return tenant_id, repo

    def list_tenant_metas(self) -> list[dict[str, Any]]:
        """List all tenant_meta:* records from root_repo (sorted newest login first)."""
        lister = getattr(self.root_repo, "list_settings_prefix", None)
        if not callable(lister):
            return []
        raw_map = lister("tenant_meta:")
        metas: list[dict[str, Any]] = []
        for key, val in raw_map.items():
            if isinstance(val, dict):
                tid = str(val.get("tenant_id") or key.removeprefix("tenant_meta:"))
                if is_valid_tenant_id(tid):
                    metas.append({**val, "tenant_id": tid})
        metas.sort(key=lambda m: str(m.get("last_login_at") or m.get("created_at") or ""), reverse=True)
        return metas

    def close_all(self) -> None:
        with self._lock:
            for repo in self._cache.values():
                if hasattr(repo, "close"):
                    try:
                        repo.close()
                    except Exception:
                        pass
            self._cache.clear()


# ---- Hosted Fair-Use Quotas ----
def _utc_today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _effective_limits(repo: TourRepo, settings: Settings) -> tuple[str, int, int, int]:
    overrides = repo.get_setting("hosted_overrides", {})
    if not isinstance(overrides, dict):
        overrides = {}
    plan = str(overrides.get("plan") or settings.hosted_plan_name).strip() or settings.hosted_plan_name
    ai_limit = (
        int(overrides["ai_daily_limit"])
        if overrides.get("ai_daily_limit") is not None
        else settings.hosted_ai_daily_limit
    )
    max_gigs = (
        int(overrides["max_gigs"])
        if overrides.get("max_gigs") is not None
        else settings.hosted_max_gigs
    )
    max_files_mb = (
        int(overrides["max_files_mb"])
        if overrides.get("max_files_mb") is not None
        else settings.hosted_max_files_mb
    )
    return plan, max(0, ai_limit), max(0, max_gigs), max(0, max_files_mb)


def get_hosted_usage(repo: TourRepo, settings: Settings) -> dict[str, Any]:
    raw = repo.get_setting("hosted_usage", {})
    today = _utc_today()
    ai_used = int(raw.get("ai_count", 0)) if isinstance(raw, dict) and raw.get("ai_date") == today else 0
    ai_total = int(raw.get("ai_total", ai_used)) if isinstance(raw, dict) else ai_used
    gigs_count = len(repo.list_gigs())
    total_bytes = sum(max(0, int(f.size or 0)) for f in repo.list_files())
    storage_mb = round(total_bytes / (1024 * 1024), 2)
    plan, ai_daily_limit, max_gigs, max_files_mb = _effective_limits(repo, settings)
    return {
        "plan": plan,
        "ai_used_today": ai_used,
        "ai_total": ai_total,
        "ai_daily_limit": ai_daily_limit,
        "gigs_count": gigs_count,
        "max_gigs": max_gigs,
        "storage_mb": storage_mb,
        "max_files_mb": max_files_mb,
    }


def check_hosted_ai_quota(repo: TourRepo, settings: Settings) -> tuple[bool, int, int]:
    """Return `(allowed, used_today, daily_limit)` for hosted Gemini usage."""
    _, daily_limit, _, _ = _effective_limits(repo, settings)
    if settings.tenancy_mode != "multi" or daily_limit <= 0:
        return True, 0, daily_limit
    raw = repo.get_setting("hosted_usage", {})
    today = _utc_today()
    used = int(raw.get("ai_count", 0)) if isinstance(raw, dict) and raw.get("ai_date") == today else 0
    return used < daily_limit, used, daily_limit


def record_hosted_ai_use(repo: TourRepo) -> int:
    today = _utc_today()
    raw = repo.get_setting("hosted_usage", {})
    prev = int(raw.get("ai_count", 0)) if isinstance(raw, dict) and raw.get("ai_date") == today else 0
    prev_total = int(raw.get("ai_total", prev)) if isinstance(raw, dict) else prev
    nxt = prev + 1
    repo.set_setting(
        "hosted_usage",
        {"ai_date": today, "ai_count": nxt, "ai_total": prev_total + 1, "updated_at": now_iso()},
    )
    return nxt


def reset_hosted_ai_today(repo: TourRepo) -> None:
    today = _utc_today()
    raw = repo.get_setting("hosted_usage", {})
    prev_total = int(raw.get("ai_total", 0)) if isinstance(raw, dict) else 0
    repo.set_setting(
        "hosted_usage",
        {"ai_date": today, "ai_count": 0, "ai_total": prev_total, "updated_at": now_iso()},
    )
