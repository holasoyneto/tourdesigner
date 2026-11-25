"""Role-based authorization and field scrubbing for Tour Designer."""

from __future__ import annotations

from typing import Any

from app.domain.models import Gig, GigItem, Role, User

OWNER_ONLY_GIG_FIELDS = frozenset({"deal_type"})
FINANCE_WRITE_GIG_FIELDS = frozenset({"fee", "currency", "deal_type"})
VIEWER_HIDDEN_GIG_FIELDS = frozenset(
    {"fee", "currency", "deal_type", "custom", "drive_folder_id", "drive_sheet_id"}
)
VIEWER_ALLOWED_COLLECTIONS = frozenset(
    {
        "flights",
        "transport",
        "hotels",
        "schedule",
        "timetable",
        "links",
        "events",
    }
)
VIEWER_STRIPPED_ITEM_FIELDS = frozenset(
    {"ref", "pnr", "ref_by_person", "confirmation", "wifi_password", "source_ids"}
)
SHARE_STRIPPED_ITEM_FIELDS = frozenset({"wifi_password", "source_ids", "ref_by_person"})


def role_of(user: User | None) -> str:
    if user is None:
        return "anonymous"
    return str(user.role.value if isinstance(user.role, Role) else user.role)


def is_owner(user: User | None) -> bool:
    return role_of(user) == "owner"


def is_member(user: User | None) -> bool:
    return role_of(user) in {"owner", "editor"}


def can_access_project(user: User | None, artist_id: str | None) -> bool:
    """Fail-closed project/artist scope check. Empty artist_ids grants multi-project access."""
    if user is None:
        return False
    if is_owner(user):
        return True
    allowed = [pid for pid in (user.artist_ids or []) if pid]
    if not allowed:
        return True
    return bool(artist_id and artist_id in allowed)


def can_access_gig(user: User | None, gig: Gig) -> bool:
    return can_access_project(user, gig.artist_id)


def allowed_project_ids(user: User | None) -> set[str] | None:
    """Return allowed project IDs set, or None when caller has unrestricted multi-project access."""
    if user is None:
        return set()
    if is_owner(user):
        return None
    allowed = {pid for pid in (user.artist_ids or []) if pid}
    return allowed or None


def scrub_gig_header(gig: Gig, user: User | None) -> dict[str, Any]:
    """Serialize a Gig header according to caller role (fail-closed)."""
    data = gig.model_dump(mode="json")
    role = role_of(user)
    if role == "owner":
        return data
    if role == "editor":
        for key in OWNER_ONLY_GIG_FIELDS:
            data.pop(key, None)
        return data
    # viewer or anonymous public share
    for key in VIEWER_HIDDEN_GIG_FIELDS:
        data.pop(key, None)
    return data


def scrub_item(
    item: GigItem,
    user: User | None,
    *,
    travel_person_id: str | None = None,
) -> dict[str, Any] | None:
    """Serialize a GigItem according to caller role (fail-closed); returns None if hidden."""
    role = role_of(user)
    if role == "owner":
        return item.model_dump(mode="json")
    if role == "editor":
        if item.collection == "perdiem":
            return None
        return item.model_dump(mode="json")

    # Viewer or anonymous public share link: strict allowlist + optional traveler scope
    if item.collection not in VIEWER_ALLOWED_COLLECTIONS:
        return None
    if travel_person_id and item.person_ids and travel_person_id not in item.person_ids:
        return None
    stripped = VIEWER_STRIPPED_ITEM_FIELDS if role == "viewer" else SHARE_STRIPPED_ITEM_FIELDS
    clean_data = {k: v for k, v in item.data.items() if k not in stripped}
    if travel_person_id and isinstance(clean_data.get("seat_by_person"), dict):
        own_seat = clean_data["seat_by_person"].get(travel_person_id)
        clean_data["seat_by_person"] = {travel_person_id: own_seat} if own_seat else {}
    if travel_person_id and isinstance(clean_data.get("room_assignments"), dict):
        own_room = clean_data["room_assignments"].get(travel_person_id)
        clean_data["room_assignments"] = {travel_person_id: own_room} if own_room else {}
    dumped = item.model_dump(mode="json")
    dumped["data"] = clean_data
    return dumped


def check_gig_write_fields(user: User | None, patch: dict[str, Any]) -> str | None:
    """Return an error code if caller cannot write any requested gig field."""
    if not is_member(user):
        return "forbidden"
    if not is_owner(user) and (set(patch) & FINANCE_WRITE_GIG_FIELDS):
        return "owner_required_for_finance"
    return None


def check_collection_write(user: User | None, collection: str) -> str | None:
    if not is_member(user):
        return "forbidden"
    if collection == "perdiem" and not is_owner(user):
        return "owner_required_for_finance"
    return None
