"""Gigs, normalized versioned items, delta sync, history, batch undo, and trash."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

from app.api.common import (
    actor_from_request,
    created,
    current_user,
    err,
    get_app_settings,
    get_repo,
    ok,
    record_audit,
    require_member,
    require_owner,
)
from app.domain.models import ALL_COLLECTIONS, Gig, GigItem, GigStatus
from app.domain.roles import (
    can_access_gig,
    can_access_project,
    check_collection_write,
    check_gig_write_fields,
    role_of,
    scrub_gig_header,
    scrub_item,
)
from app.repo.protocol import ConflictError, NotFoundError

router = APIRouter(prefix="/api", tags=["gigs"])


def _viewer_sees_gig(user, gig: Gig, raw_items: list[GigItem]) -> bool:
    if not can_access_gig(user, gig):
        return False
    if role_of(user) == "viewer" and user and user.travel_person_id:
        tagged = [it for it in raw_items if it.person_ids]
        if tagged and not any(user.travel_person_id in it.person_ids for it in tagged):
            return False
    return True


def _require_accessible_gig(repo, gig_id: str, user) -> Gig | JSONResponse:
    gig = repo.get_gig(gig_id)
    if not gig or not can_access_gig(user, gig):
        return err("gig_not_found", status=404)
    return gig


@router.get("/gigs")
def list_gigs(request: Request, include_items: bool = Query(default=False)) -> JSONResponse:
    repo = get_repo(request)
    user = current_user(request)
    travel_pid = user.travel_person_id if user else None
    gigs = repo.list_gigs()
    out: list[dict[str, Any]] = []
    for g in gigs:
        if not can_access_gig(user, g):
            continue
        raw_items = repo.list_items(g.id) if (include_items or (role_of(user) == "viewer" and travel_pid)) else []
        if role_of(user) == "viewer" and travel_pid and not _viewer_sees_gig(user, g, raw_items):
            continue
        header = scrub_gig_header(g, user)
        if include_items:
            visible = [
                d
                for it in raw_items
                if (d := scrub_item(it, user, travel_person_id=travel_pid)) is not None
            ]
            header["items"] = visible
        out.append(header)
    return ok(gigs=out)


@router.get("/gigs/changes")
def gigs_changes(request: Request, since: str | None = Query(default=None)) -> JSONResponse:
    """Lightweight delta pulse scoped to the caller's accessible projects."""
    repo = get_repo(request)
    user = current_user(request)
    delta = repo.get_changes_since(since)
    if user and user.artist_ids:
        visible_ids = {g.id for g in repo.list_gigs() if can_access_gig(user, g)}
        delta["changed_gig_ids"] = [gid for gid in delta.get("changed_gig_ids", []) if gid in visible_ids]
    return ok(**delta)


@router.get("/gigs/{gig_id}")
def get_gig(gig_id: str, request: Request) -> JSONResponse:
    repo = get_repo(request)
    user = current_user(request)
    gig = _require_accessible_gig(repo, gig_id, user)
    if isinstance(gig, JSONResponse):
        return gig
    travel_pid = user.travel_person_id if user else None
    raw_items = repo.list_items(gig.id)
    if not _viewer_sees_gig(user, gig, raw_items):
        return err("gig_not_found", status=404)
    header = scrub_gig_header(gig, user)
    header["items"] = [
        d for it in raw_items if (d := scrub_item(it, user, travel_person_id=travel_pid)) is not None
    ]
    return ok(gig=header)


@router.post("/gigs")
def create_gig(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    denied = check_gig_write_fields(member, body)
    if denied:
        return err(denied, status=403)
    settings = get_app_settings(request)
    repo = get_repo(request)
    if settings.tenancy_mode == "multi" and settings.hosted_max_gigs > 0:
        if len(repo.list_gigs()) >= settings.hosted_max_gigs:
            return err("quota_gigs_exceeded", status=429)
    # Enforce project scope for scoped road managers / editors
    if member.artist_ids:
        target_artist = str(body.get("artist_id") or "").strip() or (
            member.artist_ids[0] if len(member.artist_ids) == 1 else ""
        )
        if not can_access_project(member, target_artist):
            return err("project_scope_denied", status=403)
        body["artist_id"] = target_artist
    if "status" in body:
        try:
            body["status"] = GigStatus(str(body["status"]))
        except ValueError:
            return err("invalid_status", status=400)
    try:
        gig = Gig.model_validate(body)
    except Exception as exc:
        return err("invalid_gig", status=422, detail=str(exc))
    saved = get_repo(request).create_gig(gig, actor=actor_from_request(request))
    record_audit(request, "create_gig", saved.id, f"Created {saved.city or saved.venue or saved.date}")
    return created(gig=scrub_gig_header(saved, member))


@router.patch("/gigs/{gig_id}")
@router.put("/gigs/{gig_id}")
def update_gig(gig_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    if "artist_id" in body and member.artist_ids:
        if not can_access_project(member, str(body.get("artist_id") or "").strip() or None):
            return err("project_scope_denied", status=403)
    expected_version = body.pop("expected_version", None)
    denied = check_gig_write_fields(member, body)
    if denied:
        return err(denied, status=403)
    try:
        updated = repo.update_gig(
            gig_id,
            body,
            expected_version=int(expected_version) if expected_version is not None else None,
            actor=actor_from_request(request),
        )
    except NotFoundError:
        return err("gig_not_found", status=404)
    except ConflictError as exc:
        return err("conflict", status=409, current=exc.current)
    except Exception as exc:
        return err("invalid_gig_patch", status=422, detail=str(exc))
    record_audit(request, "update_gig", gig_id, f"Updated {', '.join(sorted(body))}")
    return ok(gig=scrub_gig_header(updated, member))


@router.delete("/gigs/{gig_id}")
def delete_gig(gig_id: str, request: Request) -> JSONResponse:
    owner = require_owner(request)
    if isinstance(owner, JSONResponse):
        return owner
    try:
        trashed = get_repo(request).soft_delete_gig(gig_id, actor=actor_from_request(request))
    except NotFoundError:
        return err("gig_not_found", status=404)
    record_audit(request, "delete_gig", gig_id, f"Moved {trashed.city or trashed.date} to trash")
    return ok(gig_id=gig_id)


@router.get("/trash")
def list_trash(request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    gigs = [
        scrub_gig_header(g, member)
        for g in get_repo(request).list_trash()
        if can_access_gig(member, g)
    ]
    return ok(gigs=gigs)


@router.post("/trash/{gig_id}/restore")
def restore_trash(gig_id: str, request: Request) -> JSONResponse:
    owner = require_owner(request)
    if isinstance(owner, JSONResponse):
        return owner
    try:
        restored = get_repo(request).restore_gig(gig_id, actor=actor_from_request(request))
    except NotFoundError:
        return err("gig_not_found", status=404)
    record_audit(request, "restore_gig", gig_id, f"Restored {restored.city or restored.date}")
    return ok(gig=scrub_gig_header(restored, owner))


@router.delete("/trash/{gig_id}")
def destroy_trash(gig_id: str, request: Request) -> JSONResponse:
    owner = require_owner(request)
    if isinstance(owner, JSONResponse):
        return owner
    if not get_repo(request).destroy_gig(gig_id):
        return err("gig_not_found", status=404)
    record_audit(request, "destroy_gig", gig_id, "Permanently destroyed trashed gig")
    return ok(gig_id=gig_id)


# ---- Versioned Row Items ----
@router.post("/gigs/{gig_id}/items")
def add_gig_items(gig_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    raw_items = body.get("items")
    if isinstance(body.get("collection"), str) and raw_items is None:
        raw_items = [body]
    if not isinstance(raw_items, list) or not raw_items:
        return err("items_required", status=400)

    items: list[GigItem] = []
    for raw in raw_items:
        col = str(raw.get("collection") or "")
        if col not in ALL_COLLECTIONS:
            return err(f"unknown_collection:{col}", status=400)
        denied = check_collection_write(member, col)
        if denied:
            return err(denied, status=403)
        items.append(
            GigItem(
                id=str(raw["id"]) if raw.get("id") else GigItem.model_fields["id"].default_factory(),  # type: ignore[misc]
                gig_id=gig_id,
                collection=col,  # type: ignore[arg-type]
                data=raw.get("data") if isinstance(raw.get("data"), dict) else {},
                person_ids=raw.get("person_ids") if isinstance(raw.get("person_ids"), list) else [],
            )
        )
    try:
        saved = get_repo(request).add_items(
            gig_id,
            items,
            batch_id=body.get("batch_id"),
            actor=actor_from_request(request),
        )
    except NotFoundError:
        return err("gig_not_found", status=404)
    record_audit(request, "add_items", gig_id, f"Added {len(saved)} item(s)")
    return created(items=[it.model_dump(mode="json") for it in saved])


@router.patch("/gigs/{gig_id}/items/{item_id}")
@router.put("/gigs/{gig_id}/items/{item_id}")
def update_gig_item(gig_id: str, item_id: str, request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    existing = repo.get_item(gig_id, item_id)
    if not existing or existing.deleted:
        return err("item_not_found", status=404)
    denied = check_collection_write(member, existing.collection)
    if denied:
        return err(denied, status=403)
    patch = body.get("data") if isinstance(body.get("data"), dict) else body.get("fields")
    if not isinstance(patch, dict):
        return err("data_object_required", status=400)
    expected_version = body.get("expected_version")
    person_ids = body.get("person_ids") if isinstance(body.get("person_ids"), list) else None
    try:
        updated = repo.update_item(
            gig_id,
            item_id,
            patch,
            person_ids=person_ids,
            expected_version=int(expected_version) if expected_version is not None else None,
            actor=actor_from_request(request),
        )
    except NotFoundError:
        return err("item_not_found", status=404)
    except ConflictError as exc:
        return err("conflict", status=409, current=exc.current)
    record_audit(request, "update_item", f"{gig_id}/{item_id}", f"Updated {updated.collection}")
    return ok(item=updated.model_dump(mode="json"))


@router.delete("/gigs/{gig_id}/items/{item_id}")
def remove_gig_item(
    gig_id: str,
    item_id: str,
    request: Request,
    expected_version: int | None = Query(default=None),
) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    existing = repo.get_item(gig_id, item_id)
    if not existing or existing.deleted:
        return err("item_not_found", status=404)
    denied = check_collection_write(member, existing.collection)
    if denied:
        return err(denied, status=403)
    try:
        removed = repo.remove_item(
            gig_id,
            item_id,
            expected_version=expected_version,
            actor=actor_from_request(request),
        )
    except NotFoundError:
        return err("item_not_found", status=404)
    except ConflictError as exc:
        return err("conflict", status=409, current=exc.current)
    record_audit(request, "remove_item", f"{gig_id}/{item_id}", f"Removed {removed.collection}")
    return ok(removed_id=item_id)


@router.get("/gigs/{gig_id}/history")
def gig_history(gig_id: str, request: Request, limit: int = 50) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    events = repo.list_history(gig_id, limit=min(max(limit, 1), 100))
    return ok(events=[e.model_dump(mode="json") for e in events])


@router.post("/gigs/{gig_id}/history/{batch_id}/undo")
def undo_gig_batch(gig_id: str, batch_id: str, request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = _require_accessible_gig(repo, gig_id, member)
    if isinstance(gig, JSONResponse):
        return gig
    result = repo.undo_batch(gig_id, batch_id, actor=actor_from_request(request))
    record_audit(request, "undo_batch", f"{gig_id}/{batch_id}", f"Removed {len(result['removed'])}, kept {len(result['kept'])}")
    return ok(**result)
