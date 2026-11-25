"""Canonical domain models for Tour Designer.

Single source of truth across Firestore, local SQLite, REST API, MCP, and AI intake.
Every mutable entity carries an integer `version` for atomic optimistic concurrency (CAS).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


def new_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid4().hex[:12]}"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def iso_in_days(days: float) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()


class GigStatus(str, Enum):
    hold = "hold"
    pending = "pending"
    confirmed = "confirmed"
    announced = "announced"
    advancing = "advancing"
    show_day = "show_day"
    played = "played"
    cancelled = "cancelled"


class Role(str, Enum):
    owner = "owner"
    editor = "editor"
    viewer = "viewer"


PersonKind = Literal["equipe", "promoteur", "hote", "chauffeur", "client", "autre"]

ItemCollection = Literal[
    "flights",
    "transport",
    "hotels",
    "schedule",
    "timetable",
    "crew",
    "contacts",
    "guests",
    "setlist",
    "rider",
    "perdiem",
    "files",
    "links",
    "notes_list",
    "events",
    "promo",
    "marketing",
]

ALL_COLLECTIONS: tuple[ItemCollection, ...] = (
    "flights",
    "transport",
    "hotels",
    "schedule",
    "timetable",
    "crew",
    "contacts",
    "guests",
    "setlist",
    "rider",
    "perdiem",
    "files",
    "links",
    "notes_list",
    "events",
    "promo",
    "marketing",
)

EDITABLE_MCP_COLLECTIONS: tuple[ItemCollection, ...] = (
    "flights",
    "transport",
    "hotels",
    "schedule",
    "timetable",
    "crew",
    "contacts",
    "guests",
    "setlist",
    "rider",
    "links",
    "notes_list",
    "events",
    "promo",
    "marketing",
)


class Person(BaseModel):
    """Canonical human entity (replaces settings KV + client-side FNV-1a stitching)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("per"))
    name: str = ""
    person_kind: PersonKind | None = None
    role: str | None = None
    company: str | None = None
    phone: str | None = None
    email: str | None = None
    notes: str | None = None
    loyalty: list[dict[str, Any]] = Field(default_factory=list)
    profile: dict[str, Any] = Field(default_factory=dict)
    permanent: bool = False
    merged_into: str | None = None
    version: int = 1
    updated_at: str = Field(default_factory=now_iso)


class Gig(BaseModel):
    """Lean gig header. Operational rows live as independently versioned GigItem records."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("gig"))
    artist_id: str | None = None
    tour_id: str | None = None
    name: str = ""
    date: str = ""  # YYYY-MM-DD
    venue: str = ""
    city: str = ""
    country: str = ""
    timezone: str | None = None
    venue_address: str | None = None
    venue_website: str | None = None
    venue_instagram: str | None = None
    venue_phone: str | None = None
    venue_type: str | None = None
    venue_capacity: str | None = None
    set_time: str = ""
    set_end: str | None = None
    set_day_offset: int | None = Field(default=None, ge=0, le=1)
    doors_time: str | None = None
    soundcheck_time: str | None = None
    status: GigStatus = GigStatus.hold
    ticket_url: str | None = None
    promoter: str | None = None
    fee: float | None = None
    currency: str = "EUR"
    deal_type: str | None = Field(default=None, max_length=1000)
    notes: str = ""
    tour_page_dismissed: bool = False
    archived: bool = False
    deleted_at: str | None = None
    deleted_by: str | None = None
    custom: dict[str, str] = Field(default_factory=dict)
    drive_folder_id: str | None = None
    drive_sheet_id: str | None = None
    source: str = "web"
    version: int = 1
    updated_at: str = Field(default_factory=now_iso)
    items_updated_at: str = Field(default_factory=now_iso)


class GigItem(BaseModel):
    """Unified versioned operational row inside a gig.

    Storing items individually eliminates 70 KB blob rewrites, enables per-row ACID CAS,
    and powers compact diff history + 1-click undo of assistant/MCP add batches.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("it"))
    gig_id: str
    collection: ItemCollection
    data: dict[str, Any] = Field(default_factory=dict)
    person_ids: list[str] = Field(default_factory=list)
    deleted: bool = False
    version: int = 1
    updated_at: str = Field(default_factory=now_iso)
    added_by: str | None = None
    added_by_name: str | None = None
    added_channel: Literal["web", "mcp", "intake", "migration", "cron"] = "web"
    batch_id: str | None = None


class HistoryEvent(BaseModel):
    """Compact row-level diff history (replaces full 70 KB gig JSON snapshots)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("hist"))
    gig_id: str
    at: str = Field(default_factory=now_iso)
    actor_id: str | None = None
    actor_name: str | None = None
    channel: str = "web"
    action: str  # create_gig | update_gig | add_items | update_item | remove_item | undo_batch
    summary: str = ""
    batch_id: str | None = None
    item_ids: list[str] = Field(default_factory=list)
    before: dict[str, Any] | None = None
    after: dict[str, Any] | None = None


class FileRecord(BaseModel):
    """GCS-backed document metadata (optional async one-way Drive mirror)."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("fil"))
    object_id: str = Field(default_factory=lambda: new_id("obj"))
    gig_id: str | None = None
    person_id: str | None = None
    name: str
    mime: str = "application/octet-stream"
    size: int = 0
    content_sha256: str | None = None
    gcs_key: str | None = None
    drive_file_id: str | None = None
    mirror_status: Literal["none", "pending", "mirrored", "failed"] = "none"
    doc_kind: str | None = None
    doc_country: str | None = None
    doc_expires: str | None = None
    scope: Literal["crew", "private"] = "crew"
    pinned: bool = True
    added_at: str = Field(default_factory=now_iso)
    added_by: str | None = None


class ShareLink(BaseModel):
    """Unified capability link replacing crew_keys + master_share + crew[].share."""

    model_config = ConfigDict(extra="ignore")

    key: str
    scope: Literal["person", "gig_master", "gig_crew"]
    gig_id: str | None = None
    person_id: str | None = None
    label: str = ""
    enabled: bool = True
    can_edit: bool = False
    expires_at: str | None = None
    last_seen: str | None = None
    email_prefs: dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=now_iso)
    updated_at: str = Field(default_factory=now_iso)


class Project(BaseModel):
    """Artist or touring project agenda container."""

    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("art"))
    name: str
    color: str = "#f3c64a"
    notes: str = ""
    archived: bool = False
    created_at: str = Field(default_factory=now_iso)


class User(BaseModel):
    model_config = ConfigDict(extra="ignore", use_enum_values=True)

    id: str = Field(default_factory=lambda: new_id("usr"))
    name: str = ""
    email: str | None = None
    role: Role = Role.editor
    artist_ids: list[str] = Field(default_factory=list)  # Empty => access to all projects
    travel_person_id: str | None = None
    revoked: bool = False
    login_key_hash: str | None = None
    mcp_key_hash: str | None = None
    created_at: str = Field(default_factory=now_iso)
    last_seen_at: str | None = None


class Session(BaseModel):
    model_config = ConfigDict(extra="ignore")

    token_hash: str
    user_id: str
    impersonator_id: str | None = None
    ttl_days: int = 30
    created_at: str = Field(default_factory=now_iso)
    expires_at: str = ""
    last_seen_at: str = Field(default_factory=now_iso)


class Invite(BaseModel):
    model_config = ConfigDict(extra="ignore", use_enum_values=True)

    token_hash: str
    role: Role = Role.editor
    label: str = ""
    created_by: str | None = None
    created_at: str = Field(default_factory=now_iso)
    expires_at: str = ""
    used_by: str | None = None
    used_at: str | None = None
    revoked: bool = False


class AuditEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(default_factory=lambda: new_id("aud"))
    ts: str = Field(default_factory=now_iso)
    actor_id: str | None = None
    actor_name: str | None = None
    impersonator_id: str | None = None
    channel: str = "web"
    action: str
    target_id: str | None = None
    summary: str = ""
    meta: dict[str, Any] = Field(default_factory=dict)
