"""Integrations: city autocomplete, public tour diff, digest cron, flight lookup, and roadsheet export."""

from __future__ import annotations

import html
import os
import secrets
import smtplib
import subprocess
import time
import unicodedata
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response

from app.api.common import (
    current_user,
    err,
    get_app_settings,
    get_repo,
    ok,
    require_member,
    require_owner,
)
from app.config import get_settings
from app.domain.auth import AUTH_LIMITER, constant_time_equals, hash_secret, requester_ip
from app.domain.models import new_id, now_iso
from app.domain.roles import can_access_gig, is_owner

router = APIRouter(prefix="/api", tags=["integrations"])

# Curated global touring cities with IANA timezones
_TOURING_CITIES: list[tuple[str, str, str]] = [
    ("Paris", "France", "Europe/Paris"),
    ("Lyon", "France", "Europe/Paris"),
    ("Marseille", "France", "Europe/Paris"),
    ("Toulouse", "France", "Europe/Paris"),
    ("Bordeaux", "France", "Europe/Paris"),
    ("Lille", "France", "Europe/Paris"),
    ("Nantes", "France", "Europe/Paris"),
    ("Montpellier", "France", "Europe/Paris"),
    ("Nice", "France", "Europe/Paris"),
    ("Strasbourg", "France", "Europe/Paris"),
    ("London", "United Kingdom", "Europe/London"),
    ("Manchester", "United Kingdom", "Europe/London"),
    ("Bristol", "United Kingdom", "Europe/London"),
    ("Berlin", "Germany", "Europe/Berlin"),
    ("Munich", "Germany", "Europe/Berlin"),
    ("Hamburg", "Germany", "Europe/Berlin"),
    ("Frankfurt", "Germany", "Europe/Berlin"),
    ("Amsterdam", "Netherlands", "Europe/Amsterdam"),
    ("Rotterdam", "Netherlands", "Europe/Amsterdam"),
    ("Brussels", "Belgium", "Europe/Brussels"),
    ("Antwerp", "Belgium", "Europe/Brussels"),
    ("Zurich", "Switzerland", "Europe/Zurich"),
    ("Geneva", "Switzerland", "Europe/Zurich"),
    ("Lausanne", "Switzerland", "Europe/Zurich"),
    ("Madrid", "Spain", "Europe/Madrid"),
    ("Barcelona", "Spain", "Europe/Madrid"),
    ("Ibiza", "Spain", "Europe/Madrid"),
    ("Valencia", "Spain", "Europe/Madrid"),
    ("Lisbon", "Portugal", "Europe/Lisbon"),
    ("Porto", "Portugal", "Europe/Lisbon"),
    ("Milan", "Italy", "Europe/Rome"),
    ("Rome", "Italy", "Europe/Rome"),
    ("Vienna", "Austria", "Europe/Vienna"),
    ("Prague", "Czechia", "Europe/Prague"),
    ("Warsaw", "Poland", "Europe/Warsaw"),
    ("Budapest", "Hungary", "Europe/Budapest"),
    ("Athens", "Greece", "Europe/Athens"),
    ("Istanbul", "Turkey", "Europe/Istanbul"),
    ("Dubai", "UAE", "Asia/Dubai"),
    ("Tel Aviv", "Israel", "Asia/Jerusalem"),
    ("Mumbai", "India", "Asia/Kolkata"),
    ("Goa", "India", "Asia/Kolkata"),
    ("Bengaluru", "India", "Asia/Kolkata"),
    ("Bangkok", "Thailand", "Asia/Bangkok"),
    ("Tokyo", "Japan", "Asia/Tokyo"),
    ("Melbourne", "Australia", "Australia/Melbourne"),
    ("Sydney", "Australia", "Australia/Sydney"),
    ("Mexico City", "Mexico", "America/Mexico_City"),
    ("Guadalajara", "Mexico", "America/Mexico_City"),
    ("Monterrey", "Mexico", "America/Monterrey"),
    ("Chihuahua", "Mexico", "America/Chihuahua"),
    ("Tulum", "Mexico", "America/Cancun"),
    ("São Paulo", "Brazil", "America/Sao_Paulo"),
    ("Rio de Janeiro", "Brazil", "America/Sao_Paulo"),
    ("Belo Horizonte", "Brazil", "America/Sao_Paulo"),
    ("Curitiba", "Brazil", "America/Sao_Paulo"),
    ("Buenos Aires", "Argentina", "America/Argentina/Buenos_Aires"),
    ("Santiago", "Chile", "America/Santiago"),
    ("Bogotá", "Colombia", "America/Bogota"),
    ("Medellín", "Colombia", "America/Bogota"),
    ("New York", "United States", "America/New_York"),
    ("Miami", "United States", "America/New_York"),
    ("Los Angeles", "United States", "America/Los_Angeles"),
    ("Chicago", "United States", "America/Chicago"),
    ("Montreal", "Canada", "America/Toronto"),
    ("Toronto", "Canada", "America/Toronto"),
]


def _fold(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode("ascii").lower()


@router.get("/places/cities")
def search_cities(q: str = Query(default=""), limit: int = Query(default=12, ge=1, le=50)) -> JSONResponse:
    needle = _fold(q.strip())
    matches = [
        {"city": c, "country": co, "timezone": tz}
        for c, co, tz in _TOURING_CITIES
        if not needle or needle in _fold(c) or needle in _fold(co)
    ]
    return ok(cities=matches[:limit])


# ---- Public Site Bridge (optional PUBLIC_GIGS_URL) ----
@router.get("/public/booking-recipients")
def public_booking_recipients(request: Request) -> JSONResponse:
    settings = get_settings()
    token = request.headers.get("x-recipients-token") or request.query_params.get("token") or ""
    if settings.public_recipients_token and not constant_time_equals(token, settings.public_recipients_token):
        return err("forbidden", status=403)
    recipients = get_repo(request).get_setting("booking_recipients", [])
    return ok(recipients=recipients)


@router.post("/public/interest")
async def public_interest(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    """Rate-limited agency / pro / white-label interest form stored in root_repo + optional webhook."""
    ip = requester_ip(request)
    if AUTH_LIMITER.is_limited("public_interest", ip):
        return err("rate_limited", status=429)
    AUTH_LIMITER.record("public_interest", ip)

    email = str(body.get("email") or "").strip().lower()
    name = str(body.get("name") or "").strip()[:120]
    org = str(body.get("org") or body.get("agency") or "").strip()[:160]
    roster_size = str(body.get("roster_size") or "").strip()[:40]
    notes = str(body.get("notes") or "").strip()[:1000]
    if not email or "@" not in email or "." not in email.split("@", 1)[-1] or len(email) > 160:
        return err("invalid_email", status=400)

    root_repo = getattr(request.app.state, "repo", None) or get_repo(request)
    leads = root_repo.get_setting("public_interest_leads", [])
    if not isinstance(leads, list):
        leads = []
    entry = {
        "id": new_id("lead"),
        "email": email,
        "name": name,
        "org": org,
        "roster_size": roster_size,
        "notes": notes,
        "created_at": now_iso(),
    }
    leads.append(entry)
    root_repo.set_setting("public_interest_leads", leads[-500:])

    settings = get_app_settings(request)
    webhook = settings.interest_notify_webhook_url.strip()
    if webhook:
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                await client.post(
                    webhook,
                    json={
                        "event": "public_interest",
                        "lead": entry,
                        "text": f"[Tour Designer Lead] {name or email} ({org or 'Independent'}) · {roster_size or 'N/A'}",
                    },
                )
        except Exception:
            pass

    notify_to = settings.interest_notify_email.strip()
    if notify_to:
        subject = f"[Tour Designer Inquiry] {org or name or email} ({roster_size or 'N/A'})"
        body_text = (
            f"New inquiry from Tour Designer public page:\n\n"
            f"Name: {name or '—'}\n"
            f"Email: {email}\n"
            f"Agency / Management: {org or '—'}\n"
            f"Roster scale: {roster_size or '—'}\n"
            f"Notes:\n{notes or '—'}\n\n"
            f"Lead ID: {entry['id']} · Received: {entry['created_at']}\n"
        )
        resend_key = settings.resend_api_key.strip() or os.getenv("RESEND_API_KEY", "").strip()
        smtp_host = settings.smtp_host.strip() or os.getenv("SMTP_HOST", "").strip()
        smtp_user = settings.smtp_user.strip() or os.getenv("SMTP_USER", "").strip()
        smtp_pass = settings.smtp_password.strip() or os.getenv("SMTP_PASS", "").strip()
        smtp_port = settings.smtp_port or int(os.getenv("SMTP_PORT", "587"))
        from_addr = settings.alert_from_email.strip() or smtp_user or "Tour Designer <noreply@tourdesigner.app>"
        if resend_key:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    await client.post(
                        "https://api.resend.com/emails",
                        headers={"Authorization": f"Bearer {resend_key}"},
                        json={
                            "from": from_addr,
                            "to": [e.strip() for e in notify_to.split(",") if e.strip()],
                            "reply_to": email,
                            "subject": subject,
                            "text": body_text,
                        },
                    )
            except Exception:
                pass
        elif smtp_host:
            try:
                import anyio

                def _send_lead_smtp() -> None:
                    msg = EmailMessage()
                    msg["Subject"] = subject
                    msg["From"] = from_addr
                    msg["To"] = notify_to
                    msg["Reply-To"] = email
                    msg.set_content(body_text)
                    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as srv:
                        srv.starttls()
                        if smtp_user and smtp_pass:
                            srv.login(smtp_user, smtp_pass)
                        srv.send_message(msg)

                await anyio.to_thread.run_sync(_send_lead_smtp)
            except Exception:
                pass

    return ok(id=entry["id"], received=True)


@router.get("/tour-page-diff")
async def tour_page_diff(request: Request) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    settings = get_settings()
    public_dates: set[str] = set()
    if settings.public_gigs_url:
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(settings.public_gigs_url)
                if r.status_code == 200:
                    for g in r.json().get("gigs", []):
                        if g.get("date"):
                            public_dates.add(str(g["date"])[:10])
        except Exception:
            pass
    missing = [
        {"id": g.id, "date": g.date, "city": g.city, "venue": g.venue}
        for g in get_repo(request).list_gigs()
        if not g.archived and not g.tour_page_dismissed and g.date and g.date not in public_dates
    ]
    return ok(missing=missing, public_count=len(public_dates))


# ---- Revocable ICS Calendar Feed ----
def _ics_escape(val: str) -> str:
    return (
        val.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


@router.post("/calendar/token")
def rotate_calendar_token(request: Request) -> JSONResponse:
    denied = require_member(request)
    if isinstance(denied, JSONResponse):
        return denied
    cfg = get_app_settings(request)
    tenant_id = getattr(request.state, "tenant_id", None)
    raw = f"{tenant_id}.{secrets.token_urlsafe(24)}" if (cfg.tenancy_mode == "multi" and tenant_id) else secrets.token_urlsafe(24)
    repo = get_repo(request)
    repo.set_setting("calendar_feed_hash", hash_secret(raw))
    repo.set_setting("calendar_feed_created_at", now_iso())
    base = cfg.normalized_base_path
    return ok(token=raw, ics_path=f"{base}/api/calendar/{raw}.ics")


@router.delete("/calendar/token")
def revoke_calendar_token(request: Request) -> JSONResponse:
    denied = require_member(request)
    if isinstance(denied, JSONResponse):
        return denied
    repo = get_repo(request)
    repo.set_setting("calendar_feed_hash", "")
    return ok(revoked=True)


@router.get("/calendar/{token}.ics")
def calendar_ics_feed(token: str, request: Request) -> Response:
    cfg = get_app_settings(request)
    target_repo = getattr(request.app.state, "repo", None) or get_repo(request)
    if cfg.tenancy_mode == "multi" and "." in token:
        tid = token.split(".", 1)[0]
        tm = getattr(request.app.state, "tenant_manager", None)
        t_repo = tm.get_repo(tid) if tm is not None else None
        if t_repo is None:
            return err("calendar_not_found", status=404)
        target_repo = t_repo
    stored_hash = str(target_repo.get_setting("calendar_feed_hash", "") or "")
    if not stored_hash or not constant_time_equals(stored_hash, hash_secret(token)):
        return err("calendar_not_found", status=404)

    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Tour Designer//Roadsheet Calendar//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:Tour Designer",
    ]
    for gig in target_repo.list_gigs():
        if gig.archived or not gig.date or len(gig.date) < 10:
            continue
        try:
            dt = datetime.strptime(gig.date[:10], "%Y-%m-%d").date()
        except ValueError:
            continue
        dt_start = dt.strftime("%Y%m%d")
        dt_end = (dt + timedelta(days=1)).strftime("%Y%m%d")
        summary = f"{gig.city or gig.name or 'Show'}" + (f" — {gig.venue}" if gig.venue else "")
        location = ", ".join(p for p in (gig.venue, gig.city, gig.country) if p)
        desc = f"Status: {gig.status.value}" + (f" | Notes: {gig.notes}" if gig.notes else "")
        lines.extend([
            "BEGIN:VEVENT",
            f"UID:{gig.id}@tourdesigner",
            f"DTSTART;VALUE=DATE:{dt_start}",
            f"DTEND;VALUE=DATE:{dt_end}",
            f"SUMMARY:{_ics_escape(summary)}",
            f"LOCATION:{_ics_escape(location)}",
            f"DESCRIPTION:{_ics_escape(desc)}",
            "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return Response(content="\r\n".join(lines) + "\r\n", media_type="text/calendar; charset=utf-8")


# ---- Cloud Scheduler Cron Digest Endpoint ----
@router.post("/cron/gig-digest")
async def cron_gig_digest(
    request: Request,
    dry_run: bool = Query(default=False),
    target_date: str | None = Query(default=None),
) -> JSONResponse:
    settings = get_settings()
    user = current_user(request)
    if not is_owner(user):
        token = request.headers.get("x-cron-token", "")
        if not settings.digest_cron_token:
            return err("cron_disabled", status=403)
        if not constant_time_equals(token, settings.digest_cron_token):
            return err("forbidden", status=403)

    repo = get_repo(request)
    upcoming = [g for g in repo.list_gigs() if not g.archived]
    due_date = target_date or (datetime.now(timezone.utc) + timedelta(days=1)).strftime("%Y-%m-%d")
    due_gigs = [g for g in upcoming if (g.date or "")[:10] == due_date]
    previews: list[dict[str, Any]] = []
    for g in due_gigs:
        items = repo.list_items(g.id)
        flights = [it.data for it in items if it.collection == "flights"]
        hotels = [it.data for it in items if it.collection == "hotels"]
        previews.append({
            "gig_id": g.id,
            "date": g.date,
            "city": g.city,
            "venue": g.venue,
            "flights": len(flights),
            "hotels": len(hotels),
        })

    if dry_run or not due_gigs:
        return ok(checked=len(upcoming), due=len(due_gigs), sent=0, dry_run=dry_run, target_date=due_date, preview=previews)

    recipient = os.getenv("DIGEST_RECIPIENTS", "").strip() or settings.interest_notify_email.strip()
    resend_key = os.getenv("RESEND_API_KEY", "").strip()
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    subject = f"[Tour Designer] J-1 Itinerary Digest ({due_date})"
    body_text = "\n".join(
        f"- {p['date']} · {p['city']} ({p['venue'] or 'Venue TBD'}) — {p['flights']} flight(s), {p['hotels']} hotel(s)"
        for p in previews
    )

    sent = 0
    if recipient and resend_key:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                r = await client.post(
                    "https://api.resend.com/emails",
                    headers={"Authorization": f"Bearer {resend_key}"},
                    json={
                        "from": os.getenv("DIGEST_FROM_EMAIL", "Tour Designer <noreply@tourdesigner.app>"),
                        "to": [e.strip() for e in recipient.split(",") if e.strip()],
                        "subject": subject,
                        "text": body_text,
                    },
                )
                if r.status_code < 300:
                    sent = len(due_gigs)
        except Exception:
            pass
    elif recipient and smtp_host:
        try:
            msg = EmailMessage()
            msg["Subject"] = subject
            msg["From"] = os.getenv("DIGEST_FROM_EMAIL", "noreply@tourdesigner.app")
            msg["To"] = recipient
            msg.set_content(body_text)
            port = int(os.getenv("SMTP_PORT", "587"))
            with smtplib.SMTP(smtp_host, port, timeout=10) as srv:
                srv.starttls()
                smtp_user = os.getenv("SMTP_USER", "").strip()
                smtp_pass = os.getenv("SMTP_PASS", "").strip()
                if smtp_user and smtp_pass:
                    srv.login(smtp_user, smtp_pass)
                srv.send_message(msg)
            sent = len(due_gigs)
        except Exception:
            pass

    return ok(checked=len(upcoming), due=len(due_gigs), sent=sent, target_date=due_date, mode="sent" if sent else "unconfigured")


@router.get("/digest/status")
def digest_status(request: Request) -> JSONResponse:
    denied = require_owner(request)
    if isinstance(denied, JSONResponse):
        return denied
    gigs = [
        {"id": g.id, "date": g.date, "city": g.city, "venue": g.venue, "status": str(g.status.value)}
        for g in get_repo(request).list_gigs()
        if not g.archived
    ]
    return ok(gigs=gigs)


# ---- Flight Lookup (FlightAware AeroAPI when configured) ----
@router.get("/flights/lookup")
async def flight_lookup(request: Request, flight_no: str = Query(...), date: str | None = None) -> JSONResponse:
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    code = flight_no.replace(" ", "").upper()
    api_key = get_settings().flightaware_api_key
    if not api_key:
        return ok(candidates=[], provider="unconfigured", flight_no=code)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(
                f"https://aeroapi.flightaware.com/aeroapi/flights/{code}",
                headers={"x-apikey": api_key},
            )
            r.raise_for_status()
            flights = r.json().get("flights", [])[:5]
        candidates = [
            {
                "flight_no": code,
                "airline": f.get("operator_iata") or f.get("operator") or "",
                "dep_iata": (f.get("origin") or {}).get("code_iata"),
                "dep_city": (f.get("origin") or {}).get("city"),
                "dep_time": (f.get("scheduled_out") or "")[11:16] or None,
                "dep_tz": (f.get("origin") or {}).get("timezone"),
                "arr_iata": (f.get("destination") or {}).get("code_iata"),
                "arr_city": (f.get("destination") or {}).get("city"),
                "arr_time": (f.get("scheduled_in") or "")[11:16] or None,
                "arr_tz": (f.get("destination") or {}).get("timezone"),
                "terminal": f.get("terminal_origin"),
                "gate": f.get("gate_origin"),
                "status": f.get("status") or "on_time",
            }
            for f in flights
        ]
        return ok(candidates=candidates, provider="flightaware", flight_no=code)
    except Exception as exc:
        return ok(candidates=[], provider="flightaware_error", detail=str(exc), flight_no=code)


# ---- Clean Printable Roadsheet HTML (and optional WeasyPrint PDF) ----
def _render_roadsheet_html(gig, items) -> str:
    esc = html.escape
    by_col: dict[str, list[Any]] = {}
    for it in items:
        by_col.setdefault(it.collection, []).append(it)

    sections = []
    for title, col in (
        ("Flights", "flights"),
        ("Transport", "transport"),
        ("Hotels", "hotels"),
        ("Schedule", "schedule"),
        ("Timetable", "timetable"),
        ("Crew & Contacts", "contacts"),
        ("Rider", "rider"),
    ):
        rows = by_col.get(col, [])
        if not rows:
            continue
        lis = "".join(
            f"<li>{esc(' · '.join(f'{k}: {v}' for k, v in r.data.items() if v not in (None, '', [], {})))}</li>"
            for r in rows
        )
        sections.append(f"<section><h2>{title}</h2><ul>{lis}</ul></section>")

    return (
        "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
        f"<title>{esc(gig.date)} — {esc(gig.city)} · {esc(gig.venue)}</title>"
        "<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:24px auto;color:#141518;line-height:1.45}"
        "h1{margin:0 0 4px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;border-bottom:1px solid #ddd;padding-bottom:4px;margin-top:20px}"
        "ul{padding-left:18px}li{margin:4px 0}@media print{body{margin:0}}</style></head><body>"
        f"<h1>{esc(gig.city)} — {esc(gig.venue)}</h1>"
        f"<p><strong>{esc(gig.date)}</strong> · Set {esc(gig.set_time)}"
        f"{('–' + esc(gig.set_end)) if gig.set_end else ''} · {esc(gig.country)}</p>"
        f"{''.join(sections)}"
        f"{('<section><h2>Notes</h2><p>' + esc(gig.notes) + '</p></section>') if gig.notes else ''}"
        "</body></html>"
    )


@router.get("/gigs/{gig_id}/roadsheet.html")
def roadsheet_html(gig_id: str, request: Request):
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = repo.get_gig(gig_id)
    if not gig or not can_access_gig(member, gig):
        return err("gig_not_found", status=404)
    return HTMLResponse(_render_roadsheet_html(gig, repo.list_items(gig_id)))


@router.get("/gigs/{gig_id}/digest/roadsheet.pdf")
def roadsheet_pdf(gig_id: str, request: Request):
    member = require_member(request)
    if isinstance(member, JSONResponse):
        return member
    repo = get_repo(request)
    gig = repo.get_gig(gig_id)
    if not gig or not can_access_gig(member, gig):
        return err("gig_not_found", status=404)
    html_doc = _render_roadsheet_html(gig, repo.list_items(gig_id))
    try:
        from weasyprint import HTML  # optional heavy dep installed in prod Docker image

        pdf_bytes = HTML(string=html_doc).write_pdf()
        return Response(content=pdf_bytes, media_type="application/pdf")
    except ImportError:
        return HTMLResponse(html_doc, headers={"X-PDF-Fallback": "html"})


# ── Self-hosted GitHub Update Checker (non-blocking, 6h cache, offline-safe) ──
_UPDATE_CACHE: dict[str, Any] = {"checked_at": 0.0, "repo": "", "latest": None}
_UPDATE_CACHE_TTL_SECONDS = 6 * 3600
_LOCAL_SHA_CACHE: str | None = None


def _resolve_local_sha(build_sha: str) -> str:
    """Resolve current running commit SHA (short 7-char) from env BUILD_SHA or local git."""
    cleaned = (build_sha or "").strip()
    if cleaned:
        return cleaned[:7].lower()
    global _LOCAL_SHA_CACHE
    if _LOCAL_SHA_CACHE is not None:
        return _LOCAL_SHA_CACHE
    try:
        repo_root = Path(__file__).resolve().parents[3]
        res = subprocess.run(
            ["git", "rev-parse", "--short=7", "HEAD"],
            cwd=str(repo_root),
            capture_output=True,
            text=True,
            timeout=1.5,
            check=False,
        )
        sha = (res.stdout or "").strip().lower()[:7]
        _LOCAL_SHA_CACHE = sha
        return sha
    except Exception:
        _LOCAL_SHA_CACHE = ""
        return ""


@router.get("/system/update-check")
def check_github_update(request: Request, force: bool = Query(default=False)):
    """Check GitHub main branch for newer commits (for self-hosted/local installs)."""
    owner = require_owner(request)
    if isinstance(owner, JSONResponse):
        return owner

    cfg = get_settings()
    repo = (cfg.update_check_repo or "holasoyneto/tourdesigner").strip()
    local_sha = _resolve_local_sha(cfg.build_sha)
    update_cmd = "git pull origin main && docker compose up -d --build"
    commits_url = f"https://github.com/{repo}/commits/main"

    if not cfg.update_check_enabled:
        return ok(
            enabled=False,
            repo=repo,
            current_sha=local_sha,
            latest_sha="",
            latest_message="",
            latest_date="",
            update_available=False,
            compare_url=commits_url,
            update_command=update_cmd,
            offline=False,
        )

    now_ts = time.monotonic()
    cached = (
        _UPDATE_CACHE.get("latest")
        if not force
        and _UPDATE_CACHE.get("repo") == repo
        and (now_ts - float(_UPDATE_CACHE.get("checked_at", 0.0))) < _UPDATE_CACHE_TTL_SECONDS
        else None
    )

    latest = cached
    offline = False
    if latest is None:
        try:
            resp = httpx.get(
                f"https://api.github.com/repos/{repo}/commits/main",
                headers={
                    "Accept": "application/vnd.github+json",
                    "User-Agent": "tour-designer-update-check",
                },
                timeout=3.0,
            )
            if resp.status_code == 200:
                payload = resp.json()
                full_sha = str(payload.get("sha") or "").strip().lower()
                commit_obj = payload.get("commit") or {}
                raw_msg = str(commit_obj.get("message") or "").strip()
                first_line = raw_msg.splitlines()[0].strip() if raw_msg else ""
                date_str = str(
                    (commit_obj.get("committer") or {}).get("date")
                    or (commit_obj.get("author") or {}).get("date")
                    or ""
                )
                latest = {
                    "full_sha": full_sha,
                    "short_sha": full_sha[:7],
                    "message": first_line,
                    "date": date_str,
                }
                _UPDATE_CACHE["checked_at"] = now_ts
                _UPDATE_CACHE["repo"] = repo
                _UPDATE_CACHE["latest"] = latest
            else:
                offline = True
        except Exception:
            offline = True

    if not latest:
        return ok(
            enabled=True,
            repo=repo,
            current_sha=local_sha,
            latest_sha="",
            latest_message="",
            latest_date="",
            update_available=False,
            compare_url=commits_url,
            update_command=update_cmd,
            offline=offline,
        )

    latest_full = str(latest.get("full_sha") or "")
    latest_short = str(latest.get("short_sha") or "")
    update_available = bool(
        local_sha and latest_full and not latest_full.startswith(local_sha.lower())
    )
    compare_url = (
        f"https://github.com/{repo}/compare/{local_sha}...{latest_short}"
        if (local_sha and latest_short and update_available)
        else commits_url
    )

    return ok(
        enabled=True,
        repo=repo,
        current_sha=local_sha,
        latest_sha=latest_short,
        latest_message=str(latest.get("message") or ""),
        latest_date=str(latest.get("date") or ""),
        update_available=update_available,
        compare_url=compare_url,
        update_command=update_cmd,
        offline=False,
    )
