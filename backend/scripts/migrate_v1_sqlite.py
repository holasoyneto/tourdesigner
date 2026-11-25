"""Idempotent migrator from legacy single-blob SQLite to normalized TourRepo storage.

Canonicalizes contacts from directory and per-gig rosters, splits gig collections into
independently versioned GigItem records, hashes login and MCP credentials verbatim,
preserves existing /link/<key> share links, and outputs a strict parity report.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Allow running directly as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import Settings
from app.domain.auth import hash_secret
from app.domain.models import (
    ALL_COLLECTIONS,
    FileRecord,
    Gig,
    GigItem,
    GigStatus,
    Invite,
    Person,
    Project,
    Role,
    ShareLink,
    User,
    new_id,
    now_iso,
)
from app.repo.factory import build_repo
from app.repo.protocol import ActorContext, TourRepo


def _norm_email(v: Any) -> str | None:
    s = str(v or "").strip().lower()
    return s if "@" in s and "." in s else None


def _norm_phone(v: Any) -> str | None:
    digits = "".join(ch for ch in str(v or "") if ch.isdigit())
    if digits.startswith("00"):
        digits = digits[2:]
    return digits if 7 <= len(digits) <= 16 else None


def _safe_status(val: Any) -> GigStatus:
    try:
        return GigStatus(str(val or "hold"))
    except ValueError:
        return GigStatus.hold


def migrate_v1_sqlite(
    sqlite_path: str | Path,
    repo: TourRepo,
    *,
    dry_run: bool = False,
    source_vault_dir: str | Path | None = None,
    target_vault_dir: str | Path | None = None,
    copy_drive_files: bool = False,
) -> dict[str, Any]:
    conn = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    actor = ActorContext(actor_id="migration", actor_name="v1->v2 migrator", channel="migration")

    tables = {r["name"] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    source_stats: dict[str, Any] = {
        "gigs": 0,
        "trash": 0,
        "items_by_collection": {},
        "total_fee_sum": 0.0,
        "users": 0,
        "share_links": 0,
        "files": 0,
    }

    # 1. Canonicalize People from settings: person_directory_v1:*
    people_by_id: dict[str, Person] = {}
    email_to_pid: dict[str, str] = {}
    phone_to_pid: dict[str, str] = {}

    def _register_person(p: Person) -> Person:
        people_by_id[p.id] = p
        em = _norm_email(p.email)
        if em:
            email_to_pid.setdefault(em, p.id)
        ph = _norm_phone(p.phone)
        if ph:
            phone_to_pid.setdefault(ph, p.id)
        return p

    people_files: list[FileRecord] = []

    if "settings" in tables:
        for row in conn.execute("SELECT key, data FROM settings").fetchall():
            key: str = row["key"]
            try:
                payload = json.loads(row["data"])
            except Exception:
                continue
            if key.startswith("person_directory_v1:") and isinstance(payload, dict):
                pid = key.removeprefix("person_directory_v1:")
                p = Person(
                    id=pid,
                    name=str(payload.get("name") or ""),
                    person_kind=payload.get("person_kind"),
                    role=payload.get("role"),
                    company=payload.get("company"),
                    phone=payload.get("phone"),
                    email=payload.get("email"),
                    notes=payload.get("notes"),
                    loyalty=payload.get("loyalty") if isinstance(payload.get("loyalty"), list) else [],
                    profile=payload.get("profile") if isinstance(payload.get("profile"), dict) else {},
                    permanent=bool(payload.get("permanent", False)),
                    merged_into=payload.get("merged_into"),
                )
                _register_person(p)
                for pf in payload.get("files") or payload.get("documents") or []:
                    if not isinstance(pf, dict) or pf.get("deleted"):
                        continue
                    poid = str(pf.get("object_id") or new_id("obj"))
                    people_files.append(
                        FileRecord(
                            id=str(pf.get("id") or new_id("fil")),
                            object_id=poid,
                            gig_id=pf.get("gig_id"),
                            person_id=pid,
                            name=str(pf.get("name") or "document"),
                            mime=str(pf.get("mime") or "application/octet-stream"),
                            size=int(pf.get("size") or 0),
                            content_sha256=pf.get("content_sha256"),
                            gcs_key=pf.get("gcs_key"),
                            drive_file_id=pf.get("drive_file_id"),
                            doc_kind=pf.get("doc_kind"),
                            doc_country=pf.get("doc_country"),
                            doc_expires=pf.get("doc_expires"),
                            pinned=bool(pf.get("pinned", True)),
                            added_at=str(pf.get("added_at") or now_iso()),
                            added_by=pf.get("added_by"),
                        )
                    )
            elif key not in {"person_merge_receipt_v1:", "projects", "ai_intake"} and not key.startswith("person_merge_receipt_v1:"):
                if not dry_run:
                    repo.set_setting(key, payload)

    # 1b. Load v1 vault_objects (object_id -> {backend, key, location, sha256, size}), file_mirror_jobs, & artists -> v2 projects
    vault_meta: dict[str, dict[str, Any]] = {}
    if "vault_objects" in tables:
        for row in conn.execute("SELECT object_id, data FROM vault_objects").fetchall():
            try:
                vdata = json.loads(row["data"])
                if isinstance(vdata, dict):
                    vault_meta[str(row["object_id"])] = vdata
            except Exception:
                continue

    mirror_drive_ids: dict[str, str] = {}
    if "file_mirror_jobs" in tables:
        for row in conn.execute("SELECT file_id, drive_file_id FROM file_mirror_jobs").fetchall():
            if row["file_id"] and row["drive_file_id"]:
                mirror_drive_ids[str(row["file_id"])] = str(row["drive_file_id"])

    migrated_projects: list[Project] = []
    if "artists" in tables:
        palette = ["#f3c64a", "#6ea8fe", "#5fd39f", "#ff7a7a", "#c084fc", "#f59e0b"]
        for idx, row in enumerate(conn.execute("SELECT id, data FROM artists").fetchall()):
            try:
                adata = json.loads(row["data"])
                pid = str(row["id"] or adata.get("id") or "").strip()
                pname = str(adata.get("name") or pid).strip()
                if pid and pname:
                    migrated_projects.append(
                        Project(
                            id=pid,
                            name=pname[:80],
                            color=str(adata.get("color") or palette[idx % len(palette)]),
                            notes=str(adata.get("notes") or "")[:400],
                            archived=bool(adata.get("archived", False)),
                        )
                    )
            except Exception:
                continue

    def _resolve_or_create_person(raw: dict[str, Any]) -> str:
        pkey = str(raw.get("person_key") or "").strip()
        if pkey and pkey in people_by_id:
            p = people_by_id[pkey]
            for f in ("name", "role", "phone", "email", "person_kind"):
                if not getattr(p, f) and raw.get(f):
                    setattr(p, f, raw.get(f))
            return p.id
        em = _norm_email(raw.get("email"))
        if em and em in email_to_pid:
            return email_to_pid[em]
        ph = _norm_phone(raw.get("phone"))
        if ph and ph in phone_to_pid:
            return phone_to_pid[ph]
        pid = pkey or new_id("per")
        p = Person(
            id=pid,
            name=str(raw.get("name") or ""),
            person_kind=raw.get("person_kind"),
            role=raw.get("role"),
            phone=raw.get("phone"),
            email=raw.get("email"),
            notes=raw.get("notes"),
            profile=raw.get("profile") if isinstance(raw.get("profile"), dict) else {},
        )
        _register_person(p)
        return pid

    # 2. Migrate gigs & trashed gigs
    migrated_gigs: list[tuple[Gig, list[GigItem], list[FileRecord], list[ShareLink]]] = []
    seen_item_ids: set[str] = set()
    seen_file_ids: set[str] = {pf.id for pf in people_files}

    def _parse_gig_doc(raw: dict[str, Any], *, deleted_at: str | None = None, deleted_by: str | None = None):
        drive = raw.get("drive") if isinstance(raw.get("drive"), dict) else {}
        gig = Gig(
            id=str(raw.get("id") or new_id("gig")),
            artist_id=raw.get("artist_id"),
            tour_id=raw.get("tour_id"),
            name=str(raw.get("name") or ""),
            date=str(raw.get("date") or raw.get("show_date") or ""),
            venue=str(raw.get("venue") or ""),
            city=str(raw.get("city") or ""),
            country=str(raw.get("country") or ""),
            timezone=raw.get("timezone"),
            venue_address=raw.get("venue_address"),
            venue_website=raw.get("venue_website"),
            venue_instagram=raw.get("venue_instagram"),
            venue_phone=raw.get("venue_phone"),
            venue_type=raw.get("venue_type"),
            venue_capacity=raw.get("venue_capacity"),
            set_time=str(raw.get("set_time") or ""),
            set_end=raw.get("set_end"),
            set_day_offset=raw.get("set_day_offset"),
            doors_time=raw.get("doors_time"),
            soundcheck_time=raw.get("soundcheck_time"),
            status=_safe_status(raw.get("status")),
            ticket_url=raw.get("ticket_url"),
            promoter=raw.get("promoter"),
            fee=raw.get("fee"),
            currency=str(raw.get("currency") or "EUR"),
            deal_type=raw.get("deal_type"),
            notes=str(raw.get("notes") or ""),
            tour_page_dismissed=bool(raw.get("tour_page_dismissed", False)),
            archived=bool(raw.get("archived", False)),
            deleted_at=deleted_at,
            deleted_by=deleted_by,
            custom=raw.get("custom") if isinstance(raw.get("custom"), dict) else {},
            drive_folder_id=drive.get("folder_id"),
            drive_sheet_id=drive.get("sheet_id"),
            source=str(raw.get("source") or "migration"),
            updated_at=str(raw.get("updated_at") or now_iso()),
            items_updated_at=str(raw.get("updated_at") or now_iso()),
        )

        # Build per-gig wire_row_id -> canonical person_id map first from crew + contacts
        row_to_person: dict[str, str] = {}
        shares: list[ShareLink] = []
        items: list[GigItem] = []
        files: list[FileRecord] = []

        master_share = raw.get("master_share")
        if isinstance(master_share, dict) and master_share.get("key"):
            shares.append(
                ShareLink(
                    key=str(master_share["key"]),
                    scope="gig_master",
                    gig_id=gig.id,
                    label=f"{gig.city or gig.venue or gig.date} (master)",
                    enabled=bool(master_share.get("enabled", False)),
                    can_edit=bool(master_share.get("can_edit", False)),
                    expires_at=master_share.get("expires_at"),
                    last_seen=master_share.get("last_seen"),
                )
            )

        for col in ("crew", "contacts"):
            for entry in raw.get(col) or []:
                if not isinstance(entry, dict) or entry.get("deleted"):
                    continue
                pid = _resolve_or_create_person(entry)
                if entry.get("id"):
                    row_to_person[str(entry["id"])] = pid
                if col == "crew":
                    sh = entry.get("share")
                    if isinstance(sh, dict) and sh.get("key"):
                        shares.append(
                            ShareLink(
                                key=str(sh["key"]),
                                scope="gig_crew",
                                gig_id=gig.id,
                                person_id=pid,
                                label=str(entry.get("name") or ""),
                                enabled=bool(sh.get("enabled", False)),
                                can_edit=bool(sh.get("can_edit", False)),
                                expires_at=sh.get("expires_at"),
                                last_seen=sh.get("last_seen"),
                            )
                        )

        for col in ALL_COLLECTIONS:
            entries = raw.get(col) or []
            for entry in entries:
                if not isinstance(entry, dict) or entry.get("deleted"):
                    continue
                if col == "files":
                    fid = str(entry.get("id") or new_id("fil"))
                    if fid in seen_file_ids:
                        fid = new_id("fil")
                    seen_file_ids.add(fid)
                    oid = str(entry.get("object_id") or new_id("obj"))
                    vm = vault_meta.get(oid, {})
                    gcs_key = entry.get("gcs_key") or (
                        str(vm.get("key") or vm.get("gcs_key") or "").strip() or None
                    )
                    drive_fid = entry.get("drive_file_id") or mirror_drive_ids.get(fid)
                    raw_pid = str(entry.get("person_id") or entry.get("person_key") or "").strip() or None
                    rec = FileRecord(
                        id=fid,
                        object_id=oid,
                        gig_id=gig.id,
                        person_id=(row_to_person.get(raw_pid) if raw_pid else None) or raw_pid,
                        name=str(entry.get("name") or "document"),
                        mime=str(entry.get("mime") or "application/octet-stream"),
                        size=int(entry.get("size") or vm.get("size") or 0),
                        content_sha256=entry.get("content_sha256") or vm.get("sha256"),
                        gcs_key=gcs_key,
                        drive_file_id=drive_fid,
                        doc_kind=entry.get("doc_kind"),
                        doc_country=entry.get("doc_country"),
                        doc_expires=entry.get("doc_expires"),
                        pinned=bool(entry.get("pinned", True)),
                        added_at=str(entry.get("added_at") or now_iso()),
                        added_by=entry.get("added_by"),
                    )
                    files.append(rec)
                    source_stats["files"] += 1
                    continue

                raw_pids = entry.get("person_ids") if isinstance(entry.get("person_ids"), list) else []
                canonical_pids = list(
                    dict.fromkeys(row_to_person.get(str(p), str(p)) for p in raw_pids if p)
                )
                if col in {"crew", "contacts"} and entry.get("id") in row_to_person:
                    canonical_pids = [row_to_person[str(entry["id"])]]

                payload = {
                    k: v
                    for k, v in entry.items()
                    if k not in {"id", "updated_at", "deleted", "person_ids", "share"}
                }
                item_id = str(entry.get("id") or new_id("it"))
                if item_id in seen_item_ids:
                    item_id = new_id("it")
                seen_item_ids.add(item_id)
                items.append(
                    GigItem(
                        id=item_id,
                        gig_id=gig.id,
                        collection=col,
                        data=payload,
                        person_ids=canonical_pids,
                        deleted=False,
                        version=1,
                        updated_at=str(entry.get("updated_at") or gig.updated_at),
                        added_channel="migration",
                    )
                )
                source_stats["items_by_collection"][col] = source_stats["items_by_collection"].get(col, 0) + 1

        return gig, items, files, shares

    if "gigs" in tables:
        for row in conn.execute("SELECT data FROM gigs").fetchall():
            raw = json.loads(row["data"])
            gig, items, files, shares = _parse_gig_doc(raw)
            source_stats["gigs"] += 1
            if gig.fee is not None:
                source_stats["total_fee_sum"] += float(gig.fee)
            migrated_gigs.append((gig, items, files, shares))

    if "gig_trash" in tables:
        for row in conn.execute("SELECT data, deleted_at, deleted_by FROM gig_trash").fetchall():
            raw = json.loads(row["data"])
            gig, items, files, shares = _parse_gig_doc(
                raw, deleted_at=row["deleted_at"], deleted_by=row["deleted_by"]
            )
            source_stats["trash"] += 1
            migrated_gigs.append((gig, items, files, shares))

    # 3. Crew person share keys
    extra_shares: list[ShareLink] = []
    if "crew_keys" in tables:
        for row in conn.execute("SELECT key, data FROM crew_keys").fetchall():
            raw = json.loads(row["data"])
            pid = raw.get("person_key") or raw.get("person_id")
            extra_shares.append(
                ShareLink(
                    key=str(row["key"]),
                    scope="person",
                    person_id=pid,
                    label=str(raw.get("name") or raw.get("label") or ""),
                    enabled=not bool(raw.get("revoked", False)),
                    email_prefs=raw.get("email_prefs") if isinstance(raw.get("email_prefs"), dict) else {},
                )
            )

    # 4. Users & Invites (preserve login_key & mcp_key verbatim via SHA-256 hash)
    migrated_users: list[User] = []
    if "users" in tables:
        for row in conn.execute("SELECT data FROM users").fetchall():
            raw = json.loads(row["data"])
            try:
                role = Role(str(raw.get("role") or "editor"))
            except ValueError:
                role = Role.editor
            u = User(
                id=str(raw.get("id") or new_id("usr")),
                name=str(raw.get("name") or ""),
                email=raw.get("email"),
                role=role,
                artist_ids=[str(a) for a in (raw.get("artist_ids") or []) if a],
                travel_person_id=raw.get("travel_person_id") or raw.get("travel_person_key"),
                google_sub=raw.get("google_sub"),
                revoked=bool(raw.get("revoked", False)),
                login_key_hash=hash_secret(raw["login_key"]) if raw.get("login_key") else None,
                mcp_key_hash=hash_secret(raw["mcp_key"]) if raw.get("mcp_key") else None,
                created_at=str(raw.get("created_at") or now_iso()),
                last_seen_at=raw.get("last_seen_at"),
            )
            migrated_users.append(u)
            source_stats["users"] += 1

    migrated_invites: list[Invite] = []
    if "invites" in tables:
        for row in conn.execute("SELECT token, data FROM invites").fetchall():
            raw = json.loads(row["data"])
            try:
                role = Role(str(raw.get("role") or "editor"))
            except ValueError:
                role = Role.editor
            migrated_invites.append(
                Invite(
                    token_hash=hash_secret(str(row["token"])),
                    role=role,
                    label=str(raw.get("label") or ""),
                    created_by=raw.get("created_by"),
                    created_at=str(raw.get("created_at") or now_iso()),
                    expires_at=str(raw.get("expires_at") or ""),
                    used_by=raw.get("used_by"),
                    used_at=raw.get("used_at"),
                    revoked=bool(raw.get("revoked", False)),
                )
            )

    conn.close()

    # Write into target repo
    all_shares = list(extra_shares)
    for _, _, _, sh in migrated_gigs:
        all_shares.extend(sh)
    source_stats["share_links"] = len({s.key for s in all_shares})
    source_stats["people"] = len(people_by_id)
    source_stats["projects"] = len(migrated_projects)
    source_stats["files"] += len(people_files)

    files_copied_local = 0
    files_copied_drive = 0
    if not dry_run:
        src_vdir = Path(source_vault_dir).resolve() if source_vault_dir else None
        dst_vdir = Path(target_vault_dir).resolve() if target_vault_dir else None
        if dst_vdir:
            dst_vdir.mkdir(parents=True, exist_ok=True)
        if migrated_projects:
            existing_proj = repo.get_setting("projects", [])
            by_pid: dict[str, dict[str, Any]] = {
                str(p["id"]): dict(p) for p in existing_proj if isinstance(p, dict) and p.get("id")
            }
            for proj in migrated_projects:
                by_pid[proj.id] = proj.model_dump(mode="json")
            repo.set_setting("projects", list(by_pid.values()))
        for p in people_by_id.values():
            repo.upsert_person(p)
        for u in migrated_users:
            repo.upsert_user(u)
        for inv in migrated_invites:
            repo.upsert_invite(inv)
        for gig, items, files, _ in migrated_gigs:
            if repo.get_gig(gig.id, include_deleted=True) is None:
                repo.create_gig(gig, actor=actor)
            if items:
                repo.add_items(gig.id, items, batch_id=f"mig_{gig.id}", actor=actor)
            for f in files:
                if dst_vdir and not (dst_vdir / f.object_id).is_file():
                    vm = vault_meta.get(f.object_id, {})
                    loc = str(vm.get("location") or "").strip()
                    candidates = [p for p in (Path(loc) if loc else None, (src_vdir / f.object_id) if src_vdir else None) if p is not None]
                    copied = False
                    for cand in candidates:
                        if cand.is_file():
                            (dst_vdir / f.object_id).write_bytes(cand.read_bytes())
                            files_copied_local += 1
                            copied = True
                            break
                    if not copied and copy_drive_files and f.drive_file_id:
                        from app.api.files import _fetch_drive_bytes

                        fetched = _fetch_drive_bytes(f.drive_file_id, f.mime)
                        if fetched is not None:
                            (dst_vdir / f.object_id).write_bytes(fetched[0])
                            if not f.size:
                                f.size = len(fetched[0])
                            files_copied_drive += 1
                repo.upsert_file(f)
        for pf in people_files:
            vm = vault_meta.get(pf.object_id, {})
            if not pf.gcs_key:
                pf.gcs_key = str(vm.get("key") or vm.get("gcs_key") or "").strip() or None
            if not pf.drive_file_id:
                pf.drive_file_id = mirror_drive_ids.get(pf.id)
            repo.upsert_file(pf)
        for s in all_shares:
            repo.upsert_share_link(s)

    # Parity verification against live target repo
    target_gigs = repo.list_gigs()
    target_trash = repo.list_trash()
    target_items: dict[str, int] = {}
    target_fee_sum = 0.0
    for g in target_gigs:
        if g.fee is not None:
            target_fee_sum += float(g.fee)
        for it in repo.list_items(g.id):
            target_items[it.collection] = target_items.get(it.collection, 0) + 1
    for g in target_trash:
        for it in repo.list_items(g.id):
            target_items[it.collection] = target_items.get(it.collection, 0) + 1

    target_files = repo.list_files()
    target_stats = {
        "gigs": len(target_gigs),
        "trash": len(target_trash),
        "items_by_collection": target_items,
        "total_fee_sum": round(target_fee_sum, 2),
        "users": len(repo.list_users()),
        "people": len(repo.list_people(include_merged=True)),
        "share_links": len(repo.list_share_links()),
        "files": len(target_files),
        "files_with_gcs": sum(1 for f in target_files if f.gcs_key),
        "files_with_drive": sum(1 for f in target_files if f.drive_file_id),
        "files_copied_local": files_copied_local,
        "files_copied_drive": files_copied_drive,
    }
    source_stats["total_fee_sum"] = round(source_stats["total_fee_sum"], 2)

    parity_ok = (
        dry_run
        or (
            source_stats["gigs"] == target_stats["gigs"]
            and source_stats["trash"] == target_stats["trash"]
            and source_stats["total_fee_sum"] == target_stats["total_fee_sum"]
            and source_stats["users"] <= target_stats["users"]
            and source_stats["share_links"] == target_stats["share_links"]
            and source_stats["files"] == target_stats["files"]
        )
    )

    return {
        "ok": parity_ok,
        "dry_run": dry_run,
        "source": source_stats,
        "target": target_stats,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate v1 Tour Designer SQLite DB to v2 TourRepo")
    parser.add_argument("sqlite_path", help="Path to v1 tour-designer.sqlite3 snapshot")
    parser.add_argument("--backend", choices=("sqlite", "firestore"), default="sqlite")
    parser.add_argument("--target-db", default="data/tour-designer-v2.sqlite3")
    parser.add_argument("--firestore-project", default="")
    parser.add_argument("--firestore-prefix", default="")
    parser.add_argument("--source-vault-dir", default="", help="Optional path to v1 local vault directory")
    parser.add_argument("--target-vault-dir", default="", help="Optional path to v2 local vault directory")
    parser.add_argument("--copy-drive-files", action="store_true", help="Download Drive-only files into target vault dir")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    settings = Settings(
        repo_backend=args.backend,
        local_db_path=args.target_db,
        firestore_project=args.firestore_project or None,
        firestore_prefix=args.firestore_prefix,
    )
    repo = build_repo(settings)
    report = migrate_v1_sqlite(
        args.sqlite_path,
        repo,
        dry_run=args.dry_run,
        source_vault_dir=args.source_vault_dir or None,
        target_vault_dir=args.target_vault_dir or None,
        copy_drive_files=args.copy_drive_files,
    )
    print(json.dumps(report, indent=2))
    if not report["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
