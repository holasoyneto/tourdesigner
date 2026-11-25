"""Shared API helpers: real HTTP status codes with consistent {ok: true/false} JSON envelopes."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import Settings, get_settings
from app.domain.models import AuditEvent, User
from app.domain.roles import is_member, is_owner
from app.repo.protocol import ActorContext, TourRepo


def ok(**payload: Any) -> JSONResponse:
    return JSONResponse({"ok": True, **payload}, status_code=200)


def created(**payload: Any) -> JSONResponse:
    return JSONResponse({"ok": True, **payload}, status_code=201)


def err(code: str, status: int = 400, **extra: Any) -> JSONResponse:
    return JSONResponse({"ok": False, "error": code, **extra}, status_code=status)


def get_repo(request: Request) -> TourRepo:
    return getattr(request.state, "repo", None) or request.app.state.repo


def get_tenant_id(request: Request) -> str | None:
    return getattr(request.state, "tenant_id", None)


def get_app_settings(request: Request) -> Settings:
    return getattr(request.app.state, "settings", None) or get_settings()


def current_user(request: Request) -> User | None:
    return getattr(request.state, "user", None)


def require_member(request: Request) -> User | JSONResponse:
    user = current_user(request)
    if user is None:
        return err("auth_required", status=401)
    if not is_member(user):
        return err("forbidden", status=403)
    return user


def require_owner(request: Request) -> User | JSONResponse:
    user = current_user(request)
    if user is None:
        return err("auth_required", status=401)
    if not is_owner(user):
        return err("forbidden", status=403)
    return user


def actor_from_request(request: Request, *, channel: str = "web") -> ActorContext:
    user = current_user(request)
    imp = getattr(request.state, "impersonator", None)
    return ActorContext(
        actor_id=user.id if user else None,
        actor_name=user.name if user else None,
        impersonator_id=imp.id if imp else None,
        channel=channel,
    )


def record_audit(
    request: Request,
    action: str,
    target_id: str | None = None,
    summary: str = "",
    *,
    channel: str = "web",
    meta: dict[str, Any] | None = None,
) -> None:
    actor = actor_from_request(request, channel=channel)
    get_repo(request).append_audit(
        AuditEvent(
            actor_id=actor.actor_id,
            actor_name=actor.actor_name,
            impersonator_id=actor.impersonator_id,
            channel=channel,
            action=action,
            target_id=target_id,
            summary=summary,
            meta=meta or {},
        )
    )
