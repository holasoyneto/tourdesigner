"""Realistic demo tour seed data for local development."""

from __future__ import annotations

from datetime import date, timedelta

from app.domain.auth import hash_secret
from app.domain.models import Gig, GigItem, GigStatus, Person, Project, Role, ShareLink, User
from app.repo.protocol import ActorContext, TourRepo


def seed_demo_if_empty(repo: TourRepo) -> bool:
    if repo.list_gigs():
        return False

    actor = ActorContext(actor_id="seed", actor_name="System", channel="web")

    # Multi-artist projects
    projects = [
        Project(id="art_kael", name="Kael", color="#f3c64a", notes="Club & festival headline touring"),
        Project(id="art_nova", name="Nova", color="#6ea8fe", notes="Live A/V showcase tour"),
    ]
    repo.set_setting("projects", [p.model_dump(mode="json") for p in projects])

    # Demo local accounts (Owner, Multi-Artist Road Manager, and Scoped Artist Viewer)
    repo.ensure_owner("Alex Rivera", "owner@example.com")
    tm_user = repo.upsert_user(
        User(
            id="usr_tm_demo",
            name="Maya Chen",
            email="tm@example.com",
            role=Role.editor,
            artist_ids=[],  # Multi-artist road manager: manages all projects
            login_key_hash=hash_secret("demo-tm-login"),
            mcp_key_hash=hash_secret("demo-tm-mcp"),
        )
    )
    repo.upsert_user(
        User(
            id="usr_artist_demo",
            name="Kael (Artist)",
            email="artist@example.com",
            role=Role.viewer,
            artist_ids=["art_kael"],
            travel_person_id="per_artist",
            login_key_hash=hash_secret("demo-artist-login"),
        )
    )

    # Canonical people directory
    artist = repo.upsert_person(
        Person(
            id="per_artist",
            name="Kael (Artist)",
            person_kind="equipe",
            role="Artist",
            phone="+33 6 11 22 33 44",
            email="artist@example.com",
            permanent=True,
        )
    )
    tm_person = repo.upsert_person(
        Person(
            id="per_tm",
            name="Maya Chen",
            person_kind="equipe",
            role="Tour Manager",
            phone="+33 6 55 66 77 88",
            email="tm@example.com",
            permanent=True,
        )
    )
    promoter = repo.upsert_person(
        Person(
            id="per_promoter",
            name="Marc Laurent",
            person_kind="promoteur",
            role="Promoter",
            company="Rex Club Paris",
            phone="+33 1 42 36 10 96",
            email="marc@rexclub.example",
        )
    )
    driver = repo.upsert_person(
        Person(
            id="per_driver",
            name="Elena Vance",
            person_kind="chauffeur",
            role="Driver",
            phone="+49 170 555 0199",
        )
    )

    today = date.today()
    d1 = (today + timedelta(days=2)).isoformat()
    d2 = (today + timedelta(days=5)).isoformat()
    d3 = (today + timedelta(days=12)).isoformat()
    d_past = (today - timedelta(days=6)).isoformat()

    g1 = repo.create_gig(
        Gig(
            id="gig_paris_01",
            artist_id="art_kael",
            name="Kael — Paris",
            date=d1,
            venue="Rex Club",
            city="Paris",
            country="France",
            timezone="Europe/Paris",
            venue_address="5 Boulevard Poissonnière, 75002 Paris",
            venue_capacity="800",
            doors_time="23:30",
            soundcheck_time="18:30",
            set_time="02:00",
            set_end="04:00",
            set_day_offset=1,
            status=GigStatus.confirmed,
            promoter="Rex Productions",
            fee=8500.0,
            currency="EUR",
            deal_type="Flat fee + flights & hotel (net)",
            notes="2x CDJ-3000 + DJM-A9 confirmed. Bring spare USBs.",
        ),
        actor=actor,
    )

    repo.add_items(
        g1.id,
        [
            GigItem(
                gig_id=g1.id,
                collection="flights",
                person_ids=[artist.id, tm_person.id],
                data={
                    "airline": "Air France",
                    "flight_no": "AF1181",
                    "dep_iata": "LHR",
                    "dep_city": "London",
                    "dep_time": "11:25",
                    "dep_tz": "Europe/London",
                    "arr_iata": "CDG",
                    "arr_city": "Paris",
                    "arr_time": "13:45",
                    "arr_tz": "Europe/Paris",
                    "terminal": "2E",
                    "gate": "K42",
                    "ref": "AFX92K",
                    "seat_by_person": {artist.id: "3A", tm_person.id: "3C"},
                    "status": "on_time",
                },
            ),
            GigItem(
                gig_id=g1.id,
                collection="transport",
                person_ids=[artist.id, tm_person.id],
                data={
                    "mode": "van",
                    "type": "pickup",
                    "time": "14:15",
                    "from": "CDG Terminal 2E",
                    "to": "Hôtel Rochechouart",
                    "driver_name": "Karim B.",
                    "driver_phone": "+33 6 99 88 77 66",
                    "vehicle": "Mercedes V-Class Black",
                },
            ),
            GigItem(
                gig_id=g1.id,
                collection="hotels",
                person_ids=[artist.id, tm_person.id],
                data={
                    "name": "Hôtel Rochechouart",
                    "address": "55 Boulevard Marguerite de Rochechouart, 75009 Paris",
                    "city": "Paris",
                    "phone": "+33 1 42 81 91 00",
                    "checkin": "15:00",
                    "checkout": "13:00",
                    "confirmation": "HR-88412",
                    "wifi_ssid": "Rochechouart_Guest",
                    "room_assignments": {artist.id: "Suite 402", tm_person.id: "Room 405"},
                },
            ),
            GigItem(
                gig_id=g1.id,
                collection="schedule",
                person_ids=[artist.id, tm_person.id],
                data={
                    "time": "18:30",
                    "end_time": "19:30",
                    "label": "Soundcheck & booth test",
                    "location": "Rex Club",
                    "kind": "soundcheck",
                },
            ),
            GigItem(
                gig_id=g1.id,
                collection="schedule",
                person_ids=[artist.id, tm_person.id, promoter.id],
                data={
                    "time": "20:00",
                    "end_time": "22:00",
                    "label": "Team dinner",
                    "location": "Bouillon Pigalle",
                    "kind": "meal",
                },
            ),
            GigItem(
                gig_id=g1.id,
                collection="timetable",
                data={"act": "Warmup Local", "start": "23:30", "end": "02:00", "stage": "Main Room", "is_us": False},
            ),
            GigItem(
                gig_id=g1.id,
                collection="timetable",
                data={"act": "Kael", "start": "02:00", "end": "04:00", "stage": "Main Room", "is_us": True},
            ),
            GigItem(
                gig_id=g1.id,
                collection="timetable",
                data={"act": "Closing Guest", "start": "04:00", "end": "06:00", "stage": "Main Room", "is_us": False},
            ),
            GigItem(
                gig_id=g1.id,
                collection="crew",
                person_ids=[artist.id],
                data={"name": artist.name, "role": "Artist", "phone": artist.phone, "email": artist.email},
            ),
            GigItem(
                gig_id=g1.id,
                collection="crew",
                person_ids=[tm_person.id],
                data={"name": tm_person.name, "role": "Tour Manager", "phone": tm_person.phone, "email": tm_person.email},
            ),
            GigItem(
                gig_id=g1.id,
                collection="contacts",
                person_ids=[promoter.id],
                data={"name": promoter.name, "role": "Promoter", "phone": promoter.phone, "email": promoter.email},
            ),
            GigItem(
                gig_id=g1.id,
                collection="rider",
                data={"category": "booth", "items": "3x CDJ-3000 + 1x DJM-A9 + 2x studio monitors", "fulfilled": True},
            ),
            GigItem(
                gig_id=g1.id,
                collection="rider",
                data={"category": "hospitality", "items": "Still water, ginger shots, fruit plate, 2 clean towels", "fulfilled": False},
            ),
            GigItem(
                gig_id=g1.id,
                collection="guests",
                data={"name": "Camille D.", "pass_type": "AAA", "status": "confirmed", "requested_by": "Kael"},
            ),
        ],
        batch_id="bat_tm_mcp_demo",
        actor=ActorContext(actor_id=tm_user.id, actor_name="Maya Chen", channel="mcp"),
    )

    repo.upsert_share_link(
        ShareLink(
            key="paris-rex-crew-demo",
            scope="gig_master",
            gig_id=g1.id,
            label="Paris Rex Club — Master Day Card",
            enabled=True,
        )
    )
    repo.upsert_share_link(
        ShareLink(
            key="artist-personal-demo",
            scope="person",
            person_id=artist.id,
            label="Kael — Personal Tour Card",
            enabled=True,
        )
    )

    g2 = repo.create_gig(
        Gig(
            id="gig_berlin_02",
            artist_id="art_kael",
            name="Kael — Berlin",
            date=d2,
            venue="Watergate",
            city="Berlin",
            country="Germany",
            timezone="Europe/Berlin",
            doors_time="23:00",
            set_time="01:30",
            set_end="03:30",
            set_day_offset=1,
            status=GigStatus.advancing,
            promoter="Watergate GmbH",
            fee=9200.0,
            currency="EUR",
            notes="Waiting on flight confirmation from Berlin promoter.",
        ),
        actor=actor,
    )
    repo.add_items(
        g2.id,
        [
            GigItem(
                gig_id=g2.id,
                collection="contacts",
                person_ids=[driver.id],
                data={"name": driver.name, "role": "Driver", "phone": driver.phone},
            ),
        ],
        actor=actor,
    )

    repo.create_gig(
        Gig(
            id="gig_mexico_03",
            artist_id="art_nova",
            name="Nova — Mexico City Showcase",
            date=d3,
            venue="Foro Indie Rocks",
            city="Mexico City",
            country="Mexico",
            timezone="America/Mexico_City",
            set_time="01:00",
            set_end="03:00",
            set_day_offset=1,
            status=GigStatus.hold,
            fee=12000.0,
            currency="USD",
        ),
        actor=actor,
    )

    repo.create_gig(
        Gig(
            id="gig_lyon_past",
            artist_id="art_kael",
            name="Kael — Lyon",
            date=d_past,
            venue="Le Sucre",
            city="Lyon",
            country="France",
            timezone="Europe/Paris",
            set_time="01:00",
            set_end="03:00",
            set_day_offset=1,
            status=GigStatus.played,
            fee=6500.0,
            currency="EUR",
        ),
        actor=actor,
    )

    return True
