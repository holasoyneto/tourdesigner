"""Canonical People directory & atomic merge."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from app.api.common import (
    actor_from_request,
    created,
    err,
    get_repo,
    ok,
    record_audit,
    require_member,
)
from app.domain.models import Person
from app.repo.protocol import ConflictError, NotFoundError

router = APIRouter(prefix="/api", tags=["people"])


@router.get("/people")
def list_people(request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    people = get_repo(request).list_people()
    return ok(people=[p.model_dump(mode="json") for p in people])


@router.post("/people")
def create_person(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    try:
        person = Person.model_validate(body)
    except Exception as exc:
        return err("invalid_person", status=422, detail=str(exc))
    saved = get_repo(request).upsert_person(person)
    record_audit(request, "create_person", saved.id, f"Created contact {saved.name}")
    return created(person=saved.model_dump(mode="json"))


@router.patch("/people/{person_id}")
@router.put("/people/{person_id}")
def update_person(person_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    existing = repo.get_person(person_id)
    if not existing:
        return err("person_not_found", status=404)
    expected_version = body.pop("expected_version", None)
    merged = existing.model_dump()
    for k, v in body.items():
        if k not in {"id", "version", "updated_at", "merged_into"} and k in merged:
            merged[k] = v
    try:
        updated = repo.upsert_person(
            Person.model_validate(merged),
            expected_version=int(expected_version) if expected_version is not None else None,
        )
    except ConflictError as exc:
        return err("conflict", status=409, current=exc.current)
    except Exception as exc:
        return err("invalid_person", status=422, detail=str(exc))
    record_audit(request, "update_person", person_id, f"Updated contact {updated.name}")
    return ok(person=updated.model_dump(mode="json"))


@router.post("/people/merge")
def merge_people(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    source_id = str(body.get("source_id") or "")
    target_id = str(body.get("target_id") or "")
    if not source_id or not target_id:
        return err("source_and_target_required", status=400)
    try:
        merged = get_repo(request).merge_people(source_id, target_id, actor=actor_from_request(request))
    except NotFoundError:
        return err("person_not_found", status=404)
    except ValueError as exc:
        return err(str(exc), status=400)
    record_audit(request, "merge_people", target_id, f"Merged {source_id} -> {target_id}")
    return ok(person=merged.model_dump(mode="json"))
