"""Streamable-HTTP MCP server (/mcp/{token}) with optimistic concurrency and audit attribution.

Enforces mandatory read-before-edit via bounded read tokens (`read_token`) and
compare-and-swap version checks (`changed_since_read`), while tagging batch writes with
actor attribution so the web desk can undo assistant batches in one click.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import re
import socket
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

from app.api.files import (
    MAX_LOCAL_UPLOAD_BYTES,
    _fetch_drive_bytes,
    _mcp_hmac_secret,
    _safe_local_path,
    _sanitize_filename,
    _sign_gcs_url,
    download_gcs_bytes,
    mint_mcp_file_token,
    upload_gcs_bytes,
)
from app.domain.auth import AUTH_LIMITER, constant_time_equals, hash_secret, requester_ip
from app.domain.models import (
    EDITABLE_MCP_COLLECTIONS,
    AuditEvent,
    FileRecord,
    Gig,
    GigItem,
    GigStatus,
    User,
    new_id,
)
from app.domain.roles import (
    can_access_gig,
    can_access_project,
    check_collection_write,
    check_gig_write_fields,
    is_owner,
    scrub_gig_header,
    scrub_item,
)
from app.repo.protocol import ActorContext, ConflictError, NotFoundError, TourRepo
from app.repo.tenants import parse_scoped_token

router = APIRouter(tags=["mcp"])
_MAX_BODY_BYTES = 2 * 1024 * 1024
_MAX_UPLOAD_BODY_BYTES = 16 * 1024 * 1024
_MAX_SOURCE_URL_BYTES = 15 * 1024 * 1024
_READ_TOKEN_TTL_SEC = 1800


def _mint_read_token(
    root_repo: TourRepo | None,
    *,
    user_id: str,
    tenant_id: str | None,
    gig_id: str,
    gig_version: int,
    item_versions: dict[str, int],
) -> str:
    payload = {
        "uid": user_id,
        "tid": tenant_id or "",
        "gid": gig_id,
        "gv": gig_version,
        "iv": item_versions,
        "exp": int(time.time()) + _READ_TOKEN_TTL_SEC,
    }
    b64 = (
        base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        .decode("ascii")
        .rstrip("=")
    )
    sig = hmac.new(
        _mcp_hmac_secret(root_repo).encode("utf-8"),
        b64.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    return f"rt1.{b64}.{sig}"


def _verify_read_token(
    root_repo: TourRepo | None,
    *,
    user_id: str,
    tenant_id: str | None,
    gig_id: str,
    token: str,
) -> dict[str, Any] | None:
    parts = (token or "").split(".")
    if len(parts) != 3 or parts[0] != "rt1":
        return None
    _, b64, sig = parts
    expected = hmac.new(
        _mcp_hmac_secret(root_repo).encode("utf-8"),
        b64.encode("ascii"),
        hashlib.sha256,
    ).hexdigest()
    if not constant_time_equals(sig, expected):
        return None
    try:
        padded = b64 + "=" * (-len(b64) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8"))
        if int(data.get("exp") or 0) < int(time.time()):
            return None
        if data.get("uid") != user_id or data.get("gid") != gig_id:
            return None
        if (data.get("tid") or "") != (tenant_id or ""):
            return None
        return {
            "gig_version": int(data.get("gv") or 1),
            "item_versions": data.get("iv") if isinstance(data.get("iv"), dict) else {},
        }
    except Exception:
        return None


def _is_forbidden_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
        or str(ip) in {"169.254.169.254", "100.100.100.200"}
    )


def _validate_public_https_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme.lower() != "https" or not parsed.hostname:
        raise ValueError("source_url_must_be_https")
    host = parsed.hostname.strip().lower()
    if host in {"localhost", "metadata.google.internal", "metadata"} or host.endswith(".internal") or host.endswith(".local"):
        raise ValueError("source_url_forbidden_host")
    try:
        infos = socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError("source_url_dns_failed") from exc
    if not infos:
        raise ValueError("source_url_dns_failed")
    for _, _, _, _, sockaddr in infos:
        if _is_forbidden_ip(sockaddr[0]):
            raise ValueError("source_url_forbidden_ip")


async def _download_safe_source_url(url: str) -> tuple[bytes, str | None]:
    _validate_public_https_url(url)
    async with httpx.AsyncClient(timeout=20.0, follow_redirects=False) as client:
        current = url
        for _ in range(4):
            _validate_public_https_url(current)
            async with client.stream("GET", current) as resp:
                if resp.status_code in {301, 302, 303, 307, 308} and resp.headers.get("location"):
                    current = str(resp.url.join(resp.headers["location"]))
                    continue
                resp.raise_for_status()
                cl = resp.headers.get("content-length")
                if cl and cl.isdigit() and int(cl) > _MAX_SOURCE_URL_BYTES:
                    raise ValueError("file_too_large")
                chunks: list[bytes] = []
                total = 0
                async for chunk in resp.aiter_bytes(65536):
                    total += len(chunk)
                    if total > _MAX_SOURCE_URL_BYTES:
                        raise ValueError("file_too_large")
                    chunks.append(chunk)
                ctype = (resp.headers.get("content-type") or "").split(";")[0].strip().lower() or None
                return b"".join(chunks), ctype
    raise ValueError("source_url_too_many_redirects")


def _rpc_result(req_id: Any, result: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "result": result}


def _rpc_error(req_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": req_id, "error": {"code": code, "message": message}}


def _tool_list(user: User) -> list[dict[str, Any]]:
    owner = is_owner(user)
    gig_props: dict[str, Any] = {
        "date": {"type": "string"},
        "name": {"type": "string"},
        "venue": {"type": "string"},
        "city": {"type": "string"},
        "country": {"type": "string"},
        "timezone": {"type": "string"},
        "set_time": {"type": "string"},
        "set_end": {"type": "string"},
        "doors_time": {"type": "string"},
        "soundcheck_time": {"type": "string"},
        "status": {"type": "string"},
        "promoter": {"type": "string"},
        "ticket_url": {"type": "string"},
        "notes": {"type": "string"},
    }
    if owner:
        gig_props.update({"fee": {"type": ["number", "null"]}, "currency": {"type": "string"}, "deal_type": {"type": "string"}})

    _item_props: dict[str, dict[str, Any]] = {
        "add_flights": {
            "flight_no": {"type": "string", "description": "Flight number e.g. BA 371"},
            "airline": {"type": "string", "description": "Airline name"},
            "dep_iata": {"type": "string", "description": "3-letter departure airport IATA code e.g. TLS"},
            "arr_iata": {"type": "string", "description": "3-letter arrival airport IATA code e.g. LHR"},
            "dep_time": {"type": "string", "description": "Departure local time HH:MM"},
            "arr_time": {"type": "string", "description": "Arrival local time HH:MM"},
            "terminal": {"type": "string"},
            "gate": {"type": "string"},
            "ref": {"type": "string", "description": "PNR / booking confirmation code"},
            "seats": {"type": "string", "description": "Seat assignment(s)"},
            "notes": {"type": "string"},
        },
        "add_transports": {
            "time": {"type": "string", "description": "Pickup time HH:MM"},
            "from": {"type": "string", "description": "Pickup location"},
            "to": {"type": "string", "description": "Dropoff location"},
            "driver_name": {"type": "string"},
            "driver_phone": {"type": "string"},
            "vehicle": {"type": "string"},
            "notes": {"type": "string"},
        },
        "add_hotels": {
            "name": {"type": "string", "description": "Hotel name"},
            "address": {"type": "string"},
            "check_in": {"type": "string", "description": "Check-in time or date"},
            "check_out": {"type": "string", "description": "Check-out time or date"},
            "confirmation": {"type": "string", "description": "Confirmation number"},
            "phone": {"type": "string"},
            "notes": {"type": "string"},
        },
        "add_schedule_items": {
            "time": {"type": "string", "description": "Start time HH:MM"},
            "end_time": {"type": "string", "description": "End time HH:MM"},
            "title": {"type": "string", "description": "Activity title"},
            "location": {"type": "string"},
            "notes": {"type": "string"},
        },
        "add_timetable_items": {
            "start": {"type": "string", "description": "Start time HH:MM"},
            "end": {"type": "string", "description": "End time HH:MM"},
            "act": {"type": "string", "description": "Artist / act name"},
            "stage": {"type": "string"},
            "notes": {"type": "string"},
        },
        "add_crew": {
            "name": {"type": "string"},
            "role": {"type": "string"},
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "notes": {"type": "string"},
        },
        "add_contacts": {
            "name": {"type": "string"},
            "role": {"type": "string"},
            "company": {"type": "string"},
            "phone": {"type": "string"},
            "email": {"type": "string"},
            "notes": {"type": "string"},
        },
    }

    def _add(name: str, desc: str, items_key: str) -> dict[str, Any]:
        props = _item_props.get(name)
        item_schema: dict[str, Any] = {"type": "object", "properties": props} if props else {"type": "object"}
        return {
            "name": name,
            "description": desc,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    items_key: {"type": "array", "items": item_schema, "minItems": 1, "maxItems": 40},
                },
                "required": ["gig_id", items_key],
            },
        }

    return [
        {
            "name": "list_gigs",
            "description": "List gigs with id, date, venue, city, status, fee/currency (for owner & editors), and row counts.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "from_date": {"type": "string"},
                    "to_date": {"type": "string"},
                    "include_archived": {"type": "boolean"},
                },
            },
        },
        {
            "name": "get_gig",
            "description": "Read one gig in full and obtain a read_token + row versions required before update_gig/update_item/remove_item.",
            "inputSchema": {"type": "object", "properties": {"gig_id": {"type": "string"}}, "required": ["gig_id"]},
        },
        {
            "name": "create_gig",
            "description": "Create a new gig date after explicit user confirmation.",
            "inputSchema": {"type": "object", "properties": gig_props, "required": ["date"]},
        },
        {
            "name": "update_gig",
            "description": "Update gig header fields. Requires read_token from get_gig so concurrent edits are never silently overwritten.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    "read_token": {"type": "string"},
                    "fields": {"type": "object", "properties": gig_props},
                },
                "required": ["gig_id", "fields"],
            },
        },
        _add(
            "add_flights",
            "Append flight legs to a gig (idempotent). Canonical fields: flight_no, airline, dep_iata, arr_iata, dep_time (HH:MM), arr_time (HH:MM), terminal, gate, ref (PNR), seats, notes.",
            "flights",
        ),
        _add(
            "add_transports",
            "Append ground transport legs to a gig (idempotent). Canonical fields: time (HH:MM), from, to, driver_name, driver_phone, vehicle, notes.",
            "transports",
        ),
        _add(
            "add_hotels",
            "Append hotels to a gig (idempotent). Canonical fields: name, address, check_in (HH:MM), check_out (HH:MM), confirmation, phone, notes.",
            "hotels",
        ),
        _add(
            "add_schedule_items",
            "Append day-sheet schedule rows (idempotent). Canonical fields: time (HH:MM), end_time (HH:MM), title, location, notes.",
            "items",
        ),
        _add(
            "add_timetable_items",
            "Append event set-times running order rows (idempotent). Canonical fields: start (HH:MM), end (HH:MM), act, is_us (boolean), stage, notes.",
            "items",
        ),
        _add("add_crew", "Append crew rows (idempotent). Fields: name, role, phone, email, notes.", "people"),
        _add("add_contacts", "Append local contacts (idempotent). Fields: name, role, company, phone, email, notes.", "people"),
        {
            "name": "add_items",
            "description": "Append items to any editable collection (guests, links, rider, setlist, promo, marketing).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    "collection": {"type": "string", "enum": list(EDITABLE_MCP_COLLECTIONS)},
                    "items": {"type": "array", "items": {"type": "object"}, "minItems": 1},
                },
                "required": ["gig_id", "collection", "items"],
            },
        },
        {
            "name": "append_gig_note",
            "description": "Append a titled note to a gig.",
            "inputSchema": {
                "type": "object",
                "properties": {"gig_id": {"type": "string"}, "title": {"type": "string"}, "body": {"type": "string"}},
                "required": ["gig_id", "body"],
            },
        },
        {
            "name": "update_item",
            "description": "Update one existing row. Requires read_token from get_gig (atomic CAS rejects concurrent edits).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    "collection": {"type": "string", "enum": list(EDITABLE_MCP_COLLECTIONS)},
                    "item_id": {"type": "string"},
                    "read_token": {"type": "string"},
                    "fields": {"type": "object"},
                },
                "required": ["gig_id", "item_id", "fields"],
            },
        },
        {
            "name": "remove_item",
            "description": "Remove one row after explicit confirmation (confirm=true) and a fresh get_gig read_token.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    "collection": {"type": "string", "enum": list(EDITABLE_MCP_COLLECTIONS)},
                    "item_id": {"type": "string"},
                    "read_token": {"type": "string"},
                    "confirm": {"type": "boolean", "const": True},
                },
                "required": ["gig_id", "item_id", "confirm"],
            },
        },
        {
            "name": "list_people",
            "description": "List canonical contacts & crew in the directory.",
            "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}},
        },
        {
            "name": "update_person",
            "description": "Update a canonical person record in the directory.",
            "inputSchema": {
                "type": "object",
                "properties": {"person_id": {"type": "string"}, "fields": {"type": "object"}},
                "required": ["person_id", "fields"],
            },
        },
        {
            "name": "get_daily_briefing",
            "description": "Automation-ready briefing of upcoming shows, logistics gaps (missing flights/hotel/soundcheck), and due/overdue reminders.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "days_ahead": {"type": "integer", "minimum": 1, "maximum": 30, "default": 7},
                    "artist_id": {"type": "string"},
                },
            },
        },
        {
            "name": "list_reminders",
            "description": "List tour reminders & follow-ups with overdue status (filter by status=open|done|all or gig_id).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "status": {"type": "string", "enum": ["open", "done", "all"], "default": "open"},
                    "gig_id": {"type": "string"},
                },
            },
        },
        {
            "name": "create_reminder",
            "description": "Create a persistent reminder or advancing follow-up (optionally linked to a gig and repeating daily/weekly).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "due_at": {"type": "string", "description": "ISO date or datetime, e.g. 2026-11-26 or 2026-11-26T09:00"},
                    "gig_id": {"type": "string"},
                    "notes": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "normal", "high"], "default": "normal"},
                    "repeat": {"type": "string", "enum": ["none", "daily", "weekly"], "default": "none"},
                },
                "required": ["title", "due_at"],
            },
        },
        {
            "name": "complete_reminder",
            "description": "Mark a reminder done (or reopen it). Repeating reminders automatically advance to the next occurrence when completed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "reminder_id": {"type": "string"},
                    "done": {"type": "boolean", "default": True},
                },
                "required": ["reminder_id"],
            },
        },
        {
            "name": "delete_reminder",
            "description": "Delete a reminder permanently.",
            "inputSchema": {
                "type": "object",
                "properties": {"reminder_id": {"type": "string"}},
                "required": ["reminder_id"],
            },
        },
        {
            "name": "list_files",
            "description": "List tour documents (boarding passes, hotel vouchers, riders, contracts, passports) in the vault.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "gig_id": {"type": "string"},
                    "doc_kind": {"type": "string", "description": "e.g. boarding_pass, hotel, rider, passport, contract"},
                    "query": {"type": "string"},
                },
            },
        },
        {
            "name": "get_file",
            "description": "Retrieve a file (boarding pass, voucher, rider, PDF) with a 15-minute signed download URL and inline image/text preview for AI chat.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_id": {"type": "string"},
                    "include_content": {"type": "boolean", "default": True},
                },
                "required": ["file_id"],
            },
        },
        {
            "name": "upload_file",
            "description": "Upload a boarding pass, hotel voucher, rider, or contract from chat (via content_base64, text_content, or HTTPS source_url) into a gig day sheet and optionally assign it to a crew member.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "filename": {"type": "string"},
                    "mime": {"type": "string", "default": "application/pdf"},
                    "content_base64": {"type": "string"},
                    "text_content": {"type": "string"},
                    "source_url": {"type": "string", "description": "Optional public HTTPS URL to fetch (<= 15 MB)"},
                    "gig_id": {"type": "string"},
                    "person_id": {"type": "string"},
                    "person_name": {"type": "string", "description": "Optional crew/artist name to auto-match if person_id is unknown"},
                    "doc_kind": {"type": "string", "description": "boarding_pass, hotel, rider, passport, contract, other"},
                    "doc_expires": {"type": "string"},
                    "pinned": {"type": "boolean", "default": False},
                    "scope": {"type": "string", "enum": ["crew", "private"], "default": "crew"},
                },
                "required": ["filename"],
            },
        },
        {
            "name": "assign_file",
            "description": "Assign or update an existing vault file's gig_id, crew member (person_id or person_name), doc_kind, pinned flag, or scope.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file_id": {"type": "string"},
                    "gig_id": {"type": "string"},
                    "person_id": {"type": "string"},
                    "person_name": {"type": "string"},
                    "doc_kind": {"type": "string"},
                    "pinned": {"type": "boolean"},
                    "scope": {"type": "string", "enum": ["crew", "private"]},
                },
                "required": ["file_id"],
            },
        },
    ]


_REMINDERS_SETTING_KEY = "reminders"


def _load_reminders(repo: TourRepo) -> list[dict[str, Any]]:
    raw = repo.get_setting(_REMINDERS_SETTING_KEY, [])
    return [dict(r) for r in raw if isinstance(r, dict) and r.get("id")] if isinstance(raw, list) else []


def _save_reminders(repo: TourRepo, reminders: list[dict[str, Any]]) -> None:
    repo.set_setting(_REMINDERS_SETTING_KEY, reminders)


def _is_overdue(due_at: str, done: bool) -> bool:
    if done or not due_at:
        return False
    today_iso = date.today().isoformat()
    if len(due_at) <= 10:
        return due_at < today_iso
    now_str = datetime.now(timezone.utc).isoformat()
    return due_at < now_str


def _advance_due(due_at: str, repeat: str) -> str:
    delta = timedelta(days=1 if repeat == "daily" else 7)
    try:
        if len(due_at) <= 10:
            return (date.fromisoformat(due_at[:10]) + delta).isoformat()
        dt = datetime.fromisoformat(due_at.replace("Z", "+00:00"))
        return (dt + delta).isoformat()
    except Exception:
        return due_at


def _prompt_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "daily_tour_briefing",
            "description": "Morning tour briefing: upcoming shows, flights, hotels, missing confirmations, and due reminders.",
            "arguments": [{"name": "days_ahead", "description": "Days ahead to inspect (default 3)", "required": False}],
        },
        {
            "name": "advancing_reminder_sweep",
            "description": "Scan upcoming confirmed shows for missing flights, hotels, or soundchecks and create reminders.",
            "arguments": [],
        },
        {
            "name": "ingest_promoter_email",
            "description": "Extract flights, hotel, transport, and schedule from a pasted email and add them to a Tour Designer gig.",
            "arguments": [{"name": "email_text", "description": "Raw promoter email or WhatsApp text", "required": True}],
        },
    ]


def _get_prompt(name: str, args: dict[str, Any]) -> dict[str, Any] | None:
    if name == "daily_tour_briefing":
        days = str(args.get("days_ahead") or "3")
        return {
            "description": "Morning tour briefing & reminders check",
            "messages": [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": f"Call get_daily_briefing(days_ahead={days}) in Tour Designer and summarize today's travel, hotel check-ins, soundcheck/set times, any overdue reminders, and missing confirmations in a concise bullet list.",
                    },
                }
            ],
        }
    if name == "advancing_reminder_sweep":
        return {
            "description": "Find missing logistics and create advancing reminders",
            "messages": [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": "Call get_daily_briefing(days_ahead=14) and list_reminders(status='open') in Tour Designer. For any confirmed/advancing gig missing flights, hotel, or soundcheck that doesn't already have an open reminder, call create_reminder with a sensible due date.",
                    },
                }
            ],
        }
    if name == "ingest_promoter_email":
        txt = str(args.get("email_text") or "")
        return {
            "description": "Parse and save promoter logistics into Tour Designer",
            "messages": [
                {
                    "role": "user",
                    "content": {
                        "type": "text",
                        "text": f"Find the matching gig with list_gigs, inspect it with get_gig, and save all confirmed flights, hotels, transfers, schedule items, and contacts from this message without inventing any missing details:\n\n{txt}",
                    },
                }
            ],
        }
    return None


def _normalize_mcp_item_data(col: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize common AI-client field aliases into canonical Tour Designer collection fields."""
    d = {k: v for k, v in raw.items() if k != "person_ids"}

    def _pick(target: str, *aliases: str) -> None:
        if d.get(target):
            return
        for a in aliases:
            val = d.get(a)
            if val is not None and str(val).strip() != "":
                d[target] = val
                return

    def _norm_hhmm(key: str) -> None:
        val = d.get(key)
        if isinstance(val, str) and ("T" in val or len(val) > 5):
            m = re.search(r"(?<!\d)(\d{1,2}:\d{2})(?!\d)", val)
            if m:
                hhmm = m.group(1)
                d[key] = hhmm.zfill(5)

    _pick("notes", "note")
    if col == "flights":
        _pick("flight_no", "flight_number", "flight", "number", "code")
        _pick("airline", "carrier", "airline_name")
        _pick("dep_iata", "from", "origin", "dep", "departure_airport", "from_iata")
        _pick("arr_iata", "to", "destination", "arr", "arrival_airport", "to_iata")
        _pick("dep_time", "departure_time", "departure", "depart", "time", "start_time")
        _pick("arr_time", "arrival_time", "arrival", "arrive", "end_time")
        _pick("ref", "pnr", "confirmation", "confirmation_code", "booking_ref", "record_locator")
        _pick("seats", "seat", "seat_number")
        _norm_hhmm("dep_time")
        _norm_hhmm("arr_time")
    elif col == "transport":
        _pick("time", "pickup_time", "start_time", "dep_time")
        _pick("from", "pickup", "origin", "pickup_location")
        _pick("to", "dropoff", "destination", "dropoff_location")
        _pick("driver_name", "driver", "contact")
        _pick("driver_phone", "phone", "tel")
        _norm_hhmm("time")
    elif col == "hotels":
        _pick("name", "hotel", "hotel_name", "property")
        _pick("check_in", "checkin", "checkin_time", "time")
        _pick("check_out", "checkout", "checkout_time")
        _pick("confirmation", "ref", "confirmation_code", "booking_ref")
    elif col == "schedule":
        _pick("time", "start_time", "start")
        _pick("end_time", "end")
        _pick("title", "label", "activity", "name")
        _pick("location", "venue", "where", "address")
        _norm_hhmm("time")
        _norm_hhmm("end_time")
    elif col == "timetable":
        _pick("start", "start_time", "time")
        _pick("end", "end_time")
        _pick("act", "artist", "title", "name")
        _pick("stage", "room", "location")
        _norm_hhmm("start")
        _norm_hhmm("end")
    return d


async def _call_tool(
    repo: TourRepo,
    user: User,
    name: str,
    args: dict[str, Any],
    *,
    request: Request | None = None,
    tenant_id: str | None = None,
) -> dict[str, Any]:
    actor = ActorContext(actor_id=user.id, actor_name=user.name, channel="mcp")
    root_repo = getattr(request.app.state, "repo", None) if request else repo

    if name == "list_gigs":
        q = str(args.get("query") or "").strip().lower()
        from_d = str(args.get("from_date") or "")
        to_d = str(args.get("to_date") or "")
        inc_arch = bool(args.get("include_archived", False))
        out = []
        for g in repo.list_gigs():
            if not can_access_gig(user, g):
                continue
            if g.archived and not inc_arch:
                continue
            if from_d and g.date and g.date < from_d:
                continue
            if to_d and g.date and g.date > to_d:
                continue
            if q and q not in f"{g.name} {g.venue} {g.city} {g.country} {g.promoter or ''}".lower():
                continue
            h = scrub_gig_header(g, user)
            items = repo.list_items(g.id)
            counts: dict[str, int] = {}
            for it in items:
                if it.collection == "perdiem" and not is_owner(user):
                    continue
                counts[it.collection] = counts.get(it.collection, 0) + 1
            out.append({
                "id": h["id"],
                "date": h["date"],
                "city": h["city"],
                "venue": h["venue"],
                "status": h["status"],
                "fee": h.get("fee"),
                "currency": h.get("currency"),
                "counts": counts,
            })
        return {"ok": True, "gigs": out}

    if name == "get_gig":
        gid = str(args.get("gig_id") or "")
        gig = repo.get_gig(gid)
        if not gig or not can_access_gig(user, gig):
            return {"ok": False, "error": "gig_not_found"}
        header = scrub_gig_header(gig, user)
        items = [d for it in repo.list_items(gid) if (d := scrub_item(it, user)) is not None]
        read_token = _mint_read_token(
            root_repo,
            user_id=user.id,
            tenant_id=tenant_id,
            gig_id=gid,
            gig_version=gig.version,
            item_versions={it["id"]: it["version"] for it in items},
        )
        return {"ok": True, "read_token": read_token, "gig": header, "items": items}

    if name == "create_gig":
        denied = check_gig_write_fields(user, args)
        if denied:
            return {"ok": False, "error": denied}
        if user.artist_ids:
            target_artist = str(args.get("artist_id") or "").strip() or (
                user.artist_ids[0] if len(user.artist_ids) == 1 else ""
            )
            if not can_access_project(user, target_artist):
                return {"ok": False, "error": "project_scope_denied"}
            args = {**args, "artist_id": target_artist}
        if "status" in args:
            args = {**args, "status": GigStatus(str(args["status"]))}
        saved = repo.create_gig(Gig.model_validate(args), actor=actor)
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_create_gig", target_id=saved.id))
        return {"ok": True, "gig": scrub_gig_header(saved, user)}

    if name == "update_gig":
        gid = str(args.get("gig_id") or "")
        token = str(args.get("read_token") or "")
        seen = _verify_read_token(root_repo, user_id=user.id, tenant_id=tenant_id, gig_id=gid, token=token)
        if not seen:
            return {"ok": False, "error": "read_required", "hint": "Call get_gig first and pass read_token."}
        fields = args.get("fields") if isinstance(args.get("fields"), dict) else {}
        denied = check_gig_write_fields(user, fields)
        if denied:
            return {"ok": False, "error": denied}
        try:
            updated = repo.update_gig(gid, fields, expected_version=seen["gig_version"], actor=actor)
        except ConflictError as exc:
            return {"ok": False, "error": "changed_since_read", "current": exc.current}
        except NotFoundError:
            return {"ok": False, "error": "gig_not_found"}
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_update_gig", target_id=gid))
        return {"ok": True, "gig": scrub_gig_header(updated, user)}

    add_map = {
        "add_flights": ("flights", "flights"),
        "add_transports": ("transport", "transports"),
        "add_hotels": ("hotels", "hotels"),
        "add_schedule_items": ("schedule", "items"),
        "add_timetable_items": ("timetable", "items"),
        "add_crew": ("crew", "people"),
        "add_contacts": ("contacts", "people"),
    }
    if name in add_map or name == "add_items":
        gid = str(args.get("gig_id") or "")
        gig_obj = repo.get_gig(gid)
        if not gig_obj or not can_access_gig(user, gig_obj):
            return {"ok": False, "error": "gig_not_found"}
        if name in add_map:
            col, key = add_map[name]
            raw_list = args.get(key) or []
        else:
            col = str(args.get("collection") or "")
            raw_list = args.get("items") or []
        if col not in EDITABLE_MCP_COLLECTIONS:
            return {"ok": False, "error": "collection_not_editable"}
        denied = check_collection_write(user, col)
        if denied:
            return {"ok": False, "error": denied}
        items = [
            GigItem(
                gig_id=gid,
                collection=col,  # type: ignore[arg-type]
                data=_normalize_mcp_item_data(col, row),
                person_ids=row.get("person_ids") if isinstance(row.get("person_ids"), list) else [],
            )
            for row in raw_list
            if isinstance(row, dict)
        ]
        bid = new_id("bat")
        try:
            added = repo.add_items(gid, items, batch_id=bid, actor=actor)
        except NotFoundError:
            return {"ok": False, "error": "gig_not_found"}
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action=f"mcp_{name}", target_id=gid, summary=f"Added {len(added)} {col}"))
        return {"ok": True, "batch_id": bid, "added_count": len(added), "added_ids": [a.id for a in added]}

    if name == "append_gig_note":
        gid = str(args.get("gig_id") or "")
        bid = new_id("bat")
        added = repo.add_items(
            gid,
            [GigItem(gig_id=gid, collection="notes_list", data={"title": args.get("title") or "", "body": str(args.get("body") or "")})],
            batch_id=bid,
            actor=actor,
        )
        return {"ok": True, "batch_id": bid, "added_ids": [a.id for a in added]}

    if name == "update_item":
        gid = str(args.get("gig_id") or "")
        iid = str(args.get("item_id") or "")
        token = str(args.get("read_token") or "")
        seen = _verify_read_token(root_repo, user_id=user.id, tenant_id=tenant_id, gig_id=gid, token=token)
        if not seen or iid not in seen["item_versions"]:
            return {"ok": False, "error": "read_required", "hint": "Call get_gig first and pass read_token."}
        fields = args.get("fields") if isinstance(args.get("fields"), dict) else {}
        existing = next((it for it in repo.list_items(gid) if it.id == iid), None)
        if existing:
            fields = _normalize_mcp_item_data(existing.collection, fields)
        try:
            updated = repo.update_item(gid, iid, fields, expected_version=seen["item_versions"][iid], actor=actor)
        except ConflictError as exc:
            return {"ok": False, "error": "changed_since_read", "current": exc.current}
        except NotFoundError:
            return {"ok": False, "error": "item_not_found"}
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_update_item", target_id=f"{gid}/{iid}"))
        return {"ok": True, "item": updated.model_dump(mode="json")}

    if name == "remove_item":
        if args.get("confirm") is not True:
            return {"ok": False, "error": "confirmation_required"}
        gid = str(args.get("gig_id") or "")
        iid = str(args.get("item_id") or "")
        token = str(args.get("read_token") or "")
        seen = _verify_read_token(root_repo, user_id=user.id, tenant_id=tenant_id, gig_id=gid, token=token)
        if not seen or iid not in seen["item_versions"]:
            return {"ok": False, "error": "read_required", "hint": "Call get_gig first and pass read_token."}
        try:
            repo.remove_item(gid, iid, expected_version=seen["item_versions"][iid], actor=actor)
        except ConflictError as exc:
            return {"ok": False, "error": "changed_since_read", "current": exc.current}
        except NotFoundError:
            return {"ok": False, "error": "item_not_found"}
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_remove_item", target_id=f"{gid}/{iid}"))
        return {"ok": True, "removed_id": iid}

    if name == "list_people":
        q = str(args.get("query") or "").strip().lower()
        people = [
            p.model_dump(mode="json")
            for p in repo.list_people()
            if not q or q in f"{p.name} {p.role or ''} {p.company or ''} {p.email or ''}".lower()
        ]
        return {"ok": True, "people": people}

    if name == "update_person":
        pid = str(args.get("person_id") or "")
        person = repo.get_person(pid)
        if not person:
            return {"ok": False, "error": "person_not_found"}
        fields = args.get("fields") if isinstance(args.get("fields"), dict) else {}
        for k in ("name", "role", "company", "phone", "email", "notes", "person_kind"):
            if k in fields:
                setattr(person, k, fields[k])
        saved = repo.upsert_person(person)
        return {"ok": True, "person": saved.model_dump(mode="json")}

    if name == "get_daily_briefing":
        days = max(1, min(30, int(args.get("days_ahead") or 7)))
        artist_filter = str(args.get("artist_id") or "").strip()
        today = date.today()
        end_iso = (today + timedelta(days=days)).isoformat()
        today_iso = today.isoformat()
        upcoming: list[dict[str, Any]] = []
        gaps: list[dict[str, Any]] = []
        for g in repo.list_gigs():
            if g.archived or g.deleted_at or not can_access_gig(user, g):
                continue
            if artist_filter and g.artist_id != artist_filter:
                continue
            if not g.date or g.date < today_iso or g.date > end_iso:
                continue
            items = [scrub_item(it, user) for it in repo.list_items(g.id)]
            by_col: dict[str, list[dict[str, Any]]] = {}
            for it in items:
                by_col.setdefault(it["collection"], []).append(it["data"])
            upcoming.append(
                {
                    "gig": scrub_gig_header(g, user),
                    "flights": by_col.get("flights", []),
                    "transport": by_col.get("transport", []),
                    "hotels": by_col.get("hotels", []),
                    "schedule": by_col.get("schedule", []),
                    "timetable": by_col.get("timetable", []),
                }
            )
            status_val = str(g.status.value if isinstance(g.status, GigStatus) else g.status)
            if status_val in {"confirmed", "announced", "advancing"}:
                missing = []
                if not by_col.get("flights"):
                    missing.append("flights")
                if not by_col.get("hotels"):
                    missing.append("hotel")
                if not (g.soundcheck_time or any("soundcheck" in str(s.get("label") or s.get("title") or "").lower() for s in by_col.get("schedule", []))):
                    missing.append("soundcheck")
                if missing:
                    gaps.append({"gig_id": g.id, "date": g.date, "city": g.city, "venue": g.venue, "missing": missing})
        reminders = []
        for r in _load_reminders(repo):
            if r.get("done"):
                continue
            rem = dict(r)
            rem["overdue"] = _is_overdue(str(rem.get("due_at") or ""), False)
            reminders.append(rem)
        reminders.sort(key=lambda r: str(r.get("due_at") or "9999"))
        return {
            "ok": True,
            "date": today_iso,
            "days_ahead": days,
            "upcoming_gigs": upcoming,
            "logistics_gaps": gaps,
            "open_reminders": reminders,
        }

    if name == "list_reminders":
        status_f = str(args.get("status") or "open").strip().lower()
        gid_f = str(args.get("gig_id") or "").strip()
        out = []
        for r in _load_reminders(repo):
            done = bool(r.get("done", False))
            if status_f == "open" and done:
                continue
            if status_f == "done" and not done:
                continue
            if gid_f and r.get("gig_id") != gid_f:
                continue
            if r.get("gig_id"):
                g = repo.get_gig(str(r["gig_id"]))
                if g and not can_access_gig(user, g):
                    continue
            rem = dict(r)
            rem["overdue"] = _is_overdue(str(rem.get("due_at") or ""), done)
            out.append(rem)
        out.sort(key=lambda r: (bool(r.get("done", False)), str(r.get("due_at") or "9999")))
        return {"ok": True, "reminders": out}

    if name == "create_reminder":
        title = str(args.get("title") or "").strip()
        due_at = str(args.get("due_at") or "").strip()
        if not title or not due_at:
            return {"ok": False, "error": "title_and_due_at_required"}
        gid = str(args.get("gig_id") or "").strip() or None
        if gid:
            g = repo.get_gig(gid)
            if not g or not can_access_gig(user, g):
                return {"ok": False, "error": "gig_not_found"}
        priority = str(args.get("priority") or "normal").strip().lower()
        if priority not in {"low", "normal", "high"}:
            priority = "normal"
        repeat = str(args.get("repeat") or "none").strip().lower()
        if repeat not in {"none", "daily", "weekly"}:
            repeat = "none"
        rem = {
            "id": new_id("rem"),
            "title": title[:200],
            "due_at": due_at[:40],
            "gig_id": gid,
            "notes": str(args.get("notes") or "").strip()[:1000],
            "priority": priority,
            "repeat": repeat,
            "done": False,
            "created_by": user.name,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        reminders = _load_reminders(repo)
        reminders.append(rem)
        _save_reminders(repo, reminders)
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_create_reminder", target_id=rem["id"], summary=title[:120]))
        return {"ok": True, "reminder": rem}

    if name == "complete_reminder":
        rid = str(args.get("reminder_id") or "").strip()
        done_val = bool(args.get("done", True))
        reminders = _load_reminders(repo)
        target = next((r for r in reminders if r.get("id") == rid), None)
        if not target:
            return {"ok": False, "error": "reminder_not_found"}
        if done_val and target.get("repeat") in {"daily", "weekly"}:
            target["due_at"] = _advance_due(str(target.get("due_at") or ""), str(target["repeat"]))
            target["done"] = False
            target["last_completed_at"] = datetime.now(timezone.utc).isoformat()
        else:
            target["done"] = done_val
            target["completed_at"] = datetime.now(timezone.utc).isoformat() if done_val else None
        _save_reminders(repo, reminders)
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_complete_reminder", target_id=rid))
        return {"ok": True, "reminder": target}

    if name == "delete_reminder":
        rid = str(args.get("reminder_id") or "").strip()
        reminders = _load_reminders(repo)
        remaining = [r for r in reminders if r.get("id") != rid]
        if len(remaining) == len(reminders):
            return {"ok": False, "error": "reminder_not_found"}
        _save_reminders(repo, remaining)
        repo.append_audit(AuditEvent(actor_id=user.id, actor_name=user.name, channel="mcp", action="mcp_delete_reminder", target_id=rid))
        return {"ok": True, "deleted_id": rid}

    if name == "list_files":
        gid_f = str(args.get("gig_id") or "").strip() or None
        kind_f = str(args.get("doc_kind") or "").strip().lower()
        q = str(args.get("query") or "").strip().lower()
        files = repo.list_files(gig_id=gid_f)
        visible_gigs: set[str] | None = None
        if user.artist_ids:
            visible_gigs = {g.id for g in repo.list_gigs() if can_access_gig(user, g)}
        owner = is_owner(user)
        out_files: list[dict[str, Any]] = []
        for f in files:
            if f.scope == "private" and not owner and f.added_by != user.id:
                continue
            if visible_gigs is not None and f.gig_id and f.gig_id not in visible_gigs:
                continue
            if kind_f and (f.doc_kind or "").lower() != kind_f:
                continue
            if q and q not in f"{f.name} {f.doc_kind or ''} {f.mime}".lower():
                continue
            out_files.append(
                {
                    "id": f.id,
                    "name": f.name,
                    "mime": f.mime,
                    "size": f.size,
                    "gig_id": f.gig_id,
                    "person_id": f.person_id,
                    "doc_kind": f.doc_kind,
                    "doc_expires": f.doc_expires,
                    "pinned": f.pinned,
                    "added_at": f.added_at,
                }
            )
        return {"ok": True, "files": out_files}

    if name == "get_file":
        fid = str(args.get("file_id") or "").strip()
        if not fid:
            return {"ok": False, "error": "file_id_required"}
        rec = repo.get_file(fid)
        if not rec:
            return {"ok": False, "error": "file_not_found"}
        if rec.scope == "private" and not is_owner(user) and rec.added_by != user.id:
            return {"ok": False, "error": "file_not_found"}
        if rec.gig_id and user.artist_ids:
            gig = repo.get_gig(rec.gig_id)
            if not gig or not can_access_gig(user, gig):
                return {"ok": False, "error": "file_not_found"}

        settings = getattr(request.app.state, "settings", None) if request else None
        root_repo = getattr(request.app.state, "repo", None) if request else repo
        if settings and settings.file_storage_backend == "gcs" and rec.gcs_key and settings.file_vault_bucket:
            download_url = _sign_gcs_url(rec.gcs_key, method="GET")
        elif request is not None:
            sig = mint_mcp_file_token(root_repo, file_id=rec.id, tenant_id=tenant_id, ttl_seconds=900)
            origin = (settings.public_origin if settings else "").rstrip("/") or str(request.base_url).rstrip("/")
            base = settings.normalized_base_path if settings else ""
            download_url = f"{origin}{base}/api/files/mcp/{sig}"
        else:
            download_url = f"/api/files/{rec.id}/download"

        mime = (rec.mime or "application/octet-stream").split(";")[0].strip().lower()
        payload: dict[str, Any] = {
            "ok": True,
            "file": {
                "id": rec.id,
                "name": rec.name,
                "mime": mime,
                "size": rec.size,
                "gig_id": rec.gig_id,
                "doc_kind": rec.doc_kind,
                "doc_expires": rec.doc_expires,
            },
            "download_url": download_url,
            "expires_in_seconds": 900,
        }

        extra_blocks: list[dict[str, Any]] = []
        include_content = bool(args.get("include_content", True))
        if include_content:
            raw_preview: bytes | None = None
            preview_mime = mime
            is_preview_type = (
                mime in {"image/png", "image/jpeg", "image/webp", "image/gif"}
                or mime.startswith("text/")
                or mime == "application/json"
            )
            max_preview = 2 * 1024 * 1024 if mime.startswith("image/") else 64 * 1024
            if is_preview_type and settings and settings.file_storage_backend == "gcs" and rec.gcs_key and settings.file_vault_bucket and not rec.gcs_key.startswith("local/"):
                try:
                    raw_preview = download_gcs_bytes(settings.file_vault_bucket, rec.gcs_key, max_bytes=max_preview)
                except Exception:
                    raw_preview = None
            if raw_preview is None and (not settings or settings.file_storage_backend != "gcs"):
                local_path = _safe_local_path(rec.object_id, settings, tenant_id)
                if local_path and local_path.is_file() and local_path.stat().st_size <= max_preview:
                    raw_preview = local_path.read_bytes()
            if raw_preview is None and rec.drive_file_id and (not settings or settings.tenancy_mode != "multi"):
                fetched = _fetch_drive_bytes(rec.drive_file_id, mime)
                if fetched is not None and len(fetched[0]) <= max_preview:
                    raw_preview, preview_mime = fetched
            if raw_preview is not None:
                if preview_mime in {"image/png", "image/jpeg", "image/webp", "image/gif"}:
                    b64 = base64.b64encode(raw_preview).decode("ascii")
                    extra_blocks.append({"type": "image", "data": b64, "mimeType": preview_mime})
                elif (preview_mime.startswith("text/") or preview_mime == "application/json") and len(raw_preview) <= 64 * 1024:
                    payload["text_content"] = raw_preview.decode("utf-8", errors="replace")[:32000]

        extra_blocks.append({"type": "resource_link", "uri": download_url, "name": rec.name, "mimeType": mime})
        payload["_mcp_extra_content"] = extra_blocks
        return payload

    if name == "upload_file":
        raw_name = str(args.get("filename") or "").strip()
        if not raw_name:
            return {"ok": False, "error": "filename_required"}
        safe_name = _sanitize_filename(raw_name)
        mime = str(args.get("mime") or "application/octet-stream").split(";")[0].strip().lower()

        b64_in = args.get("content_base64")
        txt_in = args.get("text_content")
        src_url = args.get("source_url")
        raw_bytes: bytes | None = None
        if isinstance(b64_in, str) and b64_in.strip():
            cleaned_b64 = b64_in.strip()
            if cleaned_b64.startswith("data:") and "," in cleaned_b64:
                header, cleaned_b64 = cleaned_b64.split(",", 1)
                if ";" in header and ":" in header:
                    mime = header.split(":", 1)[1].split(";", 1)[0].strip().lower() or mime
            try:
                raw_bytes = base64.b64decode(cleaned_b64, validate=True)
            except Exception:
                return {"ok": False, "error": "invalid_base64"}
        elif isinstance(txt_in, str):
            raw_bytes = txt_in.encode("utf-8")
            if mime == "application/octet-stream":
                mime = "text/plain"
        elif isinstance(src_url, str) and src_url.strip():
            try:
                raw_bytes, fetched_mime = await _download_safe_source_url(src_url.strip())
                if fetched_mime and mime == "application/octet-stream":
                    mime = fetched_mime
            except ValueError as exc:
                return {"ok": False, "error": str(exc)}
            except Exception as exc:
                return {"ok": False, "error": f"source_url_fetch_failed:{type(exc).__name__}"}
        else:
            return {"ok": False, "error": "content_base64_or_text_content_or_source_url_required"}

        total = len(raw_bytes)
        if total > MAX_LOCAL_UPLOAD_BYTES:
            return {"ok": False, "error": "file_too_large"}

        gid = str(args.get("gig_id") or "").strip() or None
        if gid:
            gig = repo.get_gig(gid)
            if not gig or not can_access_gig(user, gig):
                return {"ok": False, "error": "gig_not_found"}

        pid = str(args.get("person_id") or "").strip() or None
        pname = str(args.get("person_name") or "").strip().lower()
        if not pid and pname:
            match = next((p for p in repo.list_people() if pname in p.name.lower()), None)
            if match:
                pid = match.id

        settings = getattr(request.app.state, "settings", None) if request else None
        if settings and settings.tenancy_mode == "multi" and settings.hosted_max_files_mb > 0:
            used_bytes = sum(max(0, int(f.size or 0)) for f in repo.list_files())
            if used_bytes + total > settings.hosted_max_files_mb * 1024 * 1024:
                return {"ok": False, "error": "quota_storage_exceeded"}

        object_id = new_id("obj")
        use_gcs = bool(settings and settings.file_storage_backend == "gcs" and settings.file_vault_bucket)
        if use_gcs:
            assert settings is not None
            gcs_key = f"tenants/{tenant_id}/{object_id}" if tenant_id else object_id
            upload_gcs_bytes(settings.file_vault_bucket, gcs_key, raw_bytes, mime)
        else:
            dest = _safe_local_path(object_id, settings, tenant_id)
            if dest is None:
                return {"ok": False, "error": "invalid_object_id"}
            dest.write_bytes(raw_bytes)
            gcs_key = f"local/{object_id}"

        rec = FileRecord(
            object_id=object_id,
            gig_id=gid,
            person_id=pid,
            name=safe_name,
            mime=mime,
            size=total,
            content_sha256=hashlib.sha256(raw_bytes).hexdigest(),
            gcs_key=gcs_key,
            doc_kind=str(args.get("doc_kind") or "").strip() or None,
            doc_expires=str(args.get("doc_expires") or "").strip() or None,
            pinned=bool(args.get("pinned", False)),
            scope="private" if args.get("scope") == "private" else "crew",
            added_by=user.id,
        )
        saved = repo.upsert_file(rec)
        repo.append_audit(
            AuditEvent(
                actor_id=user.id,
                actor_name=user.name,
                channel="mcp",
                action="mcp_upload_file",
                target_id=saved.id,
                summary=f"Uploaded {saved.name}" + (f" -> gig {gid}" if gid else ""),
            )
        )
        return {"ok": True, "file": saved.model_dump(mode="json")}

    if name == "assign_file":
        fid = str(args.get("file_id") or "").strip()
        rec = repo.get_file(fid)
        if not rec:
            return {"ok": False, "error": "file_not_found"}
        if rec.scope == "private" and not is_owner(user) and rec.added_by != user.id:
            return {"ok": False, "error": "file_not_found"}
        if "gig_id" in args:
            gid = str(args.get("gig_id") or "").strip() or None
            if gid:
                gig = repo.get_gig(gid)
                if not gig or not can_access_gig(user, gig):
                    return {"ok": False, "error": "gig_not_found"}
            rec.gig_id = gid
        if "person_id" in args:
            rec.person_id = str(args.get("person_id") or "").strip() or None
        elif args.get("person_name"):
            pname = str(args.get("person_name") or "").strip().lower()
            match = next((p for p in repo.list_people() if pname in p.name.lower()), None)
            if match:
                rec.person_id = match.id
        if "doc_kind" in args:
            rec.doc_kind = str(args.get("doc_kind") or "").strip() or None
        if "pinned" in args:
            rec.pinned = bool(args["pinned"])
        if "scope" in args:
            rec.scope = "private" if args["scope"] == "private" else "crew"
        saved = repo.upsert_file(rec)
        repo.append_audit(
            AuditEvent(
                actor_id=user.id,
                actor_name=user.name,
                channel="mcp",
                action="mcp_assign_file",
                target_id=saved.id,
                summary=f"Assigned {saved.name}",
            )
        )
        return {"ok": True, "file": saved.model_dump(mode="json")}

    return {"ok": False, "error": f"unknown_tool:{name}"}


async def _handle_mcp_post(token: str, request: Request) -> Response:
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("mcp_key", ip):
        return JSONResponse(_rpc_error(None, -32000, "rate_limited"), status_code=429)
    if not token:
        AUTH_LIMITER.record("mcp_key", ip)
        return JSONResponse(_rpc_error(None, -32001, "unauthorized"), status_code=401)
    settings = getattr(request.app.state, "settings", None)
    tenant_id: str | None = None
    if settings is not None and settings.tenancy_mode == "multi":
        tenant_id, raw_secret = parse_scoped_token(token)
        repo = request.app.state.tenant_manager.get_repo(tenant_id)
        if repo is None:
            AUTH_LIMITER.record("mcp_key", ip)
            return JSONResponse(_rpc_error(None, -32001, "unauthorized"), status_code=401)
    else:
        raw_secret = token
        repo = request.app.state.repo
    user = repo.find_user_by_mcp_key_hash(hash_secret(raw_secret))
    if not user or user.revoked or str(user.role) == "viewer":
        AUTH_LIMITER.record("mcp_key", ip)
        return JSONResponse(_rpc_error(None, -32001, "unauthorized"), status_code=401)
    body = await request.body()
    if len(body) > _MAX_UPLOAD_BODY_BYTES:
        return JSONResponse(_rpc_error(None, -32600, "request too large"), status_code=413)
    try:
        msg = json.loads(body)
    except Exception:
        return JSONResponse(_rpc_error(None, -32700, "parse_error"), status_code=400)

    req_id = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}
    if len(body) > _MAX_BODY_BYTES and not (
        method == "tools/call" and str(params.get("name") or "") == "upload_file"
    ):
        return JSONResponse(_rpc_error(req_id, -32600, "request too large"), status_code=413)

    if method == "initialize":
        return JSONResponse(
            _rpc_result(
                req_id,
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {"tools": {}, "prompts": {}},
                    "serverInfo": {"name": "tour-designer", "version": "2.0.0"},
                },
            )
        )
    if method == "notifications/initialized":
        return Response(status_code=202)
    if method == "ping":
        return JSONResponse(_rpc_result(req_id, {}))
    if method == "tools/list":
        return JSONResponse(_rpc_result(req_id, {"tools": _tool_list(user)}))
    if method == "prompts/list":
        return JSONResponse(_rpc_result(req_id, {"prompts": _prompt_list()}))
    if method == "prompts/get":
        p = _get_prompt(str(params.get("name") or ""), params.get("arguments") or {})
        if not p:
            return JSONResponse(_rpc_error(req_id, -32602, "prompt_not_found"), status_code=200)
        return JSONResponse(_rpc_result(req_id, p))
    if method == "tools/call":
        res = await _call_tool(
            repo,
            user,
            str(params.get("name") or ""),
            params.get("arguments") or {},
            request=request,
            tenant_id=tenant_id,
        )
        extra_blocks = res.pop("_mcp_extra_content", None) if isinstance(res, dict) else None
        content_blocks: list[dict[str, Any]] = [
            {"type": "text", "text": json.dumps(res, ensure_ascii=False)}
        ]
        if isinstance(extra_blocks, list):
            content_blocks.extend(extra_blocks)
        return JSONResponse(
            _rpc_result(
                req_id,
                {
                    "content": content_blocks,
                    "isError": not bool(res.get("ok", False)),
                },
            )
        )
    return JSONResponse(_rpc_error(req_id, -32601, f"method_not_found:{method}"), status_code=200)


@router.post("/mcp/{token}")
async def mcp_post(token: str, request: Request) -> Response:
    return await _handle_mcp_post(token, request)


@router.post("/mcp")
async def mcp_post_bearer(request: Request) -> Response:
    """Bearer-token Streamable HTTP MCP endpoint for clients preferring Authorization header (ChatGPT, Grok, n8n, Codex)."""
    auth = request.headers.get("authorization") or ""
    token = ""
    if auth.lower().startswith("bearer "):
        token = auth[7:].strip()
    if not token:
        token = (request.headers.get("x-mcp-token") or "").strip()
    return await _handle_mcp_post(token, request)


@router.get("/mcp")
@router.delete("/mcp")
@router.get("/mcp/{token}")
@router.delete("/mcp/{token}")
def mcp_method_not_allowed(token: str = "") -> Response:
    return Response(status_code=405, headers={"Allow": "POST"})
