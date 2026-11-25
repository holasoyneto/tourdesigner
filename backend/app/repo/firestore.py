"""Google Cloud Firestore (Native Mode) implementation of TourRepo with ACID row-level CAS."""

from __future__ import annotations

import json
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


def _item_fingerprint(collection: str, data: dict[str, Any], person_ids: list[str]) -> str:
    return json.dumps(
        {"c": collection, "d": data, "p": sorted(person_ids)},
        sort_keys=True,
        ensure_ascii=False,
        separators=(",", ":"),
    )


class FirestoreRepo:
    def __init__(
        self,
        *,
        project: str | None = None,
        database: str = "(default)",
        prefix: str = "",
        client: Any | None = None,
    ) -> None:
        if client is not None:
            self._db = client
        else:
            import os

            from google.cloud import firestore  # lazy import so local dev needs no gcp extra

            tok = os.environ.get("GOOGLE_OAUTH_ACCESS_TOKEN", "").strip()
            if tok:
                from google.oauth2.credentials import Credentials

                self._db = firestore.Client(
                    project=project or None,
                    database=database,
                    credentials=Credentials(token=tok),
                )
            else:
                self._db = firestore.Client(project=project or None, database=database)
        self._prefix = prefix.strip()

    def _col(self, name: str):
        return self._db.collection(f"{self._prefix}{name}")

    def _gig_ref(self, gig_id: str):
        return self._col("gigs").document(gig_id)

    def _items_col(self, gig_id: str):
        return self._gig_ref(gig_id).collection("items")

    def _history_col(self, gig_id: str):
        return self._gig_ref(gig_id).collection("history")

    # ---- gigs ----
    def list_gigs(self, *, include_deleted: bool = False) -> list[Gig]:
        gigs = [Gig.model_validate(doc.to_dict()) for doc in self._col("gigs").stream()]
        if not include_deleted:
            gigs = [g for g in gigs if not g.deleted_at]
        gigs.sort(key=lambda g: (g.date or "9999-99-99", g.id))
        return gigs

    def get_gig(self, gig_id: str, *, include_deleted: bool = False) -> Gig | None:
        snap = self._gig_ref(gig_id).get()
        if not snap.exists:
            return None
        gig = Gig.model_validate(snap.to_dict())
        if not include_deleted and gig.deleted_at:
            return None
        return gig

    def create_gig(self, gig: Gig, *, actor: ActorContext | None = None) -> Gig:
        ts = now_iso()
        gig.updated_at = ts
        gig.items_updated_at = ts
        batch = self._db.batch()
        batch.set(self._gig_ref(gig.id), gig.model_dump(mode="json"))
        if actor:
            ev = HistoryEvent(
                gig_id=gig.id,
                at=ts,
                actor_id=actor.actor_id,
                actor_name=actor.actor_name,
                channel=actor.channel,
                action="create_gig",
                summary=f"Created {gig.city or gig.venue or gig.date}",
                after={"date": gig.date, "city": gig.city, "venue": gig.venue},
            )
            batch.set(self._history_col(gig.id).document(ev.id), ev.model_dump(mode="json"))
        batch.commit()
        return gig

    def update_gig(
        self,
        gig_id: str,
        patch: dict[str, Any],
        *,
        expected_version: int | None = None,
        actor: ActorContext | None = None,
    ) -> Gig:
        from google.cloud import firestore

        ref = self._gig_ref(gig_id)
        tx = self._db.transaction()

        @firestore.transactional
        def _run(transaction) -> Gig:
            snap = ref.get(transaction=transaction)
            if not snap.exists:
                raise NotFoundError(f"gig {gig_id} not found")
            current = Gig.model_validate(snap.to_dict())
            if current.deleted_at:
                raise NotFoundError(f"gig {gig_id} not found")
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("gig_version_conflict", current=current.model_dump(mode="json"))

            before = {k: getattr(current, k) for k in patch if hasattr(current, k)}
            merged = current.model_dump()
            for k, v in patch.items():
                if k in {"id", "version", "updated_at", "items_updated_at", "deleted_at", "deleted_by"}:
                    continue
                if k in merged:
                    merged[k] = v
            updated = Gig.model_validate(merged)
            after = {k: getattr(updated, k) for k in before}
            if before == after:
                return current

            updated.version = current.version + 1
            updated.updated_at = now_iso()
            transaction.set(ref, updated.model_dump(mode="json"))
            if actor:
                changed = [k for k in before if before[k] != after[k]]
                ev = HistoryEvent(
                    gig_id=gig_id,
                    at=updated.updated_at,
                    actor_id=actor.actor_id,
                    actor_name=actor.actor_name,
                    channel=actor.channel,
                    action="update_gig",
                    summary=f"Updated {', '.join(changed[:4])}",
                    before={k: before[k] for k in changed},
                    after={k: after[k] for k in changed},
                )
                transaction.set(self._history_col(gig_id).document(ev.id), ev.model_dump(mode="json"))
            return updated

        return _run(tx)

    def soft_delete_gig(self, gig_id: str, *, actor: ActorContext | None = None) -> Gig:
        gig = self.get_gig(gig_id)
        if not gig:
            raise NotFoundError(f"gig {gig_id} not found")
        ts = now_iso()
        gig.deleted_at = ts
        gig.deleted_by = actor.actor_id if actor else None
        gig.version += 1
        gig.updated_at = ts
        self._gig_ref(gig_id).set(gig.model_dump(mode="json"))
        return gig

    def restore_gig(self, gig_id: str, *, actor: ActorContext | None = None) -> Gig:
        gig = self.get_gig(gig_id, include_deleted=True)
        if not gig or not gig.deleted_at:
            raise NotFoundError(f"trashed gig {gig_id} not found")
        ts = now_iso()
        gig.deleted_at = None
        gig.deleted_by = None
        gig.version += 1
        gig.updated_at = ts
        self._gig_ref(gig_id).set(gig.model_dump(mode="json"))
        return gig

    def destroy_gig(self, gig_id: str) -> bool:
        ref = self._gig_ref(gig_id)
        if not ref.get().exists:
            return False
        batch = self._db.batch()
        for sub in (self._items_col(gig_id), self._history_col(gig_id)):
            for doc in sub.stream():
                batch.delete(doc.reference)
        batch.delete(ref)
        batch.commit()
        return True

    def list_trash(self) -> list[Gig]:
        gigs = [g for g in self.list_gigs(include_deleted=True) if g.deleted_at]
        gigs.sort(key=lambda g: g.deleted_at or "", reverse=True)
        return gigs

    # ---- gig items ----
    def list_items(
        self,
        gig_id: str,
        *,
        collection: str | None = None,
        include_deleted: bool = False,
    ) -> list[GigItem]:
        items = [GigItem.model_validate(d.to_dict()) for d in self._items_col(gig_id).stream()]
        if collection:
            items = [it for it in items if it.collection == collection]
        if not include_deleted:
            items = [it for it in items if not it.deleted]
        items.sort(key=lambda it: (it.updated_at, it.id))
        return items

    def get_item(self, gig_id: str, item_id: str) -> GigItem | None:
        snap = self._items_col(gig_id).document(item_id).get()
        return GigItem.model_validate(snap.to_dict()) if snap.exists else None

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
        if not self.get_gig(gig_id, include_deleted=True):
            raise NotFoundError(f"gig {gig_id} not found")
        ts = now_iso()
        bid = batch_id or new_id("bat")
        existing = self.list_items(gig_id)
        existing_fps = {_item_fingerprint(it.collection, it.data, it.person_ids) for it in existing}
        created: list[GigItem] = []
        batch = self._db.batch()
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
            batch.set(self._items_col(gig_id).document(item.id), item.model_dump(mode="json"))
            created.append(item)
        if created:
            batch.update(self._gig_ref(gig_id), {"items_updated_at": ts, "updated_at": ts})
            ev = HistoryEvent(
                gig_id=gig_id,
                at=ts,
                actor_id=actor.actor_id if actor else None,
                actor_name=actor.actor_name if actor else None,
                channel=actor.channel if actor else "web",
                action="add_items",
                summary=f"Added {len(created)} {', '.join(sorted({it.collection for it in created}))}",
                batch_id=bid,
                item_ids=[it.id for it in created],
            )
            batch.set(self._history_col(gig_id).document(ev.id), ev.model_dump(mode="json"))
            batch.commit()
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
        from google.cloud import firestore

        item_ref = self._items_col(gig_id).document(item_id)
        gig_ref = self._gig_ref(gig_id)
        tx = self._db.transaction()

        @firestore.transactional
        def _run(transaction) -> GigItem:
            snap = item_ref.get(transaction=transaction)
            if not snap.exists:
                raise NotFoundError(f"item {item_id} not found")
            current = GigItem.model_validate(snap.to_dict())
            if current.deleted:
                raise NotFoundError(f"item {item_id} not found")
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("item_version_conflict", current=current.model_dump(mode="json"))

            new_data = dict(current.data)
            before_diff, after_diff = {}, {}
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
            transaction.set(item_ref, current.model_dump(mode="json"))
            transaction.update(gig_ref, {"items_updated_at": ts, "updated_at": ts})
            ev = HistoryEvent(
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
            transaction.set(self._history_col(gig_id).document(ev.id), ev.model_dump(mode="json"))
            return current

        return _run(tx)

    def remove_item(
        self,
        gig_id: str,
        item_id: str,
        *,
        expected_version: int | None = None,
        actor: ActorContext | None = None,
    ) -> GigItem:
        from google.cloud import firestore

        item_ref = self._items_col(gig_id).document(item_id)
        gig_ref = self._gig_ref(gig_id)
        tx = self._db.transaction()

        @firestore.transactional
        def _run(transaction) -> GigItem:
            snap = item_ref.get(transaction=transaction)
            if not snap.exists:
                raise NotFoundError(f"item {item_id} not found")
            current = GigItem.model_validate(snap.to_dict())
            if current.deleted:
                raise NotFoundError(f"item {item_id} not found")
            if expected_version is not None and current.version != expected_version:
                raise ConflictError("item_version_conflict", current=current.model_dump(mode="json"))
            ts = now_iso()
            current.deleted = True
            current.version += 1
            current.updated_at = ts
            transaction.set(item_ref, current.model_dump(mode="json"))
            transaction.update(gig_ref, {"items_updated_at": ts, "updated_at": ts})
            ev = HistoryEvent(
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
            transaction.set(self._history_col(gig_id).document(ev.id), ev.model_dump(mode="json"))
            return current

        return _run(tx)

    def undo_batch(self, gig_id: str, batch_id: str, *, actor: ActorContext | None = None) -> dict[str, Any]:
        removed, kept = [], []
        ts = now_iso()
        items = [it for it in self.list_items(gig_id) if it.batch_id == batch_id]
        batch = self._db.batch()
        for it in items:
            if it.version == 1:
                it.deleted = True
                it.version += 1
                it.updated_at = ts
                batch.set(self._items_col(gig_id).document(it.id), it.model_dump(mode="json"))
                removed.append(it.id)
            else:
                kept.append(it.id)
        if removed:
            batch.update(self._gig_ref(gig_id), {"items_updated_at": ts, "updated_at": ts})
            ev = HistoryEvent(
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
            batch.set(self._history_col(gig_id).document(ev.id), ev.model_dump(mode="json"))
            batch.commit()
        return {"removed": removed, "kept": kept}

    def list_history(self, gig_id: str, *, limit: int = 50) -> list[HistoryEvent]:
        events = [HistoryEvent.model_validate(d.to_dict()) for d in self._history_col(gig_id).stream()]
        events.sort(key=lambda e: e.at, reverse=True)
        return events[:limit]

    def get_changes_since(self, since_iso: str | None) -> dict[str, Any]:
        if not since_iso:
            return {
                "cursor": now_iso(),
                "full": True,
                "changed_gig_ids": [g.id for g in self.list_gigs()],
                "changed_people_ids": [p.id for p in self.list_people()],
            }
        g_docs = self._col("gigs").where("updated_at", ">", since_iso).stream()
        p_docs = self._col("people").where("updated_at", ">", since_iso).stream()
        return {
            "cursor": now_iso(),
            "full": False,
            "changed_gig_ids": [d.id for d in g_docs],
            "changed_people_ids": [d.id for d in p_docs],
        }

    # ---- people ----
    def list_people(self, *, include_merged: bool = False) -> list[Person]:
        people = [Person.model_validate(d.to_dict()) for d in self._col("people").stream()]
        if not include_merged:
            people = [p for p in people if not p.merged_into]
        people.sort(key=lambda p: (p.name.lower(), p.id))
        return people

    def get_person(self, person_id: str) -> Person | None:
        snap = self._col("people").document(person_id).get()
        return Person.model_validate(snap.to_dict()) if snap.exists else None

    def upsert_person(self, person: Person, *, expected_version: int | None = None) -> Person:
        existing = self.get_person(person.id)
        if existing:
            if expected_version is not None and existing.version != expected_version:
                raise ConflictError("person_version_conflict", current=existing.model_dump(mode="json"))
            person.version = existing.version + 1
        person.updated_at = now_iso()
        self._col("people").document(person.id).set(person.model_dump(mode="json"))
        return person

    def merge_people(self, source_id: str, target_id: str, *, actor: ActorContext | None = None) -> Person:
        if source_id == target_id:
            raise ValueError("cannot merge person into themselves")
        src, dst = self.get_person(source_id), self.get_person(target_id)
        if not src or not dst:
            raise NotFoundError("person not found")
        ts = now_iso()
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
        batch = self._db.batch()
        batch.set(self._col("people").document(source_id), src.model_dump(mode="json"))
        batch.set(self._col("people").document(target_id), dst.model_dump(mode="json"))
        for gig in self.list_gigs():
            touched = False
            for it in self.list_items(gig.id):
                if source_id in it.person_ids:
                    it.person_ids = list(dict.fromkeys(target_id if p == source_id else p for p in it.person_ids))
                    it.version += 1
                    it.updated_at = ts
                    batch.set(self._items_col(gig.id).document(it.id), it.model_dump(mode="json"))
                    touched = True
            if touched:
                batch.update(self._gig_ref(gig.id), {"items_updated_at": ts, "updated_at": ts})
        batch.commit()
        return dst

    # ---- files ----
    def list_files(self, *, gig_id: str | None = None, person_id: str | None = None) -> list[FileRecord]:
        files = [FileRecord.model_validate(d.to_dict()) for d in self._col("files").stream()]
        if gig_id:
            files = [f for f in files if f.gig_id == gig_id]
        if person_id:
            files = [f for f in files if f.person_id == person_id]
        files.sort(key=lambda f: f.added_at, reverse=True)
        return files

    def get_file(self, file_id: str) -> FileRecord | None:
        snap = self._col("files").document(file_id).get()
        return FileRecord.model_validate(snap.to_dict()) if snap.exists else None

    def upsert_file(self, record: FileRecord) -> FileRecord:
        self._col("files").document(record.id).set(record.model_dump(mode="json"))
        return record

    def delete_file(self, file_id: str) -> bool:
        ref = self._col("files").document(file_id)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    # ---- share links ----
    def list_share_links(self, *, gig_id: str | None = None, person_id: str | None = None) -> list[ShareLink]:
        links = [ShareLink.model_validate(d.to_dict()) for d in self._col("share_links").stream()]
        if gig_id:
            links = [lnk for lnk in links if lnk.gig_id == gig_id]
        if person_id:
            links = [lnk for lnk in links if lnk.person_id == person_id]
        return links

    def get_share_link(self, key: str) -> ShareLink | None:
        snap = self._col("share_links").document(key).get()
        return ShareLink.model_validate(snap.to_dict()) if snap.exists else None

    def upsert_share_link(self, link: ShareLink) -> ShareLink:
        link.updated_at = now_iso()
        self._col("share_links").document(link.key).set(link.model_dump(mode="json"))
        return link

    def delete_share_link(self, key: str) -> bool:
        ref = self._col("share_links").document(key)
        if not ref.get().exists:
            return False
        ref.delete()
        return True

    # ---- users / sessions / invites ----
    def ensure_owner(self, name: str, email: str | None = None) -> User:
        for u in self.list_users():
            if str(u.role) == "owner" and not u.revoked:
                return u
        return self.upsert_user(User(name=name, email=email, role=Role.owner))

    def list_users(self) -> list[User]:
        return [User.model_validate(d.to_dict()) for d in self._col("users").stream()]

    def get_user(self, user_id: str) -> User | None:
        snap = self._col("users").document(user_id).get()
        return User.model_validate(snap.to_dict()) if snap.exists else None

    def find_user_by_login_key_hash(self, key_hash: str) -> User | None:
        docs = self._col("users").where("login_key_hash", "==", key_hash).limit(1).stream()
        for d in docs:
            u = User.model_validate(d.to_dict())
            return None if u.revoked else u
        return None

    def find_user_by_mcp_key_hash(self, key_hash: str) -> User | None:
        docs = self._col("users").where("mcp_key_hash", "==", key_hash).limit(1).stream()
        for d in docs:
            u = User.model_validate(d.to_dict())
            return None if u.revoked else u
        return None

    def upsert_user(self, user: User) -> User:
        self._col("users").document(user.id).set(user.model_dump(mode="json"))
        return user

    def touch_user(self, user_id: str, ts: str) -> None:
        self._col("users").document(user_id).set({"last_seen_at": ts}, merge=True)

    def create_session(self, session: Session) -> Session:
        self._col("sessions").document(session.token_hash).set(session.model_dump(mode="json"))
        return session

    def get_session(self, token_hash: str) -> tuple[Session, User] | None:
        snap = self._col("sessions").document(token_hash).get()
        if not snap.exists:
            return None
        sess = Session.model_validate(snap.to_dict())
        if is_expired(sess.expires_at):
            return None
        user = self.get_user(sess.user_id)
        if not user or user.revoked:
            return None
        return sess, user

    def touch_session(self, token_hash: str, expires_at: str, ts: str) -> None:
        self._col("sessions").document(token_hash).set(
            {"expires_at": expires_at, "last_seen_at": ts}, merge=True
        )

    def delete_session(self, token_hash: str) -> None:
        self._col("sessions").document(token_hash).delete()

    def delete_user_sessions(self, user_id: str) -> None:
        batch = self._db.batch()
        for d in self._col("sessions").where("user_id", "==", user_id).stream():
            batch.delete(d.reference)
        batch.commit()

    def create_invite(self, invite: Invite) -> Invite:
        return self.upsert_invite(invite)

    def list_invites(self) -> list[Invite]:
        return [Invite.model_validate(d.to_dict()) for d in self._col("invites").stream()]

    def get_invite(self, token_hash: str) -> Invite | None:
        snap = self._col("invites").document(token_hash).get()
        return Invite.model_validate(snap.to_dict()) if snap.exists else None

    def upsert_invite(self, invite: Invite) -> Invite:
        self._col("invites").document(invite.token_hash).set(invite.model_dump(mode="json"))
        return invite

    # ---- settings & audit ----
    def get_setting(self, key: str, default: Any = None) -> Any:
        snap = self._col("settings").document(key).get()
        if not snap.exists:
            return default
        return (snap.to_dict() or {}).get("value", default)

    def set_setting(self, key: str, value: Any) -> None:
        self._col("settings").document(key).set({"value": value, "updated_at": now_iso()})

    def append_audit(self, event: AuditEvent) -> None:
        self._col("audit_log").document(event.id).set(event.model_dump(mode="json"))

    def list_audit(self, *, limit: int = 50, writes_only: bool = False) -> list[AuditEvent]:
        events = [AuditEvent.model_validate(d.to_dict()) for d in self._col("audit_log").stream()]
        if writes_only:
            events = [e for e in events if e.action not in {"login", "work_open", "read"}]
        events.sort(key=lambda e: e.ts, reverse=True)
        return events[:limit]
