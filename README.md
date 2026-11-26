# Tour Designer

**An offline-first, BeOS 2032 touring desk for artists, DJs, and tour managers — built for Google Workspace AI, running everywhere as a Web & Mobile PWA.**

Replace chaotic WhatsApp threads, fragile spreadsheets, and bloated touring SaaS with one razor-fast desk that works on **iOS, Android, macOS, Windows, and Linux** — offline on airplanes, readable at 4 AM, powered by your own **Google Workspace & Gemini AI**, with **zero mandatory SaaS subscriptions**.

---

## Install with AI in 2 Minutes

Don't want to configure servers by hand? **Copy & paste this prompt into Claude Code, Gemini CLI, Codex, Antigravity, or Cursor** and let your agent install and configure Tour Designer for you and your entire team:

```text
Clone Tour Designer (https://github.com/holasoyneto/tourdesigner), read docs/LLM_INTEGRATION.md, and install it for me and my touring team.
Check my OS (Linux, Windows, or macOS) and ask me 4 quick questions first:
1. Artist / Team name
2. Local self-hosted (SQLite) OR Google Cloud Run + Firestore + GCS on my Google Workspace / GCP project
3. Google AI Intake mode: Vertex AI (GCP project), Gemini API key, or offline local parser
4. Owner login password (if exposing to my team)

Then configure backend/.env from .env.example (never commit secrets), build frontend & backend, start or deploy the app, verify /api/health, and show me:
- My live URL + how my team installs it as a Mobile/Desktop PWA (iOS, Android, Windows, Linux, macOS)
- How to click "Refresh" in /settings -> AI Intake to pick Google's latest live Gemini model right now
- How to generate team login links and MCP keys for my tour manager and crew
```

> Full step-by-step agent prompt also available in [`INSTALL_PROMPT.md`](INSTALL_PROMPT.md).

---

## Cross-Platform by Design: Web + Mobile PWA (No Native macOS / Swift App)

We have **deprecated the native Swift / macOS desktop app** in favor of a single **Web + Mobile PWA** codebase:

- **Works everywhere:** iPhone, iPad, Android, Linux, Windows, macOS, and Chromebook — zero Apple Developer signing/notarization friction and zero OS lock-in.
- **Installs like a native app:**
  - **iPhone / iPad:** Safari → Share → **Add to Home Screen** (full-screen handheld BeOS 2032 cockpit with bottom hardware dock & safe-area bezels)
  - **Android:** Chrome → **Install App**
  - **Windows / Linux / macOS:** Chrome / Edge / Brave → **Install Tour Designer** from the address bar
- **True Airplane-Mode Offline:** IndexedDB (Dexie) local mirror keeps flights, PNRs, hotel confirmations, driver numbers, and notes accessible with zero signal, syncing deltas automatically when back online.

---

## Future-Proof Google Workspace AI Intake

Tour Designer is designed to plug directly into your **Google Workspace / Google Cloud** AI stack — and stay future-proof as Google ships new Gemini models:

- **Live Google Model Discovery in `/settings`:** Owners can click **↻ Refresh** at any time to query Google's live model catalog (`Vertex AI` or `Gemini API`) and switch models on the fly with **zero restarts or redeploys**.
- **Any Future Model ID Supported Day 0:** Type any newly released Google model ID directly into the active model field (e.g., future Gemini Flash/Pro generations) and verify it in 1 click with **Test AI**.
- **Works Offline Too:** If Google AI isn't configured or you're offline on a flight, AI Intake automatically falls back to a fast deterministic parser so pasting schedules, flights, hotels, and contacts never breaks.

---

## Highlights

- **Multi-Artist Road Manager & Crew Permissions** — Create separate agendas per artist/project with a Deskbar switcher, assign multi-project road managers or isolate artists, VJs, and crew to only their own project/flights, and flip any member between **Read-only** and **Editor** in 1 click from `/settings`.
- **Natural-Language Day Sheet (`N` to add anything)** — Type `18:30 soundcheck`, `taxi 14:15 cdg -> hotel #Alex`, `AF1181 LHR CDG`, or `check in 15:00 Hotel Amour` for live Tab-completion, route & airline auto-detection, 0ms optimistic insert, and instant `⌘Z` undo.
- **Full Spreadsheet Day Editing** — Double-click or press `Enter`/`F2` to edit inline, `Shift+Click` / `⌘A` multi-select, `⌘C` / `⌘V` TSV copy/paste, `⌘D` fill-down, clickable free-time/tight-connection gap rows, and rich structured editors for Flights (per-passenger seats & PNR), Transfers, Hotels, and Schedule.
- **Next-Gen Mobile Cockpit + Desktop Dossier** — Dedicated 390px handheld layout (top telemetry bezel, bottom hardware dock, boarding-pass date cards, mobile Rolodex) + 5-tab desktop right dossier (Crew & Guestlist, Documents, club-night Running Order, Rider checklists, Share Links).
- **Complete Tour Suite** —
  - **Tour Tracker (`/tour`)** with readiness warnings and inline autocomplete editing
  - **Calendar (`/calendar-view`)** with Month/Week views, 12-month density strip, and multi-day hotel bands
  - **Contacts Rolodex (`/rolodex`)** with permanent crew pinning, loyalty programs, visa/health notes, document expiry alerts, and atomic contact merging
  - **Documents Vault (`/files`)** with drag-and-drop upload, smart categories, batch ops, and full-viewport QuickLook preview
  - **Universal AI Paste (`✨`)** to extract flights, hotels, timetables, and contacts from raw promoter emails/WhatsApp/PDFs — including automatic multi-date CSV/spreadsheet tour import with 1-click batch undo
  - **A4 Printable Roadsheets (`/print`)** in three layouts: Day Sheet, Driver Card, and Owner Internal Pack
  - **Traveler Share Links (`/link/<key>`)** — zero-login mobile roadsheets scoped per date or per crew member
  - **Revocable ICS Calendar (`/api/calendar/<token>.ics`) & J-1 Digest** — subscribe in Apple/Google Calendar and trigger daily J-1 itinerary digests
- **Native MCP Server (`/mcp` & `/mcp/t/{token}`)** — Built-in Streamable-HTTP MCP server for Claude, Gemini, or mobile AI chat clients: upload boarding passes/QR codes via `upload_file` (up to 16 MB or public HTTPS `source_url`), render QR passes inline via `get_file`, and edit safely with stateless HMAC `read_token` optimistic locking.
- **Free Beta & Hosted Multi-Tenant Mode** — Includes a BeOS 2032 landing page (`/`), zero-signup read-only `/demo`, and per-tenant isolation.
- **Bilingual (`EN` / `FR`) & Adaptive Theme (`Auto` / `Night` / `Day`)** — English-first with instant French toggle via Settings or `⌘K` Omnibar.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `⌘K` / `Ctrl+K` or `/` | Open Omnibar (jump to any date, flight, PNR, contact, file, or action) |
| `N` | Focus `SmartQuickAdd` bar on the Day Sheet |
| `J` / `K` | Previous / Next tour date |
| `Enter` / `F2` | Edit focused cell inline |
| `⌘E` / `Ctrl+E` | Open full structured editor for selected row |
| `⇧Enter` | Add new schedule item at current time |
| `⌘C` / `⌘V` | Copy / paste spreadsheet rows (TSV) or raw itinerary text |
| `⌘D` | Fill down (`Where` or `Who`) across multi-selected rows |
| `⌘Z` / `⇧⌘Z` | Undo / Redo on the active date |

---

## Manual Quick Start (Linux, Windows & macOS)

```bash
# 1. Backend setup (Python 3.12+)
cd backend
python3 -m venv .venv
# macOS / Linux:
.venv/bin/pip install -e ".[dev]"
# Windows (PowerShell):
# .venv\Scripts\pip install -e ".[dev]"

# 2. Frontend build (Node 20+)
cd ../frontend
npm install
npm run build

# 3. Run locally (auto-seeds a realistic demo tour on first start)
cd ../backend
.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8080
```

Open **http://127.0.0.1:8080** — works out of the box with local SQLite and zero cloud accounts required.

---

## Self-Hosting & Google Cloud Run Deployment

Copy [`.env.example`](.env.example) to `backend/.env` to set your owner password (`BASIC_AUTH_PASSWORD`), artist name (`ARTIST_NAME`), Google Workspace AI (`VERTEX_PROJECT` or `GEMINI_API_KEY`), Firestore/GCS storage, or flight lookup API keys.

### Docker & Docker Compose (Any Linux / Windows / macOS Server)

```bash
# Quickest self-host (persists SQLite + vault in ./td_data volume)
docker compose up -d
```

Or build and run directly (defaults to `REPO_BACKEND=sqlite` and `FILE_STORAGE_BACKEND=local`):

```bash
docker build -t tour-designer .
docker run -p 8080:8080 \
  -v td_data:/app/data \
  -e BASIC_AUTH_PASSWORD=change-me \
  -e GEMINI_API_KEY=your-google-ai-key \
  tour-designer
```

### Stateless Google Cloud Run (Firestore + GCS + Vertex AI)

```bash
gcloud run deploy tour-designer \
  --region=europe-west1 \
  --source=. \
  --min-instances=0 \
  --set-env-vars="ENV=prod,REPO_BACKEND=firestore,FILE_STORAGE_BACKEND=gcs,VERTEX_PROJECT=YOUR_GCP_PROJECT,VERTEX_LOCATION=global"
```

---

## Testing & Verification

```bash
# Frontend typecheck, build & unit tests
cd frontend && npm run build && npm test

# Backend tests & linter
cd backend && .venv/bin/pytest -q && .venv/bin/ruff check app scripts tests
```

## License

Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0-only)](LICENSE).

Commercial, agency, and white-label licenses are available separately for organizations that wish to deploy or redistribute proprietary modifications without AGPL-3.0 copyleft obligations. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contributor licensing terms.
