"""Future-proof Google AI model discovery & runtime intake settings.

Allows owners to switch Google AI intake models dynamically in Settings based on
whichever Gemini models Google offers at that moment (via live Gemini API or
Vertex AI Model Garden discovery), or enter any custom model ID directly.
"""

from __future__ import annotations

import asyncio
import re
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.domain.models import now_iso
from app.repo.protocol import TourRepo

AI_SETTINGS_KEY = "ai_intake"
AI_MODEL_ALERT_KEY = "ai_model_alert"
VALID_PROVIDERS = ("auto", "vertex", "gemini", "anthropic", "openai", "local")
DEFAULT_MODEL = "gemini-4-hydrogen"
DEFAULT_PROVIDER_MODELS: dict[str, str] = {
    "vertex": "gemini-4-hydrogen",
    "gemini": "gemini-4-hydrogen",
    "anthropic": "claude-sonnet-5-5",
    "openai": "gpt-6.2-astra",
}

# Fallback starter catalog shown only when offline or before Google creds are added.
# Live Google API discovery always supersedes this list whenever credentials are available.
_FALLBACK_MODELS: list[dict[str, Any]] = [
    {
        "id": "gemini-4-hydrogen",
        "display_name": "Gemini 4 Hydrogen",
        "description": "Fast, cost-efficient Gemini 4 workhorse for structured tour itinerary extraction.",
        "recommended": True,
        "provider": "google",
    },
    {
        "id": "gemini-4-neon",
        "display_name": "Gemini 4 Neon",
        "description": "Balanced Gemini 4 intelligence for complex multi-day schedules & promoter threads.",
        "recommended": False,
        "provider": "google",
    },
    {
        "id": "gemini-4-carbon",
        "display_name": "Gemini 4 Carbon",
        "description": "Frontier Gemini 4 reasoning for dense riders, contracts & multi-artist advancing.",
        "recommended": False,
        "provider": "google",
    },
    {
        "id": "gemini-4-argon",
        "display_name": "Gemini 4 Argon",
        "description": "Enterprise frontier Gemini 4 model for deep long-horizon workflows.",
        "recommended": False,
        "provider": "google",
    },
    {
        "id": "gemini-3.5-flash-lite",
        "display_name": "Gemini 3.5 Flash-Lite",
        "description": "Ultra-low-cost legacy Flash-Lite model for high-volume email & WhatsApp pastes.",
        "recommended": False,
        "provider": "google",
    },
]

_FALLBACK_ANTHROPIC_MODELS: list[dict[str, Any]] = [
    {
        "id": "claude-sonnet-5-5",
        "display_name": "Claude Sonnet 5.5",
        "description": "Recommended Anthropic model (Sonnet 5.5 or better) for accurate itinerary & rider extraction.",
        "recommended": True,
        "provider": "anthropic",
    },
    {
        "id": "claude-opus-5-5",
        "display_name": "Claude Opus 5.5",
        "description": "Flagship Anthropic reasoning model for dense contracts & complex advancing threads.",
        "recommended": False,
        "provider": "anthropic",
    },
    {
        "id": "claude-sonnet-5",
        "display_name": "Claude Sonnet 5",
        "description": "Fast Sonnet 5 generation model for tour logistics extraction.",
        "recommended": False,
        "provider": "anthropic",
    },
]

_FALLBACK_OPENAI_MODELS: list[dict[str, Any]] = [
    {
        "id": "gpt-6.2-astra",
        "display_name": "GPT-6.2 Astra",
        "description": "Recommended OpenAI model (Astra or superior) for structured tour-logistics extraction.",
        "recommended": True,
        "provider": "openai",
    },
    {
        "id": "gpt-6.2-astra-pro",
        "display_name": "GPT-6.2 Astra Pro",
        "description": "High-reasoning Astra Pro model for complex multi-day schedules & riders.",
        "recommended": False,
        "provider": "openai",
    },
    {
        "id": "gpt-6-astra",
        "display_name": "GPT-6 Astra",
        "description": "Base GPT-6 Astra model for fast structured extraction.",
        "recommended": False,
        "provider": "openai",
    },
]

_EXCLUDE_MODEL_TOKENS = (
    "embedding",
    "aqa",
    "imagen",
    "veo",
    "chirp",
    "lyria",
    "tts",
    "robotics",
    "computer-use",
    "audio-only",
    "bison",
    "gecko",
    "unicorn",
    "learnlm",
    "gemma",
)

_VER_RE = re.compile(r"gemini-(\d+)(?:\.(\d+))?")
_CLAUDE_VER_RE = re.compile(r"(\d+)[.-](\d+)|\b(\d+)\b")
_OPENAI_VER_RE = re.compile(r"gpt-(\d+)(?:\.(\d+))?")
_OPENAI_EXCLUDE_TOKENS = (
    "embedding",
    "whisper",
    "tts",
    "dall-e",
    "moderation",
    "audio",
    "realtime",
    "transcribe",
    "image",
    "sora",
    "search",
    "babbage",
    "davinci",
    "curie",
    "ada",
    "instruct",
)


def _mask_secret(value: str) -> str:
    k = value.strip()
    if not k:
        return ""
    if len(k) <= 8:
        return "••••"
    return f"{k[:4]}…{k[-4:]}"


def _model_matches_provider(model_id: str, provider: str) -> bool:
    low = (model_id or "").lower()
    if provider == "anthropic":
        return "claude" in low
    if provider == "openai":
        return any(low.startswith(p) for p in ("gpt-", "o1", "o3", "o4", "o5", "astra")) or "astra" in low
    if provider in {"vertex", "gemini"}:
        return low.startswith("gemini")
    return True


@dataclass(slots=True)
class ResolvedAIConfig:
    provider: str  # "auto" | "vertex" | "gemini" | "anthropic" | "openai" | "local"
    effective_provider: str  # "vertex" | "gemini" | "anthropic" | "openai" | "local"
    model: str
    vertex_project: str
    vertex_project_source: str  # "settings" | "env" | "none"
    vertex_location: str
    gemini_api_key: str
    gemini_api_key_source: str  # "settings" | "env" | "none"
    anthropic_api_key: str = ""
    anthropic_api_key_source: str = "none"  # "settings" | "env" | "none"
    openai_api_key: str = ""
    openai_api_key_source: str = "none"  # "settings" | "env" | "none"
    hosted_locked: bool = False
    hosted_model: str = ""
    hosted_thinking_level: str = ""
    updated_at: str | None = None

    def masked_key_hint(self) -> str:
        return _mask_secret(self.gemini_api_key)

    def to_public_dict(self) -> dict[str, Any]:
        # In hosted multi-tenant mode, never expose the host's GCP project or server key hints
        is_hosted = self.hosted_locked or self.hosted_model != ""
        hide_gemini = is_hosted and self.gemini_api_key_source != "settings"
        hide_anthropic = is_hosted and self.anthropic_api_key_source != "settings"
        hide_openai = is_hosted and self.openai_api_key_source != "settings"
        return {
            "provider": self.provider,
            "effective_provider": self.effective_provider,
            "model": self.model,
            "vertex_project": "" if is_hosted else self.vertex_project,
            "vertex_project_source": "none" if is_hosted else self.vertex_project_source,
            "vertex_location": "" if is_hosted else self.vertex_location,
            "gemini_api_key_configured": False if hide_gemini else bool(self.gemini_api_key),
            "gemini_api_key_source": "none" if hide_gemini else self.gemini_api_key_source,
            "gemini_api_key_hint": "" if hide_gemini else _mask_secret(self.gemini_api_key),
            "anthropic_api_key_configured": False if hide_anthropic else bool(self.anthropic_api_key),
            "anthropic_api_key_source": "none" if hide_anthropic else self.anthropic_api_key_source,
            "anthropic_api_key_hint": "" if hide_anthropic else _mask_secret(self.anthropic_api_key),
            "openai_api_key_configured": False if hide_openai else bool(self.openai_api_key),
            "openai_api_key_source": "none" if hide_openai else self.openai_api_key_source,
            "openai_api_key_hint": "" if hide_openai else _mask_secret(self.openai_api_key),
            "hosted_locked": self.hosted_locked,
            "hosted_model": self.hosted_model,
            "hosted_thinking_level": self.hosted_thinking_level,
            "updated_at": self.updated_at,
        }

    def to_member_status(self) -> dict[str, Any]:
        return {
            "provider": self.effective_provider,
            "configured_provider": self.provider,
            "model": self.model if self.effective_provider != "local" else "deterministic",
            "google_connected": self.effective_provider in {"vertex", "gemini"},
            "ai_connected": self.effective_provider in {"vertex", "gemini", "anthropic", "openai"},
            "hosted_locked": self.hosted_locked,
        }


def resolve_ai_config(repo: TourRepo | None = None, settings: Settings | None = None) -> ResolvedAIConfig:
    """Resolve live AI intake config (saved repo setting overrides env defaults).

    In multi-tenant hosted mode (`TENANCY_MODE=multi`), tenants without their own BYOK
    API key (Gemini, Anthropic, or OpenAI) are hardlocked to `HOSTED_AI_MODEL`
    (default: `gemini-4-hydrogen` at `thinkingLevel=low`) so hosted AI costs stay
    predictable while still allowing ARCO opt-out to `local` or BYOK unlock with their own key.
    """
    env = settings or get_settings()
    saved: dict[str, Any] = {}
    if repo is not None:
        raw = repo.get_setting(AI_SETTINGS_KEY, {})
        if isinstance(raw, dict):
            saved = raw

    saved_gemini = str(saved.get("gemini_api_key") or "").strip()
    saved_anthropic = str(saved.get("anthropic_api_key") or "").strip()
    saved_openai = str(saved.get("openai_api_key") or "").strip()
    has_byok = bool(saved_gemini or saved_anthropic or saved_openai)

    is_multi = env.tenancy_mode == "multi"
    hosted_model = (env.hosted_ai_model or "gemini-4-hydrogen").strip()
    hosted_thinking = (env.hosted_ai_thinking_level or "low").strip()

    if is_multi and not has_byok:
        raw_prov = str(saved.get("provider") or "auto").strip().lower()
        provider = "local" if raw_prov == "local" else "auto"
        env_proj = (env.vertex_project or "").strip()
        env_key = (env.gemini_api_key or "").strip()
        if provider == "local":
            effective = "local"
        elif env_proj:
            effective = "vertex"
        elif env_key:
            effective = "gemini"
        else:
            effective = "local"
        return ResolvedAIConfig(
            provider=provider,
            effective_provider=effective,
            model=hosted_model,
            vertex_project=env_proj,
            vertex_project_source="env" if env_proj else "none",
            vertex_location=(env.vertex_location or "global").strip() or "global",
            gemini_api_key=env_key,
            gemini_api_key_source="env" if env_key else "none",
            hosted_locked=True,
            hosted_model=hosted_model,
            hosted_thinking_level=hosted_thinking,
            updated_at=saved.get("updated_at") if isinstance(saved.get("updated_at"), str) else None,
        )

    default_byok_provider = (
        "gemini"
        if saved_gemini
        else "anthropic"
        if saved_anthropic
        else "openai"
        if saved_openai
        else "auto"
    )
    provider = str(saved.get("provider") or (default_byok_provider if is_multi else "auto")).strip().lower()
    if provider not in VALID_PROVIDERS:
        provider = "auto"

    saved_proj = "" if is_multi else str(saved.get("vertex_project") or "").strip()
    env_proj = "" if is_multi else (env.vertex_project or "").strip()
    if saved_proj:
        vertex_project, proj_src = saved_proj, "settings"
    elif env_proj:
        vertex_project, proj_src = env_proj, "env"
    else:
        vertex_project, proj_src = "", "none"

    vertex_location = str(saved.get("vertex_location") or env.vertex_location or "global").strip() or "global"

    env_gemini = "" if is_multi else (env.gemini_api_key or "").strip()
    if saved_gemini:
        gemini_api_key, gemini_src = saved_gemini, "settings"
    elif env_gemini:
        gemini_api_key, gemini_src = env_gemini, "env"
    else:
        gemini_api_key, gemini_src = "", "none"

    env_anthropic = "" if is_multi else (env.anthropic_api_key or "").strip()
    if saved_anthropic:
        anthropic_api_key, anthropic_src = saved_anthropic, "settings"
    elif env_anthropic:
        anthropic_api_key, anthropic_src = env_anthropic, "env"
    else:
        anthropic_api_key, anthropic_src = "", "none"

    env_openai = "" if is_multi else (env.openai_api_key or "").strip()
    if saved_openai:
        openai_api_key, openai_src = saved_openai, "settings"
    elif env_openai:
        openai_api_key, openai_src = env_openai, "env"
    else:
        openai_api_key, openai_src = "", "none"

    if provider == "local":
        effective = "local"
    elif provider == "vertex":
        effective = "vertex" if vertex_project else "local"
    elif provider == "gemini":
        effective = "gemini" if gemini_api_key else "local"
    elif provider == "anthropic":
        effective = "anthropic" if anthropic_api_key else "local"
    elif provider == "openai":
        effective = "openai" if openai_api_key else "local"
    else:  # auto
        if vertex_project:
            effective = "vertex"
        elif gemini_api_key:
            effective = "gemini"
        elif anthropic_api_key:
            effective = "anthropic"
        elif openai_api_key:
            effective = "openai"
        else:
            effective = "local"

    saved_model = str(saved.get("model") or "").strip()
    if saved_model and _model_matches_provider(saved_model, effective):
        model = saved_model
    elif effective in DEFAULT_PROVIDER_MODELS:
        model = (
            (env.vertex_model or DEFAULT_MODEL).strip()
            if effective in {"vertex", "gemini"}
            else DEFAULT_PROVIDER_MODELS[effective]
        )
    else:
        model = saved_model or (env.vertex_model or DEFAULT_MODEL).strip() or DEFAULT_MODEL

    return ResolvedAIConfig(
        provider=provider,
        effective_provider=effective,
        model=model,
        vertex_project=vertex_project,
        vertex_project_source=proj_src,
        vertex_location=vertex_location,
        gemini_api_key=gemini_api_key,
        gemini_api_key_source=gemini_src,
        anthropic_api_key=anthropic_api_key,
        anthropic_api_key_source=anthropic_src,
        openai_api_key=openai_api_key,
        openai_api_key_source=openai_src,
        hosted_locked=False,
        hosted_model=hosted_model if is_multi else "",
        updated_at=saved.get("updated_at") if isinstance(saved.get("updated_at"), str) else None,
    )


def save_ai_config(
    repo: TourRepo,
    patch: dict[str, Any],
    settings: Settings | None = None,
) -> ResolvedAIConfig:
    """Persist partial AI intake config updates safely (preserving stored secrets unless replaced/cleared)."""
    env = settings or get_settings()
    existing = repo.get_setting(AI_SETTINGS_KEY, {})
    current: dict[str, Any] = dict(existing) if isinstance(existing, dict) else {}

    newly_added_provider: str | None = None
    for field, clear_flag, prov_name in (
        ("gemini_api_key", "clear_gemini_api_key", "gemini"),
        ("anthropic_api_key", "clear_anthropic_api_key", "anthropic"),
        ("openai_api_key", "clear_openai_api_key", "openai"),
    ):
        if patch.get(clear_flag):
            current.pop(field, None)
        elif field in patch:
            new_key = str(patch[field] or "").strip()
            if new_key:
                current[field] = new_key
                newly_added_provider = prov_name

    is_multi = env.tenancy_mode == "multi"
    has_byok = bool(
        str(current.get("gemini_api_key") or "").strip()
        or str(current.get("anthropic_api_key") or "").strip()
        or str(current.get("openai_api_key") or "").strip()
    )
    hosted_model = (env.hosted_ai_model or "gemini-4-hydrogen").strip()

    if is_multi and not has_byok:
        # Hardlocked hosted Free Beta: allow only "auto" (hosted) or "local" (opt-out)
        if "provider" in patch:
            prov = str(patch["provider"] or "auto").strip().lower()
            if prov not in {"auto", "local"}:
                raise PermissionError("hosted_model_locked")
            current["provider"] = prov
        if "model" in patch:
            req_model = str(patch["model"] or "").strip()
            if req_model.startswith("models/"):
                req_model = req_model[len("models/") :]
            if req_model and req_model != hosted_model:
                raise PermissionError("hosted_model_locked")
        current["provider"] = "local" if current.get("provider") == "local" else "auto"
        current["model"] = hosted_model
        current.pop("vertex_project", None)
        current.pop("vertex_location", None)
        current["updated_at"] = now_iso()
        repo.set_setting(AI_SETTINGS_KEY, current)
        return resolve_ai_config(repo, settings=env)

    if "provider" in patch:
        prov = str(patch["provider"] or "auto").strip().lower()
        if prov not in VALID_PROVIDERS:
            raise ValueError("invalid_provider")
        if is_multi and prov == "vertex":
            raise PermissionError("hosted_vertex_not_allowed")
        # If the user just pasted a brand-new provider key while still on "auto", switch directly to that provider
        if newly_added_provider and prov == "auto":
            current["provider"] = newly_added_provider
        else:
            current["provider"] = prov
    elif newly_added_provider:
        current["provider"] = newly_added_provider
    elif is_multi and has_byok and current.get("provider") not in {"gemini", "anthropic", "openai", "local"}:
        if current.get("gemini_api_key"):
            current["provider"] = "gemini"
        elif current.get("anthropic_api_key"):
            current["provider"] = "anthropic"
        else:
            current["provider"] = "openai"

    if "model" in patch:
        model = str(patch["model"] or "").strip()
        if not model:
            raise ValueError("model_required")
        if len(model) > 120 or not re.fullmatch(r"[A-Za-z0-9._:/-]+", model):
            raise ValueError("invalid_model_id")
        if model.startswith("models/"):
            model = model[len("models/") :]
        # If user just added an Anthropic/OpenAI key and the form sent the old Gemini model, auto-pick recommended model
        target_prov = str(current.get("provider") or "auto")
        if newly_added_provider and target_prov == newly_added_provider and not _model_matches_provider(model, newly_added_provider):
            current["model"] = DEFAULT_PROVIDER_MODELS.get(newly_added_provider, model)
        else:
            current["model"] = model
    elif newly_added_provider and not _model_matches_provider(str(current.get("model") or ""), newly_added_provider):
        current["model"] = DEFAULT_PROVIDER_MODELS.get(newly_added_provider, DEFAULT_MODEL)

    if not is_multi:
        if "vertex_project" in patch:
            proj = str(patch["vertex_project"] or "").strip()
            if proj and not re.fullmatch(r"[a-zA-Z0-9._:-]{1,128}", proj):
                raise ValueError("invalid_vertex_project")
            current["vertex_project"] = proj

        if "vertex_location" in patch:
            loc = str(patch["vertex_location"] or "global").strip() or "global"
            if not re.fullmatch(r"[a-z0-9-]{2,40}", loc):
                raise ValueError("invalid_vertex_location")
            current["vertex_location"] = loc

    current["updated_at"] = now_iso()
    repo.set_setting(AI_SETTINGS_KEY, current)
    clear_model_deprecation_alert(repo)
    return resolve_ai_config(repo, settings=env)


def _model_sort_key(item: dict[str, Any]) -> tuple[int, int, int, int, str]:
    """Rank newest stable workhorse models first (Gemini 4 Hydrogen -> Neon -> Carbon -> Argon, then Flash -> Pro)."""
    mid = str(item.get("id") or "").lower()
    m = _VER_RE.search(mid)
    major = int(m.group(1)) if m else 0
    minor = int(m.group(2) or 0) if m else 0
    is_preview = 1 if any(t in mid for t in ("preview", "exp", "experimental", "001", "latest")) else 0
    if "hydrogen" in mid:
        tier = 0
    elif "neon" in mid:
        tier = 1
    elif "carbon" in mid:
        tier = 2
    elif "argon" in mid:
        tier = 3
    elif "flash-lite" in mid or "flash_lite" in mid:
        tier = 4
    elif "flash" in mid:
        tier = 0
    elif "pro" in mid:
        tier = 1
    else:
        tier = 5
    return (-major, -minor, is_preview, tier, mid)


def _is_intake_capable_gemini_model(model_id: str, methods: list[str] | None = None) -> bool:
    low = model_id.lower()
    if not low.startswith("gemini"):
        return False
    if any(tok in low for tok in _EXCLUDE_MODEL_TOKENS):
        return False
    if methods is not None and "generateContent" not in methods:
        return False
    return True


def _normalize_models(raw_models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    dedup: dict[str, dict[str, Any]] = {}
    for m in raw_models:
        mid = str(m.get("id") or "").strip()
        if not mid:
            continue
        dedup[mid] = m
    ordered = sorted(dedup.values(), key=_model_sort_key)
    for idx, m in enumerate(ordered):
        m["recommended"] = idx == 0
    return ordered


async def _fetch_gemini_api_models(api_key: str) -> list[dict[str, Any]]:
    url = "https://generativelanguage.googleapis.com/v1beta/models"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            params={"pageSize": 100},
            headers={"x-goog-api-key": api_key},
        )
        resp.raise_for_status()
        payload = resp.json()
    out: list[dict[str, Any]] = []
    for entry in payload.get("models") or []:
        name = str(entry.get("name") or "")
        mid = name[len("models/") :] if name.startswith("models/") else name
        methods = entry.get("supportedGenerationMethods")
        if not _is_intake_capable_gemini_model(mid, methods if isinstance(methods, list) else None):
            continue
        out.append(
            {
                "id": mid,
                "display_name": str(entry.get("displayName") or mid),
                "description": str(entry.get("description") or "").strip(),
                "input_token_limit": entry.get("inputTokenLimit"),
                "output_token_limit": entry.get("outputTokenLimit"),
                "provider": "gemini",
            }
        )
    return _normalize_models(out)


async def _fetch_vertex_models(project: str, location: str) -> list[dict[str, Any]]:
    import google.auth
    import google.auth.transport.requests

    creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(google.auth.transport.requests.Request())
    loc = location or "global"
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    headers = {
        "Authorization": f"Bearer {creds.token}",
        "X-Goog-User-Project": project,
    }
    urls = [
        f"https://{host}/v1beta1/publishers/google/models",
        f"https://{host}/v1beta1/projects/{project}/locations/{loc}/publishers/google/models",
    ]
    raw_entries: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=10.0) as client:
        last_err: Exception | None = None
        for url in urls:
            try:
                resp = await client.get(url, params={"pageSize": 100}, headers=headers)
                resp.raise_for_status()
                body = resp.json()
                entries = body.get("publisherModels") or body.get("models") or []
                if entries:
                    raw_entries = entries
                    break
            except Exception as exc:
                last_err = exc
        if not raw_entries and last_err is not None:
            raise last_err

    out: list[dict[str, Any]] = []
    for entry in raw_entries:
        name = str(entry.get("name") or "")
        mid = name.rsplit("/", 1)[-1] if "/" in name else name
        # Vertex model names sometimes include "@001" suffix
        mid = mid.split("@", 1)[0]
        if not _is_intake_capable_gemini_model(mid):
            continue
        display = str(entry.get("displayName") or mid.replace("-", " ").title())
        out.append(
            {
                "id": mid,
                "display_name": display,
                "description": str(entry.get("description") or "").strip(),
                "provider": "vertex",
            }
        )
    return _normalize_models(out)


def _anthropic_sort_key(item: dict[str, Any]) -> tuple[int, int, int, int, str]:
    """Rank newest Anthropic Sonnet 5.5+ / Opus 5.5+ first, preferring Sonnet for fast structured extraction."""
    mid = str(item.get("id") or "").lower()
    # Extract version like "5-5", "5.5", "6-0", "5"
    m = _CLAUDE_VER_RE.search(mid)
    if m:
        major = int(m.group(1) or m.group(3) or 0)
        minor = int(m.group(2) or 0)
    else:
        major, minor = 0, 0
    # Prefer Sonnet >= 5.5 (or newer major >= 6), then Opus, then Haiku
    is_sonnet = "sonnet" in mid
    is_opus = "opus" in mid
    is_haiku = "haiku" in mid
    meets_floor = (major > 5) or (major == 5 and minor >= 5)
    if is_sonnet and meets_floor:
        tier = 0
    elif is_opus and meets_floor:
        tier = 1
    elif is_sonnet:
        tier = 2
    elif is_opus:
        tier = 3
    elif is_haiku:
        tier = 4
    else:
        tier = 5
    # Prefer non-dated alias over dated snapshots when same major/minor/tier
    has_date = 1 if re.search(r"20\d{6}", mid) else 0
    return (tier, -major, -minor, has_date, mid)


async def _fetch_anthropic_models(api_key: str) -> list[dict[str, Any]]:
    url = "https://api.anthropic.com/v1/models"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            params={"limit": 100},
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        resp.raise_for_status()
        body = resp.json()
    out: list[dict[str, Any]] = []
    for entry in body.get("data") or []:
        mid = str(entry.get("id") or "").strip()
        if not mid or "claude" not in mid.lower():
            continue
        out.append(
            {
                "id": mid,
                "display_name": str(entry.get("display_name") or mid),
                "description": "",
                "provider": "anthropic",
            }
        )
    dedup = {m["id"]: m for m in out}
    ordered = sorted(dedup.values(), key=_anthropic_sort_key)
    for idx, m in enumerate(ordered):
        m["recommended"] = idx == 0
    return ordered


def _openai_sort_key(item: dict[str, Any]) -> tuple[int, int, int, int, str]:
    """Rank newest OpenAI Astra or superior frontier models first."""
    mid = str(item.get("id") or "").lower()
    m = _OPENAI_VER_RE.search(mid)
    major = int(m.group(1)) if m else 0
    minor = int(m.group(2) or 0) if m else 0
    is_astra = "astra" in mid
    is_superior = major >= 7 or (major == 6 and is_astra)
    is_pro = "pro" in mid
    is_mini = "mini" in mid or "nano" in mid
    has_date = 1 if re.search(r"20\d{2}-\d{2}-\d{2}", mid) else 0
    if is_superior and not is_pro and not is_mini:
        tier = 0
    elif is_superior and is_pro:
        tier = 1
    elif is_astra:
        tier = 2
    elif major >= 5:
        tier = 3
    else:
        tier = 4
    return (tier, -major, -minor, has_date, mid)


def _is_intake_capable_openai_model(model_id: str) -> bool:
    low = model_id.lower()
    if any(tok in low for tok in _OPENAI_EXCLUDE_TOKENS):
        return False
    return low.startswith(("gpt-", "o1", "o3", "o4", "o5", "astra")) or "astra" in low


async def _fetch_openai_models(api_key: str) -> list[dict[str, Any]]:
    url = "https://api.openai.com/v1/models"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(
            url,
            headers={"Authorization": f"Bearer {api_key}"},
        )
        resp.raise_for_status()
        body = resp.json()
    out: list[dict[str, Any]] = []
    for entry in body.get("data") or []:
        mid = str(entry.get("id") or "").strip()
        if not mid or not _is_intake_capable_openai_model(mid):
            continue
        out.append(
            {
                "id": mid,
                "display_name": mid,
                "description": "",
                "provider": "openai",
            }
        )
    dedup = {m["id"]: m for m in out}
    ordered = sorted(dedup.values(), key=_openai_sort_key)
    for idx, m in enumerate(ordered):
        m["recommended"] = idx == 0
    return ordered


async def fetch_google_models(
    cfg: ResolvedAIConfig,
    *,
    provider_override: str | None = None,
) -> dict[str, Any]:
    """Query the active provider's live model catalog (Google, Anthropic, or OpenAI), falling back gracefully if offline/unconfigured."""
    target = (provider_override or cfg.effective_provider or "auto").strip().lower()
    if target == "auto":
        target = cfg.effective_provider

    fetched_at = now_iso()
    errors: list[str] = []

    if target == "anthropic":
        if cfg.anthropic_api_key:
            try:
                models = await _fetch_anthropic_models(cfg.anthropic_api_key)
                if models:
                    return {
                        "models": models,
                        "source": "live_anthropic",
                        "provider_queried": "anthropic",
                        "fetched_at": fetched_at,
                        "note": None,
                    }
            except Exception as exc:
                errors.append(f"Anthropic API: {exc}")
        fallback = [dict(m) for m in _FALLBACK_ANTHROPIC_MODELS]
        if cfg.model and _model_matches_provider(cfg.model, "anthropic") and not any(m["id"] == cfg.model for m in fallback):
            fallback.insert(0, {"id": cfg.model, "display_name": cfg.model, "description": "Active custom Anthropic model ID.", "recommended": False, "provider": "anthropic"})
        return {
            "models": fallback,
            "source": "fallback_catalog",
            "provider_queried": "anthropic",
            "fetched_at": fetched_at,
            "note": "; ".join(errors) if errors else "Add your Anthropic API key to load your account's live Claude models (Sonnet 5.5 or better recommended).",
        }

    if target == "openai":
        if cfg.openai_api_key:
            try:
                models = await _fetch_openai_models(cfg.openai_api_key)
                if models:
                    return {
                        "models": models,
                        "source": "live_openai",
                        "provider_queried": "openai",
                        "fetched_at": fetched_at,
                        "note": None,
                    }
            except Exception as exc:
                errors.append(f"OpenAI API: {exc}")
        fallback = [dict(m) for m in _FALLBACK_OPENAI_MODELS]
        if cfg.model and _model_matches_provider(cfg.model, "openai") and not any(m["id"] == cfg.model for m in fallback):
            fallback.insert(0, {"id": cfg.model, "display_name": cfg.model, "description": "Active custom OpenAI model ID.", "recommended": False, "provider": "openai"})
        return {
            "models": fallback,
            "source": "fallback_catalog",
            "provider_queried": "openai",
            "fetched_at": fetched_at,
            "note": "; ".join(errors) if errors else "Add your OpenAI API key to load your account's live models (Astra or superior recommended).",
        }

    if target == "gemini" or (target == "local" and cfg.gemini_api_key):
        if cfg.gemini_api_key:
            try:
                models = await _fetch_gemini_api_models(cfg.gemini_api_key)
                if models:
                    return {
                        "models": models,
                        "source": "live_google",
                        "provider_queried": "gemini",
                        "fetched_at": fetched_at,
                        "note": None,
                    }
            except Exception as exc:
                errors.append(f"Gemini API: {exc}")

    if target == "vertex" or (target in {"auto", "local"} and cfg.vertex_project):
        if cfg.vertex_project:
            try:
                models = await _fetch_vertex_models(cfg.vertex_project, cfg.vertex_location)
                if models:
                    return {
                        "models": models,
                        "source": "live_google",
                        "provider_queried": "vertex",
                        "fetched_at": fetched_at,
                        "note": None,
                    }
            except Exception as exc:
                errors.append(f"Vertex AI: {exc}")

    # If user asked for vertex but also has a Gemini API key, try Gemini catalog to still get live Google models!
    if target == "vertex" and cfg.gemini_api_key:
        try:
            models = await _fetch_gemini_api_models(cfg.gemini_api_key)
            if models:
                return {
                    "models": models,
                    "source": "live_google",
                    "provider_queried": "gemini",
                    "fetched_at": fetched_at,
                    "note": "Loaded live Google catalog via Gemini API key.",
                }
        except Exception as exc:
            errors.append(f"Gemini API: {exc}")

    fallback = [dict(m) for m in _FALLBACK_MODELS]
    # Ensure currently configured custom model is also visible in the list
    if cfg.model and not any(m["id"] == cfg.model for m in fallback):
        fallback.insert(
            0,
            {
                "id": cfg.model,
                "display_name": cfg.model,
                "description": "Currently active custom Google model ID.",
                "recommended": False,
                "provider": "custom",
            },
        )

    note = (
        "; ".join(errors)
        if errors
        else "No live Google credentials configured yet — showing starter catalog. Add a Google Workspace Vertex project or Gemini API key to load live models, or type any model ID directly."
    )
    return {
        "models": fallback,
        "source": "fallback_catalog",
        "provider_queried": target,
        "fetched_at": fetched_at,
        "note": note,
    }


def get_model_deprecation_alert(repo: TourRepo | None) -> dict[str, Any] | None:
    if repo is None:
        return None
    raw = repo.get_setting(AI_MODEL_ALERT_KEY, None)
    return raw if isinstance(raw, dict) and raw.get("model") else None


def record_model_deprecation_alert(
    repo: TourRepo,
    *,
    model: str,
    reason: str,
    recommended_model: str | None = None,
    status_code: int | None = None,
) -> dict[str, Any]:
    alert: dict[str, Any] = {
        "model": model,
        "reason": reason,
        "recommended_model": recommended_model or "",
        "status_code": status_code,
        "detected_at": now_iso(),
    }
    repo.set_setting(AI_MODEL_ALERT_KEY, alert)
    return alert


def clear_model_deprecation_alert(repo: TourRepo) -> None:
    repo.set_setting(AI_MODEL_ALERT_KEY, {})


def _send_smtp_sync(settings: Settings, recipient: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.alert_from_email or settings.smtp_user
    msg["To"] = recipient
    msg["Subject"] = subject
    msg.set_content(body)
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
        server.starttls()
        if settings.smtp_user and settings.smtp_password:
            server.login(settings.smtp_user, settings.smtp_password)
        server.send_message(msg)


async def notify_model_deprecation(
    settings: Settings,
    *,
    current_model: str,
    recommended_model: str,
    reason: str,
) -> list[str]:
    """Notify the operator by email (Resend or SMTP) and/or webhook when an AI model is deprecated."""
    notified: list[str] = []
    recipient = (settings.model_alert_email or settings.owner_email or "").strip()
    env_var = "HOSTED_AI_MODEL" if settings.tenancy_mode == "multi" else "VERTEX_MODEL"
    subject = f"[Tour Designer] AI model deprecated: {current_model} -> {recommended_model}"
    body = (
        f"Tour Designer detected that the configured Google AI model is no longer active.\n\n"
        f"Current model: {current_model}\n"
        f"Recommended replacement: {recommended_model}\n"
        f"Reason: {reason}\n"
        f"Action: Update {env_var}={recommended_model} (or switch in Settings -> AI Intake).\n"
    )

    if settings.resend_api_key.strip() and recipient:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {settings.resend_api_key.strip()}"},
                    json={
                        "from": settings.alert_from_email.strip() or f"Tour Designer <{recipient}>",
                        "to": [recipient],
                        "subject": subject,
                        "text": body,
                    },
                )
                resp.raise_for_status()
            notified.append("resend")
        except Exception:
            pass

    if settings.smtp_host.strip() and recipient and "resend" not in notified:
        try:
            await asyncio.to_thread(_send_smtp_sync, settings, recipient, subject, body)
            notified.append("smtp")
        except Exception:
            pass

    if settings.model_alert_webhook_url.strip():
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    settings.model_alert_webhook_url.strip(),
                    json={
                        "event": "ai_model_deprecated",
                        "current_model": current_model,
                        "recommended_model": recommended_model,
                        "env_patch": f"{env_var}={recommended_model}",
                        "reason": reason,
                        "text": f"{subject}\n{body}",
                    },
                )
                resp.raise_for_status()
            notified.append("webhook")
        except Exception:
            pass

    return notified


async def check_active_model_health(
    repo: TourRepo,
    settings: Settings,
) -> dict[str, Any]:
    """Verify the active/hosted Google AI model against Google's live catalog and alert if sunset."""
    cfg = resolve_ai_config(repo, settings=settings)
    if cfg.effective_provider == "local":
        return {
            "status": "skipped_local",
            "current_model": cfg.model,
            "deprecated": False,
            "recommended_model": None,
            "notified_via": [],
        }

    catalog = await fetch_google_models(cfg)
    if not str(catalog.get("source") or "").startswith("live_"):
        return {
            "status": "unverified",
            "current_model": cfg.model,
            "deprecated": False,
            "recommended_model": None,
            "note": catalog.get("note"),
            "notified_via": [],
        }

    live_ids = [str(m.get("id") or "") for m in (catalog.get("models") or []) if m.get("id")]
    if cfg.model in live_ids:
        clear_model_deprecation_alert(repo)
        return {
            "status": "ok",
            "current_model": cfg.model,
            "deprecated": False,
            "recommended_model": live_ids[0] if live_ids else None,
            "live_count": len(live_ids),
            "notified_via": [],
        }

    recommended = live_ids[0] if live_ids else DEFAULT_PROVIDER_MODELS.get(cfg.effective_provider, DEFAULT_MODEL)
    reason = f"Model '{cfg.model}' is no longer listed in {catalog.get('provider_queried')}'s live catalog."
    alert = record_model_deprecation_alert(
        repo,
        model=cfg.model,
        reason=reason,
        recommended_model=recommended,
    )
    notified_via = await notify_model_deprecation(
        settings,
        current_model=cfg.model,
        recommended_model=recommended,
        reason=reason,
    )
    env_var = "HOSTED_AI_MODEL" if settings.tenancy_mode == "multi" else "VERTEX_MODEL"
    return {
        "status": "deprecated",
        "current_model": cfg.model,
        "deprecated": True,
        "recommended_model": recommended,
        "env_patch": f"{env_var}={recommended}",
        "alert": alert,
        "notified_via": notified_via,
    }
