# Tour Designer — LLM & IT Systems Integration Guide

This document is designed for AI coding agents (**Claude Code**, **OpenAI Codex**, **Cursor**, **Antigravity**) and touring IT engineers installing or integrating **Tour Designer** (`AGPL-3.0-only`) into a management company, agency, or artist team's infrastructure.

- **Repository:** https://github.com/holasoyneto/tourdesigner
- **License:** AGPL-3.0-only (self-hostable, zero vendor lock-in; commercial white-label licensing available)
- **Architecture:** FastAPI (Python 3.12) + React/Vite/Tailwind offline-first PWA (IndexedDB + Service Worker) + Streamable HTTP MCP server (`/mcp`)

---

## 1. 60-Second Self-Host (Docker Compose — SQLite + Local Vault)

Best for a single artist, tour manager, or small management team running on a Mac Mini, Linux VPS, Hetzner, DigitalOcean, or Tailscale node.

```bash
git clone https://github.com/holasoyneto/tourdesigner.git
cd tourdesigner
cp .env.example .env
# Edit .env: set OWNER_PASSWORD and SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build
# Verify health:
curl -sf http://localhost:8080/api/health
```

### Default Storage (Zero External Cloud Dependencies)
- `REPO_BACKEND=sqlite` -> persists database at `/app/data/tourdesigner.db` (mounted via Docker volume `./data:/app/data`)
- `FILE_STORAGE_BACKEND=local` -> persists encrypted/private passports, visas, boarding passes, and riders under `/app/data/files`
- **Backups:** Back up `/app/data` nightly (SQLite online backup or `sqlite3 /app/data/tourdesigner.db ".backup /backups/td.db"` + rsync `/app/data/files`).

### HTTPS Reverse Proxy (Caddy Example)
```caddyfile
tour.yourdomain.com {
    reverse_proxy 127.0.0.1:8080
}
```
If hosting under a subpath (e.g., `https://yourdomain.com/tourdesigner`), set `BASE_PATH=/tourdesigner` and `PUBLIC_ORIGIN=https://yourdomain.com` in `.env` — the backend automatically injects `<meta name="td-base">` and rewrites service worker & asset paths.

---

## 2. Stateless Cloud Deployment (GCP Cloud Run / Multi-Tenant / Roster)

For agencies or multi-artist rosters needing zero-ops autoscaling across regions:

- `TENANCY_MODE=multi` (or `single` for one dedicated team)
- `REPO_BACKEND=firestore` + `FIRESTORE_PROJECT=<gcp-project>`
- `FILE_STORAGE_BACKEND=gcs` + `GCS_BUCKET=<private-bucket>`
- `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` (add `<PUBLIC_ORIGIN><BASE_PATH>/api/auth/google/callback` to Authorized Redirect URIs)
- `SESSION_SECRET` stored in Secret Manager (used to sign cookies and stateless HMAC MCP `read_token`s across instances)

---

## 3. Integrating with Existing Team IT Systems

### A. Calendar Feeds (Google Calendar, Apple Calendar, Outlook)
- Tour Designer exposes revocable iCalendar feeds at:
  `GET /api/calendar/{token}.ics`
- Generate/rotate the token in **Settings → Integrations**. Subscribe from Google Calendar ("From URL"), Apple Calendar, or Outlook to mirror confirmed dates, call times, flights, and venues automatically.

### B. Importing Existing Schedules (Master Tour, Excel, Google Sheets, CSV)
- Use **Tools → Paste / AI Intake** (`POST /api/intake/extract`) to paste raw multi-date routing tables, CSVs, email confirmations, or Master Tour exports.
- Multi-date pastes auto-detect rows, show a preview diff, and batch-create gigs with 1-click undo.

### C. Email Digests & Webhooks (SMTP / Resend / Slack / n8n)
- **J-1 Crew Digest:** Wire Cloud Scheduler / cron to `POST /api/cron/gig-digest` (supports `?dry_run=1` for verification). Configure either:
  - `RESEND_API_KEY` + `ALERT_FROM_EMAIL`, or
  - `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_USER`, `SMTP_PASSWORD`, `ALERT_FROM_EMAIL`
- **Agency / Inquiry Routing:** Set `INTEREST_NOTIFY_EMAIL` (and optional `INTEREST_WEBHOOK_URL` for Slack/Discord/n8n) to receive public inquiries from `POST /api/public/interest`.

### D. Connecting Claude / ChatGPT / Custom AI Agents (MCP Server)
Tour Designer includes a built-in **Model Context Protocol (MCP)** endpoint at `<PUBLIC_ORIGIN><BASE_PATH>/mcp`:
- **Auth:** Create a scoped Bearer token in **Settings → AI / MCP** (prefer `Authorization: Bearer <token>` header; URL-key fallback supported for mobile clients that don't expose custom headers).
- **Safety & Concurrency:** All mutating MCP calls use stateless HMAC `read_token`s with compare-and-swap (`changed_since_read`) protection so an AI agent never silently overwrites a tour manager's manual edit.
- **Inline Boarding Passes & Vault Files:** `upload_file` supports up to 16 MB (base64 or SSRF-protected HTTPS `source_url`), and `get_file(include_content=true)` returns images (<= 2 MB) inline so QR boarding passes render directly in Claude/ChatGPT mobile chat.

---

## 4. Security, Privacy & Role Isolation

- **Owner (`owner`):** Full access to settlements, artist fees, contracts, passports, visas, and private vault files (`scope="private"`).
- **Crew (`crew`):** Operational schedule, flights, hotels, ground transport, tech riders, and `scope="crew"` files. Financial fees and private docs are stripped server-side.
- **Role-Scrubbed Share Links (`/link/<key>`):** Zero-login, offline-cached roadsheets for drivers, venue runners, and promoters. Settlements, contracts, and passports are never serialized into `/link/` payloads.
- **Offline-First PWA:** Every viewed tour mirrors into browser IndexedDB with an offline mutation outbox — engineered to load instantaneously at boarding gates and backstage bunkers with zero signal.

---

## 5. Key Environment Variables Reference

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `TENANCY_MODE` | `single` | `single` (one team) or `multi` (self-serve workspaces + landing page) |
| `REPO_BACKEND` | `sqlite` | `sqlite` (local file) or `firestore` (stateless GCP) |
| `FILE_STORAGE_BACKEND` | `local` | `local` (`/app/data/files`) or `gcs` (Google Cloud Storage) |
| `BASE_PATH` | `""` | Optional subpath prefix (e.g. `/tourdesigner`) |
| `PUBLIC_ORIGIN` | `""` | Canonical public URL (e.g. `https://tour.yourdomain.com`) |
| `OWNER_PASSWORD` | — | Initial owner password (single-tenant mode) |
| `SESSION_SECRET` | auto | 32+ byte secret for sessions & stateless MCP `read_token` HMAC |
| `GOOGLE_OAUTH_CLIENT_ID` | — | Optional Google Sign-In OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | Optional Google Sign-In OAuth client secret |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | — | Outbound SMTP for J-1 digests & inquiry alerts |
| `RESEND_API_KEY` | — | Alternative to SMTP via Resend HTTP API |
| `SHARE_FOOTER_BRANDING` | `false` | Show subtle non-print footer link on `/link/` sheets |

---

## 6. Verification Checklist for AI Agents After Install

1. `GET /api/health` returns `{"ok": true, ...}`
2. `GET /robots.txt` disallows `/link/`, `/api/`, `/mcp/`
3. `GET /llms.txt` returns `200 text/plain`
4. Create a test gig, add a flight + hotel, generate a `/link/<key>` driver share, and confirm the fee is omitted from the share payload
5. Toggle Airplane Mode / Offline in browser DevTools and reload to verify IndexedDB instant boot
