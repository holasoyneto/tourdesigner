"""Verification and security regression suite for Tour Designer backend."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.domain.auth import hash_secret
from app.domain.models import Gig, GigItem, Role, ShareLink, User
from app.main import create_app
from app.repo.sqlite_local import LocalSqliteRepo
from scripts.migrate_v1_sqlite import migrate_v1_sqlite


def _make_client(tmp_path: Path, *, password: str = "") -> tuple[TestClient, LocalSqliteRepo]:
    repo = LocalSqliteRepo(str(tmp_path / "test.sqlite3"))
    static_dir = tmp_path / "static"
    (static_dir / "v3").mkdir(parents=True)
    (static_dir / "v3" / "index.html").write_text("<!doctype html><div id='root'></div>", encoding="utf-8")
    settings = Settings(
        env="local",
        repo_backend="sqlite",
        basic_auth_password=password,
        file_vault_local_path=str(tmp_path / "vault"),
        static_dir=str(static_dir),
    )
    app = create_app(settings=settings, repo=repo)
    return TestClient(app), repo


def test_gig_crud_and_row_cas_conflict(tmp_path: Path):
    client, _ = _make_client(tmp_path)
    with client:
        r = client.post("/api/gigs", json={"date": "2026-12-10", "city": "Paris", "venue": "Rex Club", "fee": 8000})
        assert r.status_code == 201
        gig_id = r.json()["gig"]["id"]

        r_add = client.post(
            f"/api/gigs/{gig_id}/items",
            json={"collection": "flights", "data": {"flight_no": "AF1181", "dep_iata": "LHR", "arr_iata": "CDG", "dep_time": "11:25"}},
        )
        assert r_add.status_code == 201
        item = r_add.json()["items"][0]
        assert item["version"] == 1

        # Idempotent duplicate add ignored
        r_dup = client.post(
            f"/api/gigs/{gig_id}/items",
            json={"collection": "flights", "data": {"flight_no": "AF1181", "dep_iata": "LHR", "arr_iata": "CDG", "dep_time": "11:25"}},
        )
        assert r_dup.json()["items"] == []

        # Valid CAS update succeeds -> version 2
        r_upd = client.patch(
            f"/api/gigs/{gig_id}/items/{item['id']}",
            json={"expected_version": 1, "data": {"gate": "K42"}},
        )
        assert r_upd.status_code == 200
        assert r_upd.json()["item"]["version"] == 2
        assert r_upd.json()["item"]["data"]["gate"] == "K42"

        # Stale CAS update rejected with 409 + current snapshot
        r_stale = client.patch(
            f"/api/gigs/{gig_id}/items/{item['id']}",
            json={"expected_version": 1, "data": {"gate": "B10"}},
        )
        assert r_stale.status_code == 409
        assert r_stale.json()["error"] == "conflict"
        assert r_stale.json()["current"]["data"]["gate"] == "K42"


def test_batch_undo_removes_untouched_keeps_edited(tmp_path: Path):
    client, _ = _make_client(tmp_path)
    with client:
        gid = client.post("/api/gigs", json={"date": "2026-12-12", "city": "Berlin"}).json()["gig"]["id"]
        r = client.post(
            f"/api/gigs/{gid}/items",
            json={
                "batch_id": "bat_test_1",
                "items": [
                    {"collection": "schedule", "data": {"time": "18:00", "label": "Soundcheck"}},
                    {"collection": "schedule", "data": {"time": "20:00", "label": "Dinner"}},
                ],
            },
        )
        it1, it2 = r.json()["items"]
        client.patch(f"/api/gigs/{gid}/items/{it2['id']}", json={"data": {"location": "Grill Royal"}})

        u = client.post(f"/api/gigs/{gid}/history/bat_test_1/undo")
        assert u.status_code == 200
        assert u.json()["removed"] == [it1["id"]]
        assert u.json()["kept"] == [it2["id"]]


def test_people_canonical_merge_rewrites_item_refs(tmp_path: Path):
    client, _ = _make_client(tmp_path)
    with client:
        p1 = client.post("/api/people", json={"name": "Marc", "phone": "+33 6 00 11 22 33"}).json()["person"]
        p2 = client.post("/api/people", json={"name": "Marc Laurent", "email": "marc@rex.example"}).json()["person"]
        gid = client.post("/api/gigs", json={"date": "2026-12-15", "city": "Paris"}).json()["gig"]["id"]
        item = client.post(
            f"/api/gigs/{gid}/items",
            json={"collection": "schedule", "person_ids": [p1["id"]], "data": {"time": "19:00", "label": "Meet promoter"}},
        ).json()["items"][0]

        merged = client.post("/api/people/merge", json={"source_id": p1["id"], "target_id": p2["id"]})
        assert merged.status_code == 200
        assert merged.json()["person"]["phone"] == "+33 6 00 11 22 33"
        assert merged.json()["person"]["email"] == "marc@rex.example"

        gig_after = client.get(f"/api/gigs/{gid}").json()["gig"]
        row = next(it for it in gig_after["items"] if it["id"] == item["id"])
        assert row["person_ids"] == [p2["id"]]


def test_role_scrubbing_and_csrf_origin_guard(tmp_path: Path):
    client, repo = _make_client(tmp_path, password="secret-owner-pw")
    with client:
        gig = repo.create_gig(Gig(date="2026-12-20", city="Lyon", fee=5000, deal_type="Net secret"))
        repo.add_items(gig.id, [GigItem(gig_id=gig.id, collection="perdiem", data={"amount": 150})])
        repo.upsert_user(User(id="usr_ed", name="Maya", role=Role.editor, login_key_hash=hash_secret("ed-key")))
        repo.upsert_user(User(id="usr_vw", name="Guest", role=Role.viewer, login_key_hash=hash_secret("vw-key")))

        assert client.get("/api/gigs").status_code == 401

        assert client.post("/api/auth/key-login", json={"key": "ed-key"}).status_code == 200
        g_ed = client.get(f"/api/gigs/{gig.id}").json()["gig"]
        assert g_ed["fee"] == 5000
        assert "deal_type" not in g_ed
        assert g_ed["items"] == []
        assert client.patch(f"/api/gigs/{gig.id}", json={"fee": 9999}).status_code == 403

        # Cross-origin cookie mutation blocked by CSRF Origin guard
        assert client.patch(
            f"/api/gigs/{gig.id}",
            json={"notes": "blocked"},
            headers={"Origin": "https://evil.example"},
        ).status_code == 403

        # Viewer sees neither fee nor perdiem and cannot mutate
        client.post("/api/auth/logout")
        assert client.post("/api/auth/key-login", json={"key": "vw-key"}).status_code == 200
        g_vw = client.get(f"/api/gigs/{gig.id}").json()["gig"]
        assert "fee" not in g_vw
        assert client.post("/api/gigs", json={"date": "2026-12-22"}).status_code == 403
        assert client.get("/api/people").status_code == 403


def test_public_share_fail_closed_scrubbing_and_traveler_isolation(tmp_path: Path):
    client, repo = _make_client(tmp_path, password="secret-owner-pw")
    with client:
        gig = repo.create_gig(Gig(date="2026-12-21", city="Amsterdam", fee=9000, deal_type="Confidential"))
        repo.add_items(
            gig.id,
            [
                GigItem(gig_id=gig.id, collection="perdiem", data={"amount": 200}),
                GigItem(gig_id=gig.id, collection="guests", data={"name": "VIP Guest"}),
                GigItem(
                    gig_id=gig.id,
                    collection="hotels",
                    person_ids=["per_a", "per_b"],
                    data={
                        "name": "Hotel Central",
                        "confirmation": "HC-123",
                        "wifi_password": "secret-wifi-password",
                        "room_assignments": {"per_a": "401", "per_b": "402"},
                    },
                ),
                GigItem(
                    gig_id=gig.id,
                    collection="flights",
                    person_ids=["per_a"],
                    data={"flight_no": "KL100", "ref": "PNRAAA", "seat_by_person": {"per_a": "2A", "per_b": "9F"}},
                ),
                GigItem(
                    gig_id=gig.id,
                    collection="flights",
                    person_ids=["per_b"],
                    data={"flight_no": "KL200", "ref": "PNRBBB"},
                ),
            ],
        )
        repo.upsert_share_link(
            ShareLink(key="traveler-a-card-01", scope="gig_crew", gig_id=gig.id, person_id="per_a", enabled=True)
        )

        res = client.get("/api/share/resolve/traveler-a-card-01")
        assert res.status_code == 200
        g_pub = res.json()["gigs"][0]
        assert "fee" not in g_pub
        assert "deal_type" not in g_pub
        cols = {it["collection"] for it in g_pub["items"]}
        assert "perdiem" not in cols
        assert "guests" not in cols
        flights = [it for it in g_pub["items"] if it["collection"] == "flights"]
        assert [f["data"]["flight_no"] for f in flights] == ["KL100"]
        assert flights[0]["data"]["seat_by_person"] == {"per_a": "2A"}
        hotel = next(it for it in g_pub["items"] if it["collection"] == "hotels")
        assert "wifi_password" not in hotel["data"]
        assert hotel["data"]["room_assignments"] == {"per_a": "401"}


def test_file_vault_header_sanitization_xss_guard_and_cleanup(tmp_path: Path):
    client, _ = _make_client(tmp_path)
    with client:
        # Uploading SVG with malicious filename must sanitize header and force attachment even when inline=true
        up = client.post(
            "/api/files/upload",
            files={"file": ('evil"\r\nX-Injected:1.svg', b"<svg onload=alert(1)></svg>", "image/svg+xml")},
        )
        assert up.status_code == 201
        frec = up.json()["file"]
        assert "\r" not in frec["name"] and "\n" not in frec["name"] and '"' not in frec["name"]

        dl = client.get(f"/api/files/{frec['id']}/download?inline=true")
        assert dl.status_code == 200
        assert dl.headers["content-disposition"].startswith("attachment;")
        assert dl.headers["content-type"] == "application/octet-stream"

        vault_file = tmp_path / "vault" / frec["object_id"]
        assert vault_file.is_file()

        # Deleting removes both metadata and local disk blob
        assert client.delete(f"/api/files/{frec['id']}").status_code == 200
        assert not vault_file.exists()


def test_mcp_read_before_edit_and_changed_since_read(tmp_path: Path):
    client, repo = _make_client(tmp_path, password="pw")
    with client:
        gig = repo.create_gig(Gig(date="2026-12-25", city="Madrid", venue="Fabrik", fee=7000, deal_type="Secret"))
        tm = User(id="usr_tm", name="Maya", role=Role.editor, mcp_key_hash=hash_secret("tm-mcp-secret"))
        repo.upsert_user(tm)

        def mcp(method: str, params: dict | None = None):
            r = client.post(
                "/mcp/tm-mcp-secret",
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}},
            )
            assert r.status_code == 200
            return r.json()["result"]

        res = json.loads(mcp("tools/call", {"name": "list_gigs", "arguments": {}})["content"][0]["text"])
        assert res["gigs"][0]["fee"] == 7000

        add_res = json.loads(
            mcp(
                "tools/call",
                {"name": "add_flights", "arguments": {"gig_id": gig.id, "flights": [{"flight_no": "IB3401", "dep_time": "10:00"}]}},
            )["content"][0]["text"]
        )
        assert add_res["ok"] is True
        fid = add_res["added_ids"][0]

        # Blind update_item without get_gig read_token refused
        blind = json.loads(
            mcp(
                "tools/call",
                {"name": "update_item", "arguments": {"gig_id": gig.id, "item_id": fid, "fields": {"gate": "H1"}}},
            )["content"][0]["text"]
        )
        assert blind["ok"] is False
        assert blind["error"] == "read_required"

        # Read first -> someone else edits -> MCP edit gets changed_since_read
        got = json.loads(mcp("tools/call", {"name": "get_gig", "arguments": {"gig_id": gig.id}})["content"][0]["text"])
        tok = got["read_token"]
        repo.update_item(gig.id, fid, {"gate": "J9"})

        conflict = json.loads(
            mcp(
                "tools/call",
                {"name": "update_item", "arguments": {"gig_id": gig.id, "item_id": fid, "read_token": tok, "fields": {"gate": "H1"}}},
            )["content"][0]["text"]
        )
        assert conflict["ok"] is False
        assert conflict["error"] == "changed_since_read"
        assert conflict["current"]["data"]["gate"] == "J9"

        # Revoked editor is rejected immediately
        tm.revoked = True
        repo.upsert_user(tm)
        revoked_resp = client.post("/mcp/tm-mcp-secret", json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
        assert revoked_resp.status_code == 401


def test_unified_intake_and_spa_fallback(tmp_path: Path):
    client, _ = _make_client(tmp_path)
    with client:
        gid = client.post("/api/gigs", json={"date": "2026-12-30", "city": "Paris"}).json()["gig"]["id"]
        sample = """
        AF1181 LHR -> CDG 11:25 13:45 PNR XYZ123
        Hotel Rochechouart — conf HR9921 +33 1 42 81 91 00
        18h30 - 19h30 Soundcheck at venue
        02:00 - 04:00 Kael
        Marc Promoter +33 6 12 34 56 78 marc@club.example
        """
        ex = client.post("/api/intake/extract", json={"gig_id": gid, "text": sample})
        assert ex.status_code == 200
        items = ex.json()["proposal"]["items"]
        cols = {it["collection"] for it in items}
        assert {"flights", "hotels", "schedule", "timetable", "contacts"} <= cols

        ap = client.post("/api/intake/apply", json={"gig_id": gid, "items": items})
        assert ap.status_code == 200
        assert len(ap.json()["added"]) == 5

        assert client.get("/calendar-view").status_code == 200
        assert client.get("/api/places/cities?q=par").json()["cities"][0]["timezone"] == "Europe/Paris"


def test_v1_sqlite_migrator_lossless_parity(tmp_path: Path):
    v1_path = tmp_path / "v1.sqlite3"
    conn = sqlite3.connect(str(v1_path))
    conn.executescript(
        """
        CREATE TABLE gigs (id TEXT PRIMARY KEY, artist_id TEXT, tour_id TEXT, date TEXT, data TEXT, updated_at TEXT);
        CREATE TABLE gig_trash (id TEXT PRIMARY KEY, data TEXT, deleted_at TEXT, deleted_by TEXT);
        CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, google_sub TEXT, revoked INTEGER, data TEXT, updated_at TEXT);
        CREATE TABLE crew_keys (key TEXT PRIMARY KEY, name_norm TEXT, data TEXT, updated_at TEXT);
        CREATE TABLE settings (key TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
        """
    )
    gig_blob = {
        "id": "gig_legacy_1",
        "date": "2026-11-28",
        "city": "Paris",
        "venue": "Rex Club",
        "fee": 8500.0,
        "currency": "EUR",
        "master_share": {"key": "old-master-key", "enabled": True},
        "flights": [{"id": "fl_1", "flight_no": "AF100", "dep_iata": "LHR", "arr_iata": "CDG", "person_ids": ["cr_1"]}],
        "crew": [{"id": "cr_1", "person_key": "per_artist", "name": "Kael", "email": "artist@example.com", "share": {"key": "artist-gig-key", "enabled": True}}],
        "files": [{"id": "f_1", "name": "boarding.pdf", "mime": "application/pdf", "size": 4096, "person_id": "cr_1"}],
    }
    conn.execute("INSERT INTO gigs VALUES ('gig_legacy_1', NULL, NULL, '2026-11-28', ?, '2026-11-01')", (json.dumps(gig_blob),))
    conn.execute(
        "INSERT INTO users VALUES ('usr_tm', 'tm@example.com', NULL, 0, ?, '2026-11-01')",
        (json.dumps({"id": "usr_tm", "name": "Maya", "role": "editor", "login_key": "keep-login", "mcp_key": "keep-mcp"}),),
    )
    conn.execute(
        "INSERT INTO settings VALUES ('person_directory_v1:per_artist', ?, '2026-11-01')",
        (json.dumps({"name": "Kael", "email": "artist@example.com", "person_kind": "equipe"}),),
    )
    conn.execute(
        "INSERT INTO crew_keys VALUES ('person-share-1', 'kael', ?, '2026-11-01')",
        (json.dumps({"name": "Kael", "person_key": "per_artist"}),),
    )
    conn.commit()
    conn.close()

    target = LocalSqliteRepo(str(tmp_path / "v2.sqlite3"))
    report = migrate_v1_sqlite(v1_path, target)
    assert report["ok"] is True
    assert report["target"]["gigs"] == 1
    assert report["target"]["total_fee_sum"] == 8500.0
    assert report["target"]["share_links"] == 3
    assert report["target"]["files"] == 1
    assert target.find_user_by_login_key_hash(hash_secret("keep-login")) is not None
    assert target.find_user_by_mcp_key_hash(hash_secret("keep-mcp")) is not None
    fl = target.list_items("gig_legacy_1", collection="flights")[0]
    assert fl.person_ids == ["per_artist"]


def test_dynamic_google_ai_model_settings_discovery_and_extraction(tmp_path: Path, monkeypatch):
    client, _ = _make_client(tmp_path)
    with client:
        st = client.get("/api/intake/status")
        assert st.status_code == 200
        assert st.json()["provider"] == "local"
        assert st.json()["google_connected"] is False

        cat_offline = client.get("/api/admin/ai-models")
        assert cat_offline.status_code == 200
        assert cat_offline.json()["source"] == "fallback_catalog"
        assert len(cat_offline.json()["models"]) >= 3

        upd = client.put(
            "/api/admin/ai-settings",
            json={
                "provider": "gemini",
                "model": "gemini-3.5-flash",
                "gemini_api_key": "TEST_KEY_REDACTED_9876",
            },
        )
        assert upd.status_code == 200
        cfg = upd.json()["settings"]
        assert cfg["provider"] == "gemini"
        assert cfg["effective_provider"] == "gemini"
        assert cfg["model"] == "gemini-3.5-flash"
        assert cfg["gemini_api_key_configured"] is True
        assert cfg["gemini_api_key_hint"] == "TEST…9876"
        assert "TEST_KEY_REDACTED_9876" not in json.dumps(cfg)

        async def fake_fetch_gemini_models(api_key: str):
            assert api_key == "TEST_KEY_REDACTED_9876"
            from app.ai.models import _is_intake_capable_gemini_model, _normalize_models

            raw = [
                {"id": "text-embedding-004", "methods": ["embedContent"]},
                {"id": "gemini-2.0-flash", "methods": ["generateContent"]},
                {"id": "gemini-3.5-pro", "methods": ["generateContent"]},
                {"id": "gemini-3.5-flash", "methods": ["generateContent"]},
            ]
            kept = [
                {"id": m["id"], "display_name": m["id"], "description": "", "provider": "gemini"}
                for m in raw
                if _is_intake_capable_gemini_model(m["id"], m["methods"])
            ]
            return _normalize_models(kept)

        monkeypatch.setattr("app.ai.models._fetch_gemini_api_models", fake_fetch_gemini_models)
        cat_live = client.get("/api/admin/ai-models")
        assert cat_live.status_code == 200
        body = cat_live.json()
        assert body["source"] == "live_google"
        ids = [m["id"] for m in body["models"]]
        assert ids == ["gemini-3.5-flash", "gemini-3.5-pro", "gemini-2.0-flash"]
        assert body["models"][0]["recommended"] is True

        async def fake_call_gemini_api(resolved_cfg, payload):
            assert resolved_cfg.model == "gemini-3.5-flash"
            assert resolved_cfg.gemini_api_key == "TEST_KEY_REDACTED_9876"
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": json.dumps(
                                        {
                                            "gig_patch": {},
                                            "items": [
                                                {
                                                    "collection": "schedule",
                                                    "data": {"time": "18:30", "label": "Soundcheck"},
                                                }
                                            ],
                                            "warnings": [],
                                        }
                                    )
                                }
                            ]
                        }
                    }
                ]
            }

        monkeypatch.setattr("app.ai.extract._call_gemini_api", fake_call_gemini_api)
        tested = client.post("/api/admin/ai-test", json={})
        assert tested.status_code == 200
        assert tested.json()["engine"] == "gemini:gemini-3.5-flash"
        assert tested.json()["items_count"] == 1

        clr = client.put("/api/admin/ai-settings", json={"clear_gemini_api_key": True})
        assert clr.status_code == 200
        assert clr.json()["settings"]["gemini_api_key_configured"] is False
        assert clr.json()["settings"]["effective_provider"] == "local"


def test_multi_artist_project_isolation_and_live_role_toggle(tmp_path: Path):
    client, repo = _make_client(tmp_path, password="owner-secret-pw")
    with client:
        # Owner logs in and creates two artist projects: Kael and Nova
        assert client.post("/api/auth/owner-login", json={"password": "owner-secret-pw"}).status_code == 200
        p_kael = client.post("/api/admin/projects", json={"name": "Kael", "color": "#f3c64a"}).json()["project"]
        p_nova = client.post("/api/admin/projects", json={"name": "Nova", "color": "#6ea8fe"}).json()["project"]

        g_kael = client.post("/api/gigs", json={"date": "2026-12-10", "city": "Paris", "artist_id": p_kael["id"]}).json()["gig"]
        g_nova = client.post("/api/gigs", json={"date": "2026-12-11", "city": "Tokyo", "artist_id": p_nova["id"]}).json()["gig"]
        client.post(
            f"/api/gigs/{g_kael['id']}/items",
            json={"collection": "flights", "person_ids": ["per_vj"], "data": {"flight_no": "AF101"}},
        )

        # Create a VJ scoped strictly to Kael as Read-only (viewer) linked to per_vj
        vj_res = client.post(
            "/api/admin/users",
            json={"name": "Lucas (VJ)", "role": "viewer", "artist_ids": [p_kael["id"]], "travel_person_id": "per_vj"},
        ).json()
        vj_id = vj_res["user"]["id"]
        vj_key = vj_res["login_key"]

        # Create a multi-artist road manager (editor across ALL projects: artist_ids=[])
        rm_res = client.post(
            "/api/admin/users",
            json={"name": "Maya (Road Manager)", "role": "editor", "artist_ids": []},
        ).json()
        rm_key = rm_res["login_key"]

        # 1. VJ logs in: ONLY sees Kael's project & gig, NEVER Nova's, and is read-only
        client.post("/api/auth/logout")
        assert client.post("/api/auth/key-login", json={"key": vj_key}).status_code == 200
        assert [p["id"] for p in client.get("/api/projects").json()["projects"]] == [p_kael["id"]]
        assert [g["id"] for g in client.get("/api/gigs").json()["gigs"]] == [g_kael["id"]]
        assert client.get(f"/api/gigs/{g_nova['id']}").status_code == 404
        assert client.patch(f"/api/gigs/{g_kael['id']}", json={"notes": "vj edit"}).status_code == 403

        # 2. Owner flips VJ from Read-only -> Editor live (still strictly scoped to Kael!)
        client.post("/api/auth/logout")
        assert client.post("/api/auth/owner-login", json={"password": "owner-secret-pw"}).status_code == 200
        toggled = client.patch(f"/api/admin/users/{vj_id}", json={"role": "editor"})
        assert toggled.status_code == 200
        assert toggled.json()["user"]["role"] == "editor"
        assert toggled.json()["user"]["artist_ids"] == [p_kael["id"]]

        # VJ can now edit Kael's gig, STILL blocked from Nova's gig and cannot create gigs for Nova
        client.post("/api/auth/logout")
        assert client.post("/api/auth/key-login", json={"key": vj_key}).status_code == 200
        assert client.patch(f"/api/gigs/{g_kael['id']}", json={"notes": "VJ visuals confirmed"}).status_code == 200
        assert client.get(f"/api/gigs/{g_nova['id']}").status_code == 404
        assert client.post("/api/gigs", json={"date": "2026-12-15", "city": "Berlin", "artist_id": p_nova["id"]}).status_code == 403

        # 3. Multi-artist Road Manager sees & edits BOTH Kael and Nova agendas
        client.post("/api/auth/logout")
        assert client.post("/api/auth/key-login", json={"key": rm_key}).status_code == 200
        rm_gigs = {g["id"] for g in client.get("/api/gigs").json()["gigs"]}
        assert rm_gigs == {g_kael["id"], g_nova["id"]}
        assert client.patch(f"/api/gigs/{g_nova['id']}", json={"notes": "Advancing Tokyo"}).status_code == 200
        assert repo.get_gig(g_nova["id"]).notes == "Advancing Tokyo"


def test_hosted_multi_tenant_google_oauth_subpath_quotas_and_arco_rights(tmp_path: Path, monkeypatch):
    static_dir = tmp_path / "static"
    (static_dir / "v3").mkdir(parents=True)
    (static_dir / "v3" / "index.html").write_text(
        '<!doctype html><html><head><link rel="manifest" href="/static/v3/manifest.webmanifest" /></head><body><div id="root"></div></body></html>',
        encoding="utf-8",
    )
    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        static_dir=str(static_dir),
        tenancy_mode="multi",
        base_path="/tourdesigner",
        public_origin="https://example.com",
        google_oauth_client_id="cid-test",
        google_oauth_client_secret="csec-test",
        gemini_api_key="HOSTED_KEY_TEST_1234",
        hosted_ai_daily_limit=1,
        hosted_max_gigs=2,
        bitcoin_donation_address="bc1qexampledonationaddress000000000000000",
        legal_operator_name="Tour Designer Host",
        legal_contact_email="privacy@example.com",
    )
    app = create_app(settings=settings)

    def _google_signin(c: TestClient, sub: str, email: str, name: str):
        async def fake_exchange(**kwargs):
            return {"sub": sub, "email": email, "email_verified": True, "name": name}

        monkeypatch.setattr("app.api.auth._exchange_google_code", fake_exchange)
        start = c.get("/tourdesigner/api/auth/google/start?consent=1", follow_redirects=False)
        assert start.status_code == 302
        assert "accounts.google.com" in start.headers["location"]
        from urllib.parse import parse_qs, urlparse

        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        cb = c.get(f"/tourdesigner/api/auth/google/callback?code=ok&state={state}", follow_redirects=False)
        assert cb.status_code == 302
        assert cb.headers["location"] == "/tourdesigner/tour"

    with TestClient(app) as client_a, TestClient(app) as client_b:
        # 1. Subpath health, manifest, legal pages, and SPA meta injection
        assert client_a.get("/tourdesigner/api/health").json()["base_path"] == "/tourdesigner"
        mf = client_a.get("/tourdesigner/static/v3/manifest.webmanifest").json()
        assert mf["start_url"] == "/tourdesigner/tour"
        login_html = client_a.get("/tourdesigner/login").text
        assert '<meta name="td-base" content="/tourdesigner" />' in login_html
        assert "/tourdesigner/static/v3/manifest.webmanifest" in login_html
        sw_shell_html = client_a.get("/tourdesigner/static/v3/index.html").text
        assert '<meta name="td-base" content="/tourdesigner" />' in sw_shell_html
        assert "/tourdesigner/static/v3/manifest.webmanifest" in sw_shell_html
        assert client_a.get("/tourdesigner/legal/privacy").status_code == 200
        assert client_a.get("/tourdesigner/api/legal/info").json()["contact_email"] == "privacy@example.com"

        # 2. Two independent Google accounts sign up -> physically isolated workspaces
        _google_signin(client_a, "google-sub-alpha", "alpha@example.com", "Alpha Artist")
        _google_signin(client_b, "google-sub-beta", "beta@example.com", "Beta Artist")

        me_a = client_a.get("/tourdesigner/api/auth/me").json()
        me_b = client_b.get("/tourdesigner/api/auth/me").json()
        assert me_a["authenticated"] is True and me_b["authenticated"] is True
        assert me_a["tenant_id"] != me_b["tenant_id"]
        assert me_a["community"]["enabled"] is True
        assert me_a["community"]["milestone_gigs"] == 7
        assert me_a["community"]["btc_address"] == "bc1qexampledonationaddress000000000000000"

        g_a = client_a.post("/tourdesigner/api/gigs", json={"date": "2026-12-10", "city": "Paris"}).json()["gig"]
        g_b = client_b.post("/tourdesigner/api/gigs", json={"date": "2026-12-11", "city": "Tokyo"}).json()["gig"]

        # Zero cross-tenant leakage
        assert [g["id"] for g in client_a.get("/tourdesigner/api/gigs").json()["gigs"]] == [g_a["id"]]
        assert [g["id"] for g in client_b.get("/tourdesigner/api/gigs").json()["gigs"]] == [g_b["id"]]
        assert client_b.get(f"/tourdesigner/api/gigs/{g_a['id']}").status_code == 404

        # Tenant-scoped public share link works seamlessly across tenants
        sh_a = client_a.post("/tourdesigner/api/shares", json={"scope": "gig_master", "gig_id": g_a["id"]}).json()["share"]
        assert sh_a["key"].startswith(f"{me_a['tenant_id']}.")
        assert client_b.get(f"/tourdesigner/api/share/resolve/{sh_a['key']}").json()["gigs"][0]["city"] == "Paris"

        # 3. Hosted daily AI quota (limit=1) allows first Gemini call, falls back cleanly on second
        async def fake_gemini(resolved_cfg, payload):
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": json.dumps({"gig_patch": {}, "items": [{"collection": "schedule", "data": {"time": "18:00", "label": "Soundcheck"}}], "warnings": []})}
                            ]
                        }
                    }
                ]
            }

        monkeypatch.setattr("app.ai.extract._call_gemini_api", fake_gemini)
        r1 = client_a.post("/tourdesigner/api/intake/extract", json={"gig_id": g_a["id"], "text": "18:00 Soundcheck"})
        assert r1.json()["proposal"]["provider"] == "gemini"
        r2 = client_a.post("/tourdesigner/api/intake/extract", json={"gig_id": g_a["id"], "text": "18:00 Soundcheck"})
        assert r2.json()["proposal"]["provider"] == "local"
        assert any("limit reached" in w.lower() for w in r2.json()["proposal"]["warnings"])

        # 4. Self-service ARCO / CCPA export + permanent erasure of Tenant A leaves Tenant B intact
        exp = client_a.get("/tourdesigner/api/account/export")
        assert exp.status_code == 200
        assert exp.json()["export"]["gigs"][0]["city"] == "Paris"

        assert client_a.post("/tourdesigner/api/account/delete", json={"confirm": "nope"}).status_code == 400
        assert client_a.post("/tourdesigner/api/account/delete", json={"confirm": "DELETE"}).status_code == 200
        assert client_a.get("/tourdesigner/api/auth/me").json()["authenticated"] is False
        # Tenant B is completely unaffected!
        assert [g["id"] for g in client_b.get("/tourdesigner/api/gigs").json()["gigs"]] == [g_b["id"]]


def test_hosted_ai_hardlock_byok_multiproviders_and_deprecation_watchdog(tmp_path: Path, monkeypatch):
    """Verify Gemini 4 Hydrogen hardlock, thinkingLevel=low, Anthropic Sonnet 5.5+, OpenAI Astra+, and deprecation email/webhook watchdog."""
    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        tenancy_mode="multi",
        google_oauth_client_id="cid-test",
        google_oauth_client_secret="csec-test",
        vertex_project="secret-host-gcp-proj",
        gemini_api_key="HOST_SECRET_GEMINI_KEY_9999",
        hosted_ai_model="gemini-4-hydrogen",
        hosted_ai_thinking_level="low",
        hosted_ai_max_input_chars=80,
        hosted_ai_max_output_tokens=2048,
        hosted_ai_daily_limit=2,
        digest_cron_token="cron-secret-42",
        model_alert_email="ops@example.com",
    )
    app = create_app(settings=settings)

    async def fake_exchange(**kwargs):
        return {"sub": "sub-hardlock", "email": "artist@example.com", "email_verified": True, "name": "Artist"}

    monkeypatch.setattr("app.api.auth._exchange_google_code", fake_exchange)

    with TestClient(app) as client:
        start = client.get("/api/auth/google/start?consent=1", follow_redirects=False)
        from urllib.parse import parse_qs, urlparse

        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        assert client.get(f"/api/auth/google/callback?code=ok&state={state}", follow_redirects=False).status_code == 302

        # 1. Hardlocked Free Beta hides host creds & locks to gemini-4-hydrogen + thinkingLevel=low
        ai_get = client.get("/api/admin/ai-settings").json()["settings"]
        assert ai_get["hosted_locked"] is True
        assert ai_get["model"] == "gemini-4-hydrogen"
        assert ai_get["hosted_thinking_level"] == "low"
        assert ai_get["vertex_project"] == ""
        assert ai_get["gemini_api_key_hint"] == ""

        # Blocked from upgrading to expensive models on host's bill
        assert client.put("/api/admin/ai-settings", json={"model": "gemini-4-carbon"}).status_code == 403
        assert client.put("/api/admin/ai-settings", json={"provider": "vertex"}).status_code == 403

        # ARCO opt-out to local offline parser works & toggles back cleanly
        assert client.put("/api/admin/ai-settings", json={"provider": "local"}).json()["settings"]["effective_provider"] == "local"
        assert client.put("/api/admin/ai-settings", json={"provider": "auto"}).json()["settings"]["effective_provider"] == "vertex"

        # Locked catalog returns single hosted model without leaking host credentials
        cat_locked = client.get("/api/admin/ai-models").json()
        assert cat_locked["source"] == "hosted_locked"
        assert [m["id"] for m in cat_locked["models"]] == ["gemini-4-hydrogen"]

        # 2. Hosted extraction enforces thinkingLevel="low", maxOutputTokens=2048, and input char cap
        captured_payloads: list[dict] = []

        async def fake_vertex(cfg, payload):
            captured_payloads.append(payload)
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {"text": json.dumps({"gig_patch": {}, "items": [{"collection": "schedule", "data": {"time": "19:00", "label": "Doors"}}], "warnings": []})}
                            ]
                        }
                    }
                ]
            }

        monkeypatch.setattr("app.ai.extract._call_vertex", fake_vertex)
        long_text = "19:00 Doors open " + ("x" * 120)
        ex = client.post("/api/intake/extract", json={"text": long_text}).json()["proposal"]
        assert ex["model"] == "gemini-4-hydrogen"
        assert any("trimmed" in w.lower() for w in ex["warnings"])
        assert captured_payloads[0]["generationConfig"]["thinkingConfig"] == {"thinkingLevel": "low"}
        assert captured_payloads[0]["generationConfig"]["maxOutputTokens"] == 2048

        # 3. BYOK Anthropic key unlocks, auto-picks claude-sonnet-5-5, and ranks Sonnet 5.5+ first in live catalog
        async def fake_anthropic_models(api_key: str):
            from app.ai.models import _anthropic_sort_key

            raw = [
                {"id": "claude-haiku-5", "display_name": "Claude Haiku 5", "provider": "anthropic"},
                {"id": "claude-sonnet-5", "display_name": "Claude Sonnet 5", "provider": "anthropic"},
                {"id": "claude-opus-5-5", "display_name": "Claude Opus 5.5", "provider": "anthropic"},
                {"id": "claude-sonnet-5-5", "display_name": "Claude Sonnet 5.5", "provider": "anthropic"},
            ]
            ordered = sorted(raw, key=_anthropic_sort_key)
            for idx, m in enumerate(ordered):
                m["recommended"] = idx == 0
            return ordered

        async def fake_anthropic_call(cfg, text, gig_context, *, max_output_tokens=None):
            assert cfg.model == "claude-sonnet-5-5"
            return json.dumps({"gig_patch": {}, "items": [{"collection": "schedule", "data": {"time": "20:00", "label": "Soundcheck"}}], "warnings": []})

        monkeypatch.setattr("app.ai.models._fetch_anthropic_models", fake_anthropic_models)
        monkeypatch.setattr("app.ai.extract._call_anthropic_api", fake_anthropic_call)

        saved_anth = client.put("/api/admin/ai-settings", json={"anthropic_api_key": "sk-ant-test-key-12345"}).json()["settings"]
        assert saved_anth["hosted_locked"] is False
        assert saved_anth["effective_provider"] == "anthropic"
        assert saved_anth["model"] == "claude-sonnet-5-5"

        anth_cat = client.get("/api/admin/ai-models?provider=anthropic").json()
        assert anth_cat["source"] == "live_anthropic"
        assert anth_cat["models"][0]["id"] == "claude-sonnet-5-5"
        assert anth_cat["models"][0]["recommended"] is True

        anth_ex = client.post("/api/intake/extract", json={"text": "20:00 Soundcheck"}).json()["proposal"]
        assert anth_ex["provider"] == "anthropic"
        assert anth_ex["model"] == "claude-sonnet-5-5"

        # 4. BYOK OpenAI key switches to openai, auto-picks gpt-6.2-astra, and ranks Astra+ first in live catalog
        async def fake_openai_models(api_key: str):
            from app.ai.models import _openai_sort_key

            raw = [
                {"id": "gpt-5-mini", "display_name": "gpt-5-mini", "provider": "openai"},
                {"id": "gpt-6-astra", "display_name": "gpt-6-astra", "provider": "openai"},
                {"id": "gpt-6.2-astra-pro", "display_name": "gpt-6.2-astra-pro", "provider": "openai"},
                {"id": "gpt-6.2-astra", "display_name": "gpt-6.2-astra", "provider": "openai"},
            ]
            ordered = sorted(raw, key=_openai_sort_key)
            for idx, m in enumerate(ordered):
                m["recommended"] = idx == 0
            return ordered

        async def fake_openai_call(cfg, text, gig_context, *, max_output_tokens=None):
            assert cfg.model == "gpt-6.2-astra"
            return json.dumps({"gig_patch": {}, "items": [{"collection": "schedule", "data": {"time": "22:00", "label": "Showtime"}}], "warnings": []})

        monkeypatch.setattr("app.ai.models._fetch_openai_models", fake_openai_models)
        monkeypatch.setattr("app.ai.extract._call_openai_api", fake_openai_call)

        saved_oai = client.put("/api/admin/ai-settings", json={"openai_api_key": "sk-proj-openai-test-6789"}).json()["settings"]
        assert saved_oai["effective_provider"] == "openai"
        assert saved_oai["model"] == "gpt-6.2-astra"

        oai_cat = client.get("/api/admin/ai-models?provider=openai").json()
        assert oai_cat["source"] == "live_openai"
        assert oai_cat["models"][0]["id"] == "gpt-6.2-astra"
        assert oai_cat["models"][0]["recommended"] is True

        oai_ex = client.post("/api/intake/extract", json={"text": "22:00 Showtime"}).json()["proposal"]
        assert oai_ex["provider"] == "openai"
        assert oai_ex["model"] == "gpt-6.2-astra"

        # 5. Clearing BYOK keys re-engages the Gemini 4 Hydrogen hardlock cleanly
        re_locked = client.put(
            "/api/admin/ai-settings",
            json={"clear_anthropic_api_key": True, "clear_openai_api_key": True},
        ).json()["settings"]
        assert re_locked["hosted_locked"] is True
        assert re_locked["model"] == "gemini-4-hydrogen"

        # 6. Model deprecation watchdog (/api/cron/check-ai-model) detects sunset model, persists alert, and fires notification
        notified_events: list[dict] = []

        async def fake_live_catalog(cfg, provider_override=None):
            return {
                "models": [
                    {"id": "gemini-5-hydrogen", "display_name": "Gemini 5 Hydrogen", "recommended": True, "provider": "vertex"},
                ],
                "source": "live_google",
                "provider_queried": "vertex",
                "fetched_at": "2026-11-25T22:00:00Z",
                "note": None,
            }

        async def fake_notify(cfg_settings, *, current_model, recommended_model, reason):
            notified_events.append({"current": current_model, "recommended": recommended_model, "reason": reason})
            return ["resend"]

        monkeypatch.setattr("app.ai.models.fetch_google_models", fake_live_catalog)
        monkeypatch.setattr("app.ai.models.notify_model_deprecation", fake_notify)

        cron_res = client.post("/api/cron/check-ai-model", headers={"X-Cron-Token": "cron-secret-42"})
        assert cron_res.status_code == 200
        body = cron_res.json()
        assert body["deprecated"] is True
        assert body["current_model"] == "gemini-4-hydrogen"
        assert body["recommended_model"] == "gemini-5-hydrogen"
        assert body["env_patch"] == "HOSTED_AI_MODEL=gemini-5-hydrogen"
        assert body["notified_via"] == ["resend"]
        assert len(notified_events) == 1

        # Alert is immediately visible in Settings for the owner (and any future agent)
        alert_res = client.get("/api/admin/ai-settings").json()["alert"]
        assert alert_res["model"] == "gemini-4-hydrogen"
        assert alert_res["recommended_model"] == "gemini-5-hydrogen"


def test_public_beta_self_service_mcp_bearer_prompts_and_reminders(tmp_path: Path, monkeypatch):
    """Verify 1-click self-service MCP URL + Bearer auth + automation prompts + reminders in hosted multi-tenant subpath mode."""
    from datetime import date, timedelta

    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        tenancy_mode="multi",
        base_path="/tourdesigner",
        public_origin="https://example.com",
        google_oauth_client_id="cid-test",
        google_oauth_client_secret="csec-test",
    )
    app = create_app(settings=settings)

    async def fake_exchange(**kwargs):
        return {"sub": "sub-mcp-beta", "email": "dj@example.com", "email_verified": True, "name": "DJ Beta"}

    monkeypatch.setattr("app.api.auth._exchange_google_code", fake_exchange)

    with TestClient(app) as client:
        start = client.get("/tourdesigner/api/auth/google/start?consent=1", follow_redirects=False)
        from urllib.parse import parse_qs, urlparse

        state = parse_qs(urlparse(start.headers["location"]).query)["state"][0]
        assert client.get(f"/tourdesigner/api/auth/google/callback?code=ok&state={state}", follow_redirects=False).status_code == 302

        # Create an upcoming confirmed show missing flight/hotel/soundcheck
        tomorrow = (date.today() + timedelta(days=1)).isoformat()
        gig = client.post(
            "/tourdesigner/api/gigs",
            json={"date": tomorrow, "city": "Berlin", "venue": "Watergate", "status": "confirmed"},
        ).json()["gig"]

        # 1. Self-service MCP URL generation
        issued = client.post("/tourdesigner/api/auth/my-mcp-key").json()
        assert issued["mcp_url"] == f"https://example.com/tourdesigner/mcp/{issued['mcp_key']}"
        assert issued["bearer_endpoint"] == "https://example.com/tourdesigner/mcp"
        token = issued["mcp_key"]

        # 2. Works via BOTH /mcp/{token} (Claude / Gemini CLI / ChatGPT URL) AND /mcp + Bearer (Grok / OpenAI / bots)
        init_res = client.post(
            f"/tourdesigner/mcp/{token}",
            json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
        ).json()
        assert "prompts" in init_res["result"]["capabilities"]

        ping_res = client.post(
            "/tourdesigner/mcp",
            headers={"Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 2, "method": "ping"},
        ).json()
        assert ping_res["result"] == {}

        prompts_res = client.post(
            "/tourdesigner/mcp",
            headers={"Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 3, "method": "prompts/list"},
        ).json()
        prompt_names = {p["name"] for p in prompts_res["result"]["prompts"]}
        assert {"daily_tour_briefing", "advancing_reminder_sweep", "ingest_promoter_email"} <= prompt_names

        # 3. Create, list, brief, complete (repeating auto-advance), and delete reminders
        def mcp_call(tool_name: str, arguments: dict) -> dict:
            r = client.post(
                "/tourdesigner/mcp",
                headers={"Authorization": f"Bearer {token}"},
                json={"jsonrpc": "2.0", "id": 10, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}},
            ).json()
            return json.loads(r["result"]["content"][0]["text"])

        created_rem = mcp_call(
            "create_reminder",
            {"title": "Confirm Berlin flight", "due_at": tomorrow, "gig_id": gig["id"], "priority": "high", "repeat": "weekly"},
        )
        assert created_rem["ok"] is True
        rem_id = created_rem["reminder"]["id"]

        brief = mcp_call("get_daily_briefing", {"days_ahead": 7})
        assert brief["ok"] is True
        assert len(brief["upcoming_gigs"]) == 1
        assert brief["logistics_gaps"][0]["missing"] == ["flights", "hotel", "soundcheck"]
        assert brief["open_reminders"][0]["id"] == rem_id

        # Completing a weekly repeating reminder advances its due date by 7 days automatically
        adv = mcp_call("complete_reminder", {"reminder_id": rem_id, "done": True})
        assert adv["ok"] is True
        assert adv["reminder"]["done"] is False
        assert adv["reminder"]["due_at"] == (date.today() + timedelta(days=8)).isoformat()

        assert mcp_call("delete_reminder", {"reminder_id": rem_id})["ok"] is True
        assert mcp_call("list_reminders", {"status": "all"})["reminders"] == []

        # 3b. Upload, assign, list, and retrieve boarding pass via MCP (inline image + signed download URL)
        import base64

        person_res = client.post("/tourdesigner/api/people", json={"name": "Alex Tour", "role": "Artist"}).json()["person"]
        png_bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        up_res = mcp_call(
            "upload_file",
            {
                "filename": "berlin-boarding-pass.png",
                "mime": "image/png",
                "content_base64": base64.b64encode(png_bytes).decode("ascii"),
                "gig_id": gig["id"],
                "person_name": "Alex",
                "doc_kind": "boarding_pass",
                "pinned": True,
            },
        )
        assert up_res["ok"] is True
        fid = up_res["file"]["id"]
        assert up_res["file"]["person_id"] == person_res["id"]

        listed_files = mcp_call("list_files", {"gig_id": gig["id"], "doc_kind": "boarding_pass"})
        assert [f["id"] for f in listed_files["files"]] == [fid]

        raw_get = client.post(
            "/tourdesigner/mcp",
            headers={"Authorization": f"Bearer {token}"},
            json={"jsonrpc": "2.0", "id": 11, "method": "tools/call", "params": {"name": "get_file", "arguments": {"file_id": fid}}},
        ).json()
        blocks = raw_get["result"]["content"]
        assert any(b.get("type") == "image" and b.get("mimeType") == "image/png" for b in blocks)
        assert any(b.get("type") == "resource_link" for b in blocks)
        meta = json.loads(blocks[0]["text"])
        dl_url = meta["download_url"]
        assert "/tourdesigner/api/files/mcp/" in dl_url
        # Signed URL works without browser cookies (e.g. from ChatGPT/Claude mobile chat)
        dl_path = dl_url.replace("https://example.com", "")
        dl_resp = client.get(dl_path)
        assert dl_resp.status_code == 200
        assert dl_resp.content == png_bytes
        # Tampered signed URL fails closed
        assert client.get(dl_path + "tamper").status_code == 401

        # 3c. In multi-tenant (public) mode, legacy operator Drive fallback (drive_file_id) MUST be hard-blocked
        from app.domain.models import FileRecord as TdFileRecord

        t_repo = app.state.tenant_manager.get_repo(client.get("/tourdesigner/api/auth/me").json()["tenant_id"])
        drive_rec = t_repo.upsert_file(
            TdFileRecord(
                object_id="obj_legacy_drive_1",
                gig_id=gig["id"],
                name="legacy-rider.pdf",
                mime="application/pdf",
                size=11,
                drive_file_id="1DriveLegacyFileIdXYZ",
            )
        )
        monkeypatch.setattr("app.api.files._fetch_drive_bytes", lambda fid, m: (b"%PDF-1.4\n%%", "application/pdf"))
        monkeypatch.setattr("app.mcp.server._fetch_drive_bytes", lambda fid, m: (b"%PDF-1.4\n%%", "application/pdf"))
        dl_drive = client.get(f"/tourdesigner/api/files/{drive_rec.id}/download")
        assert dl_drive.status_code == 404
        mcp_drive = mcp_call("get_file", {"file_id": drive_rec.id})
        assert mcp_drive["ok"] is True
        dl_signed_drive = client.get(mcp_drive["download_url"].replace("https://example.com", ""))
        assert dl_signed_drive.status_code == 404

        # 4. Revoking personal MCP key immediately blocks further calls
        assert client.delete("/tourdesigner/api/auth/my-mcp-key").status_code == 200
        assert (
            client.post(
                "/tourdesigner/mcp",
                headers={"Authorization": f"Bearer {token}"},
                json={"jsonrpc": "2.0", "id": 99, "method": "ping"},
            ).status_code
            == 401
        )


def test_public_beta_email_password_signup_and_login_isolation(tmp_path: Path):
    """Verify old-school email + scrypt password sign-up/sign-in in multi-tenant subpath mode."""
    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        tenancy_mode="multi",
        base_path="/tourdesigner",
        google_oauth_client_id="cid-test",
        google_oauth_client_secret="csec-test",
    )
    app = create_app(settings=settings)

    with TestClient(app) as client_a, TestClient(app) as client_b:
        me_anon = client_a.get("/tourdesigner/api/auth/me").json()
        assert me_anon["email_password_enabled"] is True
        assert me_anon["google_oauth_enabled"] is True

        # Consent and 8+ char password enforced
        assert (
            client_a.post(
                "/tourdesigner/api/auth/register",
                json={"email": "dj1@example.com", "password": "strongpassword1", "consent": False},
            ).status_code
            == 400
        )
        assert (
            client_a.post(
                "/tourdesigner/api/auth/register",
                json={"email": "dj1@example.com", "password": "short", "consent": True},
            ).status_code
            == 400
        )

        reg = client_a.post(
            "/tourdesigner/api/auth/register",
            json={"name": "DJ One", "email": "DJ1@Example.com", "password": "strongpassword1", "consent": True},
        )
        assert reg.status_code == 201
        tid_a = reg.json()["tenant_id"]

        # Duplicate email rejected
        assert (
            client_b.post(
                "/tourdesigner/api/auth/register",
                json={"email": "dj1@example.com", "password": "anotherpassword", "consent": True},
            ).status_code
            == 409
        )

        # Create a gig in Tenant A, sign out, and sign back in with email + password
        g_a = client_a.post("/tourdesigner/api/gigs", json={"date": "2026-12-20", "city": "Montreal"}).json()["gig"]
        client_a.post("/tourdesigner/api/auth/logout")
        assert client_a.get("/tourdesigner/api/auth/me").json()["authenticated"] is False

        assert (
            client_a.post(
                "/tourdesigner/api/auth/password-login",
                json={"email": "dj1@example.com", "password": "wrongpassword"},
            ).status_code
            == 401
        )
        ok_login = client_a.post(
            "/tourdesigner/api/auth/password-login",
            json={"email": "dj1@example.com", "password": "strongpassword1"},
        )
        assert ok_login.status_code == 200
        assert ok_login.json()["tenant_id"] == tid_a
        assert [g["id"] for g in client_a.get("/tourdesigner/api/gigs").json()["gigs"]] == [g_a["id"]]

        # Second email user gets a completely isolated workspace
        reg_b = client_b.post(
            "/tourdesigner/api/auth/register",
            json={"name": "DJ Two", "email": "dj2@example.com", "password": "strongpassword2", "consent": True},
        )
        assert reg_b.status_code == 201
        assert reg_b.json()["tenant_id"] != tid_a
        assert client_b.get("/tourdesigner/api/gigs").json()["gigs"] == []


def test_p0_gcs_mcp_upload_ssrf_stateless_read_token_and_flight_aliases(tmp_path: Path, monkeypatch):
    """P0: GCS MCP upload/get inline, SSRF blocklist on source_url, stateless HMAC read_token CAS, and add_flights alias normalization."""
    import base64

    static_dir = tmp_path / "static"
    (static_dir / "v3").mkdir(parents=True)
    (static_dir / "v3" / "index.html").write_text("<html><head><title>App</title></head><body>ok</body></html>", encoding="utf-8")

    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        file_storage_backend="gcs",
        file_vault_bucket="td-test-bucket",
        static_dir=str(static_dir),
        tenancy_mode="single",
        basic_auth_password="owner-secret-pw",
    )
    app = create_app(settings=settings)

    gcs_store: dict[str, tuple[bytes, str]] = {}

    def fake_gcs_upload(bucket: str, key: str, raw: bytes, mime: str):
        gcs_store[key] = (raw, mime)

    def fake_gcs_download(bucket: str, key: str, max_bytes: int | None = None):
        return gcs_store[key][0]

    monkeypatch.setattr("app.api.files.upload_gcs_bytes", fake_gcs_upload)
    monkeypatch.setattr("app.api.files.download_gcs_bytes", fake_gcs_download)
    monkeypatch.setattr("app.mcp.server.upload_gcs_bytes", fake_gcs_upload)
    monkeypatch.setattr("app.mcp.server.download_gcs_bytes", fake_gcs_download)
    monkeypatch.setattr("app.mcp.server._sign_gcs_url", lambda key, method="GET": f"https://storage.example/{key}")

    with TestClient(app) as client:
        assert client.post("/api/auth/owner-login", json={"password": "owner-secret-pw"}).status_code == 200
        gig = client.post("/api/gigs", json={"date": "2026-12-16", "city": "El Paso"}).json()["gig"]
        tok = client.post("/api/auth/my-mcp-key").json()["mcp_key"]

        def mcp_call(tool_name: str, arguments: dict) -> dict:
            r = client.post(
                "/mcp",
                headers={"Authorization": f"Bearer {tok}"},
                json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool_name, "arguments": arguments}},
            ).json()
            return json.loads(r["result"]["content"][0]["text"])

        # 1. GCS upload_file + inline get_file
        png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde"
        up = mcp_call(
            "upload_file",
            {
                "filename": "qr-pass.png",
                "mime": "image/png",
                "content_base64": base64.b64encode(png).decode("ascii"),
                "gig_id": gig["id"],
            },
        )
        assert up["ok"] is True
        assert not up["file"]["gcs_key"].startswith("local/")
        assert up["file"]["gcs_key"] in gcs_store

        raw_get = client.post(
            "/mcp",
            headers={"Authorization": f"Bearer {tok}"},
            json={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_file", "arguments": {"file_id": up["file"]["id"]}}},
        ).json()
        blocks = raw_get["result"]["content"]
        assert any(b.get("type") == "image" and b.get("mimeType") == "image/png" for b in blocks)

        # 2. SSRF protection on upload_file source_url
        for bad_url in (
            "http://example.com/pass.png",
            "https://127.0.0.1/pass.png",
            "https://169.254.169.254/latest/meta-data/",
            "https://10.0.0.5/secret.pdf",
        ):
            bad = mcp_call("upload_file", {"filename": "x.png", "source_url": bad_url})
            assert bad["ok"] is False

        # 3. add_flights alias normalization (flight_number / from / to / departure_time / arrival_time / confirmation_code)
        added = mcp_call(
            "add_flights",
            {
                "gig_id": gig["id"],
                "flights": [
                    {
                        "airline": "American Airlines",
                        "flight_number": "AA 91",
                        "from": "LHR",
                        "to": "ORD",
                        "departure_time": "2026-12-16T16:30:00Z",
                        "arrival_time": "2026-12-16 19:25",
                        "seat": "11L",
                        "confirmation_code": "YNMGMB",
                    }
                ],
            },
        )
        assert added["ok"] is True
        item_id = added["added_ids"][0]
        got = mcp_call("get_gig", {"gig_id": gig["id"]})
        fl = got["items"][0]["data"]
        assert fl["flight_no"] == "AA 91"
        assert fl["dep_iata"] == "LHR"
        assert fl["arr_iata"] == "ORD"
        assert fl["dep_time"] == "16:30"
        assert fl["arr_time"] == "19:25"
        assert fl["seats"] == "11L"
        assert fl["ref"] == "YNMGMB"

        # 4. Stateless HMAC read_token CAS works across fresh app instance (no RAM _SEEN_READS)
        rt = got["read_token"]
        assert rt.startswith("rt1.")
        upd = mcp_call("update_item", {"gig_id": gig["id"], "item_id": item_id, "read_token": rt, "fields": {"seats": "12A"}})
        assert upd["ok"] is True
        assert upd["item"]["data"]["seats"] == "12A"
        # Reusing stale read_token triggers changed_since_read CAS conflict
        stale = mcp_call("update_item", {"gig_id": gig["id"], "item_id": item_id, "read_token": rt, "fields": {"seats": "14C"}})
        assert stale["ok"] is False
        assert stale["error"] == "changed_since_read"


def test_p1_p2_landing_seo_interest_multidate_ics_and_digest(tmp_path: Path, monkeypatch):
    """P1/P2: / landing without redirect, /robots.txt, /sitemap.xml, /api/public/interest + SMTP, multi-date extract, .ics feed, and J-1 digest."""
    from datetime import datetime, timedelta, timezone

    static_dir = tmp_path / "static"
    (static_dir / "v3").mkdir(parents=True)
    (static_dir / "v3" / "index.html").write_text(
        "<!doctype html><html><head><title>Tour Designer</title></head><body><div id='root'></div></body></html>",
        encoding="utf-8",
    )

    sent_emails: list[dict] = []

    class FakeSmtp:
        def __init__(self, host, port, timeout=10):
            self.host = host
            self.port = port

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

        def starttls(self):
            pass

        def login(self, u, p):
            pass

        def send_message(self, msg):
            sent_emails.append({"to": msg["To"], "reply_to": msg["Reply-To"], "subject": msg["Subject"]})

    monkeypatch.setattr("app.api.integrations.smtplib.SMTP", FakeSmtp)

    settings = Settings(
        env="prod",
        repo_backend="sqlite",
        local_db_path=str(tmp_path / "root.sqlite3"),
        file_vault_local_path=str(tmp_path / "vault"),
        static_dir=str(static_dir),
        tenancy_mode="multi",
        digest_cron_token="cron-tok-123",
        interest_notify_email="inbox@example.com",
        smtp_host="smtp.example.com",
        smtp_port=587,
        smtp_user="sender@example.com",
        smtp_password="pw",
    )
    app = create_app(settings=settings)

    with TestClient(app) as client:
        # 1. Logged-out / serves 200 landing HTML (no redirect to /login), /robots.txt & /sitemap.xml valid
        root_res = client.get("/", follow_redirects=False)
        assert root_res.status_code == 200
        assert "<title>Tour Designer</title>" in root_res.text

        robots = client.get("/robots.txt")
        assert robots.status_code == 200
        assert "Disallow: /link/" in robots.text
        assert "Disallow: /api/" in robots.text
        assert "Disallow: /mcp/" in robots.text

        sm = client.get("/sitemap.xml")
        assert sm.status_code == 200
        assert "/demo" in sm.text
        assert "/help" in sm.text
        assert "/llms.txt" in sm.text

        llms = client.get("/llms.txt")
        assert llms.status_code == 200
        assert "llms-full.txt" in llms.text
        assert "docker compose" in llms.text

        llms_full = client.get("/llms-full.txt")
        assert llms_full.status_code == 200
        assert "LLM & IT Systems Integration Guide" in llms_full.text

        help_page = client.get("/help", follow_redirects=False)
        assert help_page.status_code == 200

        # 2. Public interest form validation + persistence
        assert client.post("/api/public/interest", json={"email": "bad"}).status_code == 400
        ok_lead = client.post(
            "/api/public/interest",
            json={"name": "Alex", "email": "agency@example.com", "org": "Sunset Touring", "roster_size": "6-15 artists"},
        )
        assert ok_lead.status_code == 200
        assert ok_lead.json()["received"] is True
        assert len(sent_emails) == 1
        assert sent_emails[0]["to"] == "inbox@example.com"
        assert sent_emails[0]["reply_to"] == "agency@example.com"

        # 3. Register user, test multi-date CSV extraction, revocable .ics feed, and J-1 digest dry_run
        reg = client.post(
            "/api/auth/register",
            json={"name": "Tour Mgr", "email": "tm@example.com", "password": "strongpassword1", "consent": True},
        )
        assert reg.status_code == 201

        tomorrow = (datetime.now(timezone.utc).date() + timedelta(days=1)).isoformat()
        client.post("/api/gigs", json={"date": tomorrow, "city": "Brussels", "venue": "Fuse", "status": "confirmed"})

        ext = client.post(
            "/api/intake/extract",
            json={"text": "2026-11-28, San Francisco, Public Works\n2026-12-05, Mexico City, Foro Indie Rocks"},
        )
        assert ext.status_code == 200
        assert len(ext.json()["proposal"]["multi_dates"]) == 2

        cal_tok = client.post("/api/calendar/token").json()
        ics = client.get(cal_tok["ics_path"])
        assert ics.status_code == 200
        assert "BEGIN:VCALENDAR" in ics.text
        assert "Brussels" in ics.text

        # Revoking token invalidates .ics URL
        assert client.delete("/api/calendar/token").status_code == 200
        assert client.get(cal_tok["ics_path"]).status_code == 404

        # J-1 digest dry_run
        dig = client.post("/api/cron/gig-digest?dry_run=true", headers={"X-Cron-Token": "cron-tok-123"})
        assert dig.status_code == 200
        assert dig.json()["due"] == 1
        assert dig.json()["sent"] == 0
        assert dig.json()["dry_run"] is True


def test_github_update_check(tmp_path: Path, monkeypatch):
    """Self-hosted GitHub update check detects newer commits and degrades gracefully offline."""
    from app.api import integrations
    from app.config import get_settings

    client, _ = _make_client(tmp_path)

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict):
            self.status_code = status_code
            self._payload = payload

        def json(self):
            return self._payload

    # Reset cache and pin local BUILD_SHA
    integrations._UPDATE_CACHE.update({"checked_at": 0.0, "repo": "", "latest": None})
    monkeypatch.setenv("BUILD_SHA", "aaaa111")
    monkeypatch.setenv("TENANCY_MODE", "single")
    get_settings.cache_clear()

    # 1. Newer commit on GitHub main -> update_available=True
    monkeypatch.setattr(
        integrations.httpx,
        "get",
        lambda *a, **kw: _FakeResp(
            200,
            {
                "sha": "bbbb222999999999999999999999999999999999",
                "commit": {
                    "message": "feat: unified Add menu & update checker\n\ndetails",
                    "committer": {"date": "2026-11-26T00:00:00Z"},
                },
            },
        ),
    )
    with client:
        r1 = client.get("/api/system/update-check")
        assert r1.status_code == 200
        d1 = r1.json()
        assert d1["enabled"] is True
        assert d1["current_sha"] == "aaaa111"
        assert d1["latest_sha"] == "bbbb222"
        assert d1["update_available"] is True
        assert "aaaa111...bbbb222" in d1["compare_url"]
        assert d1["latest_message"] == "feat: unified Add menu & update checker"

        # 2. Matching SHA -> update_available=False (with force=true bypassing 6h cache)
        monkeypatch.setenv("BUILD_SHA", "bbbb222")
        get_settings.cache_clear()
        r2 = client.get("/api/system/update-check?force=true")
        assert r2.status_code == 200
        assert r2.json()["update_available"] is False

        # 3. Offline / network error -> graceful offline=True, never 500
        def _boom(*a, **kw):
            raise RuntimeError("offline")

        monkeypatch.setattr(integrations.httpx, "get", _boom)
        r3 = client.get("/api/system/update-check?force=true")
        assert r3.status_code == 200
        d3 = r3.json()
        assert d3["enabled"] is True
        assert d3["offline"] is True
        assert d3["update_available"] is False
    get_settings.cache_clear()


def test_public_file_vault_isolation_and_drive_block(tmp_path: Path, monkeypatch):
    """Multi-tenant mode hard-blocks Google Drive mirroring, validates GCS tenant prefixes, and isolates private files."""
    from app.api import files as files_api
    from app.config import get_settings
    from app.domain.models import FileRecord

    client, repo = _make_client(tmp_path, password="owner-secret-password")

    # 1. Hard-block Drive mirroring in multi-tenant mode even if env vars are misconfigured
    monkeypatch.setenv("TENANCY_MODE", "multi")
    monkeypatch.setenv("DRIVE_MIRROR_ENABLED", "true")
    monkeypatch.setenv("DRIVE_ROOT_FOLDER_ID", "0A_SHOULD_NEVER_TOUCH")
    get_settings.cache_clear()

    rec = repo.upsert_file(
        FileRecord(
            object_id="obj_test_drive_block",
            name="passport.pdf",
            mime="application/pdf",
            size=128,
            gcs_key="vault/t/tenant_a/obj_test_drive_block",
            scope="private",
        )
    )
    files_api._mirror_file_to_workspace_drive(repo, rec.id)
    reloaded = repo.get_file(rec.id)
    assert reloaded is not None
    assert reloaded.mirror_status != "pending"

    # 2. Strict tenant GCS key prefix validation
    multi_cfg = Settings(tenancy_mode="multi")
    assert files_api._gcs_key_allowed_for_tenant("vault/t/tenant_a/obj_1", multi_cfg, "tenant_a") is True
    assert files_api._gcs_key_allowed_for_tenant("vault/t/tenant_b/obj_1", multi_cfg, "tenant_a") is False
    assert files_api._gcs_key_allowed_for_tenant("vault/v2/obj_1", multi_cfg, "tenant_a") is False
    assert files_api._gcs_key_allowed_for_tenant("vault/t/tenant_a/../tenant_b/obj_1", multi_cfg, "tenant_a") is False
    assert files_api._gcs_key_allowed_for_tenant("vault/t/tenant_a/obj_1", multi_cfg, None) is False

    # 3. Private-scope files (passports/visas) are strictly owner-only
    monkeypatch.setenv("TENANCY_MODE", "single")
    get_settings.cache_clear()
    editor_key = "tdk_editor_isolation_test_key"
    repo.upsert_user(
        User(
            id="usr_editor_iso",
            name="Crew Editor",
            role="editor",
            login_key_hash=hash_secret(editor_key),
        )
    )
    with client:
        # Editor signs in via login key
        r_login = client.post("/api/auth/key-login", json={"key": editor_key})
        assert r_login.status_code == 200
        # Private file must not appear in list or be downloadable/deletable by editor
        r_list = client.get("/api/files")
        assert r_list.status_code == 200
        assert all(f["id"] != rec.id for f in r_list.json()["files"])
        assert client.get(f"/api/files/{rec.id}/download").status_code == 404
        assert client.patch(f"/api/files/{rec.id}", json={"scope": "crew"}).status_code == 404
        assert client.delete(f"/api/files/{rec.id}").status_code == 404
    get_settings.cache_clear()
