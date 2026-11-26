"""Normalized relational SQLite implementation of TourRepo for local and single-node deployments."""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from app.domain.auth import is_expired
from app.domain.models import (
    AuditEvent,
    FileRecord,
    Gig,
    GigItem,
    HistoryEvent,
    Invite,
    Person,
    Role,
    Session,
    ShareLink,
    User,
    new_id,
    now_iso,
)
from app.repo.protocol import ActorContext, ConflictError, NotFoundError

_SCHEMA = """
CREATE TABLE IF NOT EXISTS gigs (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL DEFAULT '',
    archived INTEGER NOT NULL DEFAULT 0,
    deleted_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    items_updated_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gigs_date ON gigs(date, id);
CREATE INDEX IF NOT EXISTS idx_gigs_updated ON gigs(updated_at);

CREATE TABLE IF NOT EXISTS gig_items (
    id TEXT PRIMARY KEY,
    gig_id TEXT NOT NULL,
    collection TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    batch_id TEXT,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_items_gig ON gig_items(gig_id, collection, deleted);
CREATE INDEX IF NOT EXISTS idx_items_batch ON gig_items(gig_id, batch_id);
CREATE INDEX IF NOT EXISTS idx_items_updated ON gig_items(updated_at);

CREATE TABLE IF NOT EXISTS gig_history (
    id TEXT PRIMARY KEY,
    gig_id TEXT NOT NULL,
    at TEXT NOT NULL,
    batch_id TEXT,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_history_gig ON gig_history(gig_id, at DESC);

CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    email TEXT,
    merged_into TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    gig_id TEXT,
    person_id TEXT,
    content_sha256 TEXT,
    added_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_gig ON files(gig_id);
CREATE INDEX IF NOT EXISTS idx_files_person ON files(person_id);

CREATE TABLE IF NOT EXISTS share_links (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    gig_id TEXT,
    person_id TEXT,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_gig ON share_links(gig_id);
CREATE INDEX IF NOT EXISTS idx_shares_person ON share_links(person_id);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    login_key_hash TEXT,
    mcp_key_hash TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_login_hash ON users(login_key_hash);
CREATE INDEX IF NOT EXISTS idx_users_mcp_hash ON users(mcp_key_hash);

CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS invites (
    token_hash TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    ts TEXT NOT NULL,
    action TEXT NOT NULL,
    data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
"""


def _item_fingerprint(collection: str, data: dict[str, Any], person_ids: list[str]) -> str:
    canonical = json.dumps(
        {"c": collection, "d": data, "p": sorted(person_ids)},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return canonical


class LocalSqliteRepo:
    def __init__(self, db_path: str = ":memory:") -> None:
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _record_history(self, event: HistoryEvent) -> None:
        self._conn.execute(
            "INSERT INTO gig_history (id, gig_id, at, batch_id, data) VALUES (?, ?, ?, ?, ?)",
            (event.id, event.gig_id, event.at, event.batch_id, event.model_dump_json()),
        )

    # ---- gigs ----
    def list_gigs(self, *, include_deleted: bool = False) -> list[Gig]:
        sql = "SELECT data FROM gigs"
        if not include_deleted:
            sql += " WHERE deleted_at IS NULL"
        sql += " ORDER BY date ASC, id ASC"
        with self._lock:
            rows = self._conn.execute(sql).fetchall()
        return [Gig.model_validate_json(r["data"]) for r in rows]

    def get_gig(self, gig_id: str, *, include_deleted: bool = False) -> Gig | None:
        sql = "SELECT data FROM gigs WHERE id = ?"
        if not include_deleted:
            sql += " AND deleted_at IS NULL"
        with self._lock:
            row = self._conn.execute(sql, (gig_id,)).fetchone()
        return Gig.model_validate_json(row["data"]) if row else None

    def create_gig(self, gig: Gig, *, actor: ActorContext | None = None) -> Gig:
        ts = now_iso()
        gig.updated_at = ts
        gig.items_updated_at = ts
        with self._lock:
            self._conn.execute(
                "INSERT INTO gigs (id, date, archived, deleted_at, version, updated_at, items_updated_at, data) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    gig.id,
                    gig.date,
                    1 if gig.archived else 0,
                    gig.deleted_at,
                    gig.version,
                    gig.updated_at,
                    gig.items_updated_at,
                    gig.model_dump_json(),
                ),
            )
            if actor:
                self._record_history(
                    HistoryEvent(
                        gig_id=gig.id,
                        actor_id=actor.actor_id,
                        actor_name=actor.actor_name,
                        channel=actor.channel,
                        action="create_gig",
                        summary=f"Created {gig.city or gig.venue or gig.date}",
                        after={"date": gig.date, "city": gig.city, "venue": gig.venue},
                    )
                )
            self._conn.commit()
        return gig

    def update_gig(
        self,
        gig_id: str,
        patch: dict[str, Any],
        *,
        expected_version: int | None = None,
        actor: ActorContext | None = None,
    ) -> Gig:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gigs WHERE id = ? AND deleted_at IS NULL", (gig_id,)
            ).fetchone()
            if not row:
                raise NotFoundError(f"gig {gig_id} not found")
            current = Gig.model_validate_json(row["data"])
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("gig_version_conflict", current=current.model_dump(mode="json"))

            before = {k: getattr(current, k) for k in patch if hasattr(current, k)}
            merged = current.model_dump()
            for key, value in patch.items():
                if key in {"id", "version", "updated_at", "items_updated_at", "deleted_at", "deleted_by"}:
                    continue
                if key in merged:
                    merged[key] = value
            updated = Gig.model_validate(merged)
            after = {k: getattr(updated, k) for k in before}
            if before == after:
                return current

            updated.version = current.version + 1
            updated.updated_at = now_iso()
            self._conn.execute(
                "UPDATE gigs SET date=?, archived=?, version=?, updated_at=?, data=? WHERE id=?",
                (
                    updated.date,
                    1 if updated.archived else 0,
                    updated.version,
                    updated.updated_at,
                    updated.model_dump_json(),
                    gig_id,
                ),
            )
            if actor:
                changed_keys = [k for k in before if before[k] != after[k]]
                self._record_history(
                    HistoryEvent(
                        gig_id=gig_id,
                        actor_id=actor.actor_id,
                        actor_name=actor.actor_name,
                        channel=actor.channel,
                        action="update_gig",
                        summary=f"Updated {', '.join(changed_keys[:4])}",
                        before={k: before[k] for k in changed_keys},
                        after={k: after[k] for k in changed_keys},
                    )
                )
            self._conn.commit()
            return updated

    def soft_delete_gig(self, gig_id: str, *, actor: ActorContext | None = None) -> Gig:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gigs WHERE id = ? AND deleted_at IS NULL", (gig_id,)
            ).fetchone()
            if not row:
                raise NotFoundError(f"gig {gig_id} not found")
            gig = Gig.model_validate_json(row["data"])
            ts = now_iso()
            gig.deleted_at = ts
            gig.deleted_by = actor.actor_id if actor else None
            gig.version += 1
            gig.updated_at = ts
            self._conn.execute(
                "UPDATE gigs SET deleted_at=?, version=?, updated_at=?, data=? WHERE id=?",
                (ts, gig.version, ts, gig.model_dump_json(), gig_id),
            )
            self._conn.commit()
            return gig

    def restore_gig(self, gig_id: str, *, actor: ActorContext | None = None) -> Gig:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gigs WHERE id = ? AND deleted_at IS NOT NULL", (gig_id,)
            ).fetchone()
            if not row:
                raise NotFoundError(f"trashed gig {gig_id} not found")
            gig = Gig.model_validate_json(row["data"])
            ts = now_iso()
            gig.deleted_at = None
            gig.deleted_by = None
            gig.version += 1
            gig.updated_at = ts
            self._conn.execute(
                "UPDATE gigs SET deleted_at=NULL, version=?, updated_at=?, data=? WHERE id=?",
                (gig.version, ts, gig.model_dump_json(), gig_id),
            )
            self._conn.commit()
            return gig

    def destroy_gig(self, gig_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM gigs WHERE id = ?", (gig_id,))
            self._conn.execute("DELETE FROM gig_items WHERE gig_id = ?", (gig_id,))
            self._conn.execute("DELETE FROM gig_history WHERE gig_id = ?", (gig_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def list_trash(self) -> list[Gig]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT data FROM gigs WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
            ).fetchall()
        return [Gig.model_validate_json(r["data"]) for r in rows]

    # ---- gig items ----
    def list_items(
        self,
        gig_id: str,
        *,
        collection: str | None = None,
        include_deleted: bool = False,
    ) -> list[GigItem]:
        sql = "SELECT data FROM gig_items WHERE gig_id = ?"
        params: list[Any] = [gig_id]
        if collection:
            sql += " AND collection = ?"
            params.append(collection)
        if not include_deleted:
            sql += " AND deleted = 0"
        sql += " ORDER BY updated_at ASC, id ASC"
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [GigItem.model_validate_json(r["data"]) for r in rows]

    def get_item(self, gig_id: str, item_id: str) -> GigItem | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gig_items WHERE gig_id = ? AND id = ?", (gig_id, item_id)
            ).fetchone()
        return GigItem.model_validate_json(row["data"]) if row else None

    def _bump_gig_items_ts(self, gig_id: str, ts: str) -> None:
        row = self._conn.execute("SELECT data FROM gigs WHERE id = ?", (gig_id,)).fetchone()
        if not row:
            raise NotFoundError(f"gig {gig_id} not found")
        gig = Gig.model_validate_json(row["data"])
        gig.items_updated_at = ts
        gig.updated_at = ts
        self._conn.execute(
            "UPDATE gigs SET items_updated_at=?, updated_at=?, data=? WHERE id=?",
            (ts, ts, gig.model_dump_json(), gig_id),
        )

    def add_items(
        self,
        gig_id: str,
        items: list[GigItem],
        *,
        batch_id: str | None = None,
        actor: ActorContext | None = None,
    ) -> list[GigItem]:
        if not items:
            return []
        ts = now_iso()
        bid = batch_id or new_id("bat")
        created: list[GigItem] = []
        with self._lock:
            existing_rows = self._conn.execute(
                "SELECT data FROM gig_items WHERE gig_id = ? AND deleted = 0", (gig_id,)
            ).fetchall()
            existing_fps = {
                _item_fingerprint(it.collection, it.data, it.person_ids)
                for it in (GigItem.model_validate_json(r["data"]) for r in existing_rows)
            }
            for item in items:
                item.gig_id = gig_id
                fp = _item_fingerprint(item.collection, item.data, item.person_ids)
                if fp in existing_fps:
                    continue
                existing_fps.add(fp)
                item.updated_at = ts
                item.batch_id = bid
                if actor:
                    item.added_by = actor.actor_id
                    item.added_by_name = actor.actor_name
                    item.added_channel = actor.channel  # type: ignore[assignment]
                self._conn.execute(
                    "INSERT INTO gig_items (id, gig_id, collection, deleted, version, updated_at, batch_id, data) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        item.id,
                        gig_id,
                        item.collection,
                        1 if item.deleted else 0,
                        item.version,
                        ts,
                        bid,
                        item.model_dump_json(),
                    ),
                )
                created.append(item)
            if created:
                self._bump_gig_items_ts(gig_id, ts)
                cols = sorted({it.collection for it in created})
                self._record_history(
                    HistoryEvent(
                        gig_id=gig_id,
                        at=ts,
                        actor_id=actor.actor_id if actor else None,
                        actor_name=actor.actor_name if actor else None,
                        channel=actor.channel if actor else "web",
                        action="add_items",
                        summary=f"Added {len(created)} {', '.join(cols)}",
                        batch_id=bid,
                        item_ids=[it.id for it in created],
                    )
                )
                self._conn.commit()
        return created

    def update_item(
        self,
        gig_id: str,
        item_id: str,
        patch: dict[str, Any],
        *,
        person_ids: list[str] | None = None,
        expected_version: int | None = None,
        actor: ActorContext | None = None,
    ) -> GigItem:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gig_items WHERE gig_id = ? AND id = ? AND deleted = 0",
                (gig_id, item_id),
            ).fetchone()
            if not row:
                raise NotFoundError(f"item {item_id} not found in gig {gig_id}")
            current = GigItem.model_validate_json(row["data"])
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("item_version_conflict", current=current.model_dump(mode="json"))

            new_data = dict(current.data)
            before_diff: dict[str, Any] = {}
            after_diff: dict[str, Any] = {}
            for k, v in patch.items():
                if new_data.get(k) != v:
                    before_diff[k] = new_data.get(k)
                    after_diff[k] = v
                    new_data[k] = v
            new_pids = list(person_ids) if person_ids is not None else list(current.person_ids)
            if not before_diff and new_pids == current.person_ids:
                return current

            ts = now_iso()
            current.data = new_data
            current.person_ids = new_pids
            current.version += 1
            current.updated_at = ts
            self._conn.execute(
                "UPDATE gig_items SET version=?, updated_at=?, data=? WHERE gig_id=? AND id=?",
                (current.version, ts, current.model_dump_json(), gig_id, item_id),
            )
            self._bump_gig_items_ts(gig_id, ts)
            self._record_history(
                HistoryEvent(
                    gig_id=gig_id,
                    at=ts,
                    actor_id=actor.actor_id if actor else None,
                    actor_name=actor.actor_name if actor else None,
                    channel=actor.channel if actor else "web",
                    action="update_item",
                    summary=f"Edited {current.collection}",
                    item_ids=[item_id],
                    before=before_diff,
                    after=after_diff,
                )
            )
            self._conn.commit()
            return current

    def remove_item(
        self,
        gig_id: str,
        item_id: str,
        *,
        expected_version: int | None = None,
        actor: ActorContext | None = None,
    ) -> GigItem:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM gig_items WHERE gig_id = ? AND id = ? AND deleted = 0",
                (gig_id, item_id),
            ).fetchone()
            if not row:
                raise NotFoundError(f"item {item_id} not found in gig {gig_id}")
            current = GigItem.model_validate_json(row["data"])
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("item_version_conflict", current=current.model_dump(mode="json"))

            ts = now_iso()
            current.deleted = True
            current.version += 1
            current.updated_at = ts
            self._conn.execute(
                "UPDATE gig_items SET deleted=1, version=?, updated_at=?, data=? WHERE gig_id=? AND id=?",
                (current.version, ts, current.model_dump_json(), gig_id, item_id),
            )
            self._bump_gig_items_ts(gig_id, ts)
            self._record_history(
                HistoryEvent(
                    gig_id=gig_id,
                    at=ts,
                    actor_id=actor.actor_id if actor else None,
                    actor_name=actor.actor_name if actor else None,
                    channel=actor.channel if actor else "web",
                    action="remove_item",
                    summary=f"Removed {current.collection}",
                    item_ids=[item_id],
                    before=current.data,
                )
            )
            self._conn.commit()
            return current

    def undo_batch(
        self,
        gig_id: str,
        batch_id: str,
        *,
        actor: ActorContext | None = None,
    ) -> dict[str, Any]:
        """Remove untouched rows from a batch (version == 1); keep rows edited since."""
        removed: list[str] = []
        kept: list[str] = []
        ts = now_iso()
        with self._lock:
            rows = self._conn.execute(
                "SELECT data FROM gig_items WHERE gig_id = ? AND batch_id = ? AND deleted = 0",
                (gig_id, batch_id),
            ).fetchall()
            for r in rows:
                item = GigItem.model_validate_json(r["data"])
                if item.version == 1:
                    item.deleted = True
                    item.version += 1
                    item.updated_at = ts
                    self._conn.execute(
                        "UPDATE gig_items SET deleted=1, version=?, updated_at=?, data=? WHERE id=?",
                        (item.version, ts, item.model_dump_json(), item.id),
                    )
                    removed.append(item.id)
                else:
                    kept.append(item.id)
            if removed:
                self._bump_gig_items_ts(gig_id, ts)
                self._record_history(
                    HistoryEvent(
                        gig_id=gig_id,
                        at=ts,
                        actor_id=actor.actor_id if actor else None,
                        actor_name=actor.actor_name if actor else None,
                        channel=actor.channel if actor else "web",
                        action="undo_batch",
                        summary=f"Undid batch ({len(removed)} removed, {len(kept)} kept)",
                        batch_id=batch_id,
                        item_ids=removed,
                    )
                )
                self._conn.commit()
        return {"removed": removed, "kept": kept}

    def list_history(self, gig_id: str, *, limit: int = 50) -> list[HistoryEvent]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT data FROM gig_history WHERE gig_id = ? ORDER BY at DESC LIMIT ?",
                (gig_id, limit),
            ).fetchall()
        return [HistoryEvent.model_validate_json(r["data"]) for r in rows]

    def get_changes_since(self, since_iso: str | None) -> dict[str, Any]:
        with self._lock:
            if not since_iso:
                gigs = self.list_gigs()
                people = self.list_people()
                return {
                    "cursor": now_iso(),
                    "full": True,
                    "changed_gig_ids": [g.id for g in gigs],
                    "changed_people_ids": [p.id for p in people],
                }
            g_rows = self._conn.execute(
                "SELECT id FROM gigs WHERE updated_at > ? OR items_updated_at > ?",
                (since_iso, since_iso),
            ).fetchall()
            p_rows = self._conn.execute(
                "SELECT id FROM people WHERE updated_at > ?", (since_iso,)
            ).fetchall()
            return {
                "cursor": now_iso(),
                "full": False,
                "changed_gig_ids": [r["id"] for r in g_rows],
                "changed_people_ids": [r["id"] for r in p_rows],
            }

    # ---- people ----
    def list_people(self, *, include_merged: bool = False) -> list[Person]:
        sql = "SELECT data FROM people"
        if not include_merged:
            sql += " WHERE merged_into IS NULL"
        sql += " ORDER BY id ASC"
        with self._lock:
            rows = self._conn.execute(sql).fetchall()
        return [Person.model_validate_json(r["data"]) for r in rows]

    def get_person(self, person_id: str) -> Person | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM people WHERE id = ?", (person_id,)).fetchone()
        return Person.model_validate_json(row["data"]) if row else None

    def upsert_person(self, person: Person, *, expected_version: int | None = None) -> Person:
        with self._lock:
            row = self._conn.execute("SELECT data FROM people WHERE id = ?", (person.id,)).fetchone()
            if row:
                current = Person.model_validate_json(row["data"])
                if expected_version is not None and current.version != expected_version:
                    raise ConflictError("person_version_conflict", current=current.model_dump(mode="json"))
                person.version = current.version + 1
            person.updated_at = now_iso()
            email_norm = (person.email or "").strip().lower() or None
            self._conn.execute(
                "INSERT INTO people (id, email, merged_into, version, updated_at, data) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET email=excluded.email, merged_into=excluded.merged_into, "
                "version=excluded.version, updated_at=excluded.updated_at, data=excluded.data",
                (person.id, email_norm, person.merged_into, person.version, person.updated_at, person.model_dump_json()),
            )
            self._conn.commit()
            return person

    def merge_people(self, source_id: str, target_id: str, *, actor: ActorContext | None = None) -> Person:
        if source_id == target_id:
            raise ValueError("cannot merge person into themselves")
        with self._lock:
            src = self.get_person(source_id)
            dst = self.get_person(target_id)
            if not src or not dst:
                raise NotFoundError("person not found")
            ts = now_iso()
            # Fill blanks on target from source
            for field in ("phone", "email", "company", "role", "person_kind"):
                if not getattr(dst, field) and getattr(src, field):
                    setattr(dst, field, getattr(src, field))
            if src.notes and src.notes not in (dst.notes or ""):
                dst.notes = f"{dst.notes}\n{src.notes}".strip() if dst.notes else src.notes
            dst.version += 1
            dst.updated_at = ts
            src.merged_into = target_id
            src.version += 1
            src.updated_at = ts
            self._conn.execute(
                "UPDATE people SET merged_into=?, version=?, updated_at=?, data=? WHERE id=?",
                (target_id, src.version, ts, src.model_dump_json(), source_id),
            )
            self._conn.execute(
                "UPDATE people SET email=?, version=?, updated_at=?, data=? WHERE id=?",
                ((dst.email or "").strip().lower() or None, dst.version, ts, dst.model_dump_json(), target_id),
            )
            # Rewrite person_ids references across gig_items atomically
            rows = self._conn.execute("SELECT id, gig_id, data FROM gig_items WHERE deleted = 0").fetchall()
            touched_gigs: set[str] = set()
            for r in rows:
                item = GigItem.model_validate_json(r["data"])
                if source_id in item.person_ids:
                    item.person_ids = list(dict.fromkeys(target_id if p == source_id else p for p in item.person_ids))
                    item.version += 1
                    item.updated_at = ts
                    self._conn.execute(
                        "UPDATE gig_items SET version=?, updated_at=?, data=? WHERE id=?",
                        (item.version, ts, item.model_dump_json(), item.id),
                    )
                    touched_gigs.add(item.gig_id)
            for gid in touched_gigs:
                self._bump_gig_items_ts(gid, ts)
            self._conn.commit()
            return dst

    # ---- files ----
    def list_files(self, *, gig_id: str | None = None, person_id: str | None = None) -> list[FileRecord]:
        sql = "SELECT data FROM files WHERE 1=1"
        params: list[Any] = []
        if gig_id:
            sql += " AND gig_id = ?"
            params.append(gig_id)
        if person_id:
            sql += " AND person_id = ?"
            params.append(person_id)
        sql += " ORDER BY added_at DESC"
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [FileRecord.model_validate_json(r["data"]) for r in rows]

    def get_file(self, file_id: str) -> FileRecord | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM files WHERE id = ?", (file_id,)).fetchone()
        return FileRecord.model_validate_json(row["data"]) if row else None

    def upsert_file(self, record: FileRecord) -> FileRecord:
        with self._lock:
            self._conn.execute(
                "INSERT INTO files (id, gig_id, person_id, content_sha256, added_at, data) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET gig_id=excluded.gig_id, person_id=excluded.person_id, data=excluded.data",
                (record.id, record.gig_id, record.person_id, record.content_sha256, record.added_at, record.model_dump_json()),
            )
            self._conn.commit()
        return record

    def delete_file(self, file_id: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM files WHERE id = ?", (file_id,))
            self._conn.commit()
            return cur.rowcount > 0

    # ---- share links ----
    def list_share_links(self, *, gig_id: str | None = None, person_id: str | None = None) -> list[ShareLink]:
        sql = "SELECT data FROM share_links WHERE 1=1"
        params: list[Any] = []
        if gig_id:
            sql += " AND gig_id = ?"
            params.append(gig_id)
        if person_id:
            sql += " AND person_id = ?"
            params.append(person_id)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [ShareLink.model_validate_json(r["data"]) for r in rows]

    def get_share_link(self, key: str) -> ShareLink | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM share_links WHERE key = ?", (key,)).fetchone()
        return ShareLink.model_validate_json(row["data"]) if row else None

    def upsert_share_link(self, link: ShareLink) -> ShareLink:
        link.updated_at = now_iso()
        with self._lock:
            self._conn.execute(
                "INSERT INTO share_links (key, scope, gig_id, person_id, data) VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT(key) DO UPDATE SET scope=excluded.scope, gig_id=excluded.gig_id, "
                "person_id=excluded.person_id, data=excluded.data",
                (link.key, link.scope, link.gig_id, link.person_id, link.model_dump_json()),
            )
            self._conn.commit()
        return link

    def delete_share_link(self, key: str) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM share_links WHERE key = ?", (key,))
            self._conn.commit()
            return cur.rowcount > 0

    # ---- users / sessions / invites ----
    def ensure_owner(self, name: str, email: str | None = None) -> User:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM users WHERE role = 'owner' AND revoked = 0 LIMIT 1"
            ).fetchone()
            if row:
                return User.model_validate_json(row["data"])
            owner = User(name=name, email=email, role=Role.owner)
            return self.upsert_user(owner)

    def list_users(self) -> list[User]:
        with self._lock:
            rows = self._conn.execute("SELECT data FROM users ORDER BY id ASC").fetchall()
        return [User.model_validate_json(r["data"]) for r in rows]

    def get_user(self, user_id: str) -> User | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM users WHERE id = ?", (user_id,)).fetchone()
        return User.model_validate_json(row["data"]) if row else None

    def find_user_by_login_key_hash(self, key_hash: str) -> User | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM users WHERE login_key_hash = ? AND revoked = 0", (key_hash,)
            ).fetchone()
        return User.model_validate_json(row["data"]) if row else None

    def find_user_by_mcp_key_hash(self, key_hash: str) -> User | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT data FROM users WHERE mcp_key_hash = ? AND revoked = 0", (key_hash,)
            ).fetchone()
        return User.model_validate_json(row["data"]) if row else None

    def upsert_user(self, user: User) -> User:
        role_val = user.role.value if isinstance(user.role, Role) else str(user.role)
        with self._lock:
            self._conn.execute(
                "INSERT INTO users (id, role, login_key_hash, mcp_key_hash, revoked, data) VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT(id) DO UPDATE SET role=excluded.role, login_key_hash=excluded.login_key_hash, "
                "mcp_key_hash=excluded.mcp_key_hash, revoked=excluded.revoked, data=excluded.data",
                (user.id, role_val, user.login_key_hash, user.mcp_key_hash, 1 if user.revoked else 0, user.model_dump_json()),
            )
            self._conn.commit()
        return user

    def touch_user(self, user_id: str, ts: str) -> None:
        with self._lock:
            user = self.get_user(user_id)
            if not user:
                return
            user.last_seen_at = ts
            self.upsert_user(user)

    def create_session(self, session: Session) -> Session:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO sessions (token_hash, user_id, expires_at, data) VALUES (?, ?, ?, ?)",
                (session.token_hash, session.user_id, session.expires_at, session.model_dump_json()),
            )
            self._conn.commit()
        return session

    def get_session(self, token_hash: str) -> tuple[Session, User] | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone()
            if not row:
                return None
            sess = Session.model_validate_json(row["data"])
            if is_expired(sess.expires_at):
                return None
            user = self.get_user(sess.user_id)
            if not user or user.revoked:
                return None
            return sess, user

    def touch_session(self, token_hash: str, expires_at: str, ts: str) -> None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM sessions WHERE token_hash = ?", (token_hash,)).fetchone()
            if not row:
                return
            sess = Session.model_validate_json(row["data"])
            sess.expires_at = expires_at
            sess.last_seen_at = ts
            self._conn.execute(
                "UPDATE sessions SET expires_at=?, data=? WHERE token_hash=?",
                (expires_at, sess.model_dump_json(), token_hash),
            )
            self._conn.commit()

    def delete_session(self, token_hash: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            self._conn.commit()

    def delete_user_sessions(self, user_id: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))
            self._conn.commit()

    def create_invite(self, invite: Invite) -> Invite:
        return self.upsert_invite(invite)

    def list_invites(self) -> list[Invite]:
        with self._lock:
            rows = self._conn.execute("SELECT data FROM invites").fetchall()
        return [Invite.model_validate_json(r["data"]) for r in rows]

    def get_invite(self, token_hash: str) -> Invite | None:
        with self._lock:
            row = self._conn.execute("SELECT data FROM invites WHERE token_hash = ?", (token_hash,)).fetchone()
        return Invite.model_validate_json(row["data"]) if row else None

    def upsert_invite(self, invite: Invite) -> Invite:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO invites (token_hash, data) VALUES (?, ?)",
                (invite.token_hash, invite.model_dump_json()),
            )
            self._conn.commit()
        return invite

    # ---- settings & audit ----
    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
                (key, json.dumps(value, ensure_ascii=False), now_iso()),
            )
            self._conn.commit()

    def list_settings_prefix(self, prefix: str) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT key, value FROM settings WHERE key LIKE ?",
                (f"{prefix}%",),
            ).fetchall()
        out: dict[str, Any] = {}
        for r in rows:
            try:
                out[str(r["key"])] = json.loads(r["value"])
            except Exception:
                continue
        return out

    def append_audit(self, event: AuditEvent) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO audit_log (id, ts, action, data) VALUES (?, ?, ?, ?)",
                (event.id, event.ts, event.action, event.model_dump_json()),
            )
            self._conn.commit()

    def list_audit(self, *, limit: int = 50, writes_only: bool = False) -> list[AuditEvent]:
        sql = "SELECT data FROM audit_log"
        if writes_only:
            sql += " WHERE action NOT IN ('login', 'work_open', 'read')"
        sql += " ORDER BY ts DESC LIMIT ?"
        with self._lock:
            rows = self._conn.execute(sql, (limit,)).fetchall()
        return [AuditEvent.model_validate_json(r["data"]) for r in rows]
