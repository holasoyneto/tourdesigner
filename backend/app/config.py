"""Runtime configuration for Tour Designer (environment-driven, zero secrets in code)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "tour-designer"
    env: Literal["local", "staging", "prod"] = "local"

    # Deployment & multi-tenant hosting
    # - "single": dedicated single-team workspace (self-hosted or private team domain)
    # - "multi": public SaaS mode with isolated per-account workspaces via Google Sign-In
    tenancy_mode: Literal["single", "multi"] = "single"
    base_path: str = ""  # Optional subpath prefix, e.g. "/tourdesigner"
    public_origin: str = ""  # Optional canonical origin, e.g. "https://example.com"

    # Google OAuth 2.0 / OIDC (Sign up & Sign in with Google)
    google_oauth_client_id: str = ""
    google_oauth_client_secret: str = ""

    # Hosted fair-use quotas & cost guardrails (enforced when tenancy_mode="multi"; 0 = unlimited)
    hosted_plan_name: str = "Free Beta"
    hosted_ai_model: str = "gemini-4-hydrogen"
    hosted_ai_thinking_level: str = "low"  # Lowest supported thinking level on Gemini 4 Hydrogen (avoids default "high")
    hosted_ai_daily_limit: int = 20
    hosted_ai_max_input_chars: int = 12000
    hosted_ai_max_output_tokens: int = 2048
    hosted_max_gigs: int = 200
    hosted_max_files_mb: int = 250

    # Community sharing & optional Bitcoin tip jar (active in hosted beta or when configured)
    community_share_enabled: bool = True
    community_share_milestone_gigs: int = 7
    community_share_url: str = ""
    bitcoin_donation_address: str = ""
    bitcoin_lightning_address: str = ""
    landing_video_url: str = ""
    share_footer_branding: bool = False
    interest_notify_webhook_url: str = ""
    interest_notify_email: str = ""

    # Legal & Privacy Notice metadata (US CCPA/CPRA/COPPA & Mexico LFPDPPP / ARCO)
    legal_operator_name: str = "Tour Designer"
    legal_contact_email: str = "privacy@example.com"
    legal_operator_address: str = "United States & Mexico"
    legal_effective_date: str = "2026-11-25"

    # Storage backend:
    # - "firestore": GCP Firestore Native Mode (Always-Free tier, Cloud Run prod)
    # - "sqlite": Normalized relational SQLite for zero-config local dev & tests
    repo_backend: Literal["firestore", "sqlite"] = "sqlite"
    local_db_path: str = "data/tour-designer-v2.sqlite3"
    firestore_project: str | None = None
    firestore_database: str = "(default)"
    firestore_prefix: str = ""  # Optional collection prefix for staging isolation

    # Auth
    basic_auth_user: str = "owner"
    basic_auth_password: str = ""  # Empty => open local single-user dev mode on loopback
    owner_name: str = "Tour Manager"
    owner_email: str = "owner@example.com"
    artist_name: str = ""  # Optional primary artist name for lineup matching
    session_cookie_name: str = "td_session"
    session_ttl_days: int = 30
    device_session_ttl_days: int = 365
    cors_origins: str = ""

    # File vault (GCS signed URLs in prod; local dir in dev)
    file_storage_backend: Literal["local", "gcs"] = "local"
    file_vault_local_path: str = "data/vault"
    file_vault_bucket: str = ""
    drive_root_folder_id: str = ""
    drive_mirror_enabled: bool = False

    # External integrations (all optional, graceful degradation locally)
    vertex_project: str = ""
    vertex_location: str = "global"
    vertex_model: str = "gemini-4-hydrogen"
    gemini_api_key: str = ""
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    flightaware_api_key: str = ""
    aerodatabox_api_key: str = ""
    digest_cron_token: str = ""
    # Optional AI model deprecation alerts (triggered by /api/cron/check-ai-model or HTTP 404/410)
    model_alert_email: str = ""
    model_alert_webhook_url: str = ""
    resend_api_key: str = ""
    alert_from_email: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    public_recipients_token: str = ""
    public_gigs_url: str = ""  # Optional public gigs JSON feed for /api/tour-page-diff
    artist_digest_email: str = ""
    calendar_sync_calendar_id: str = ""
    static_dir: str = str(Path(__file__).resolve().parent.parent / "static")

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def normalized_base_path(self) -> str:
        bp = (self.base_path or "").strip()
        if not bp or bp == "/":
            return ""
        return "/" + bp.strip("/")

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_oauth_client_id.strip() and self.google_oauth_client_secret.strip())

    @property
    def auth_enforced(self) -> bool:
        return bool(self.basic_auth_password.strip() or self.tenancy_mode == "multi" or self.google_oauth_enabled)


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
