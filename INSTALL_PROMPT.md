# Tour Designer — One-Prompt AI Installer

Copy everything inside the prompt box below and paste it into **Claude Code**, **Gemini CLI**, **Codex**, **Antigravity**, or **Cursor**. Your coding agent will set up Tour Designer for you and your entire touring team on **macOS, Linux, or Windows** — locally or deployed to your **Google Workspace / Google Cloud** project.

---

```text
Install and set up Tour Designer for me and my touring team from this repository (or clone it first if not already in the repo directory).

Follow these steps cleanly and interactively:

1. Check my environment (OS: macOS / Linux / Windows, Python 3.12+, Node 20+, and whether `gcloud` or `docker` is installed).
2. Ask me 4 quick questions before configuring anything:
   - What is our Artist / Team name? (sets ARTIST_NAME and OWNER_NAME)
   - Where should we run Tour Designer?
     a) Local / self-hosted machine right now (zero-config SQLite, works on Linux, Windows, macOS)
     b) Google Cloud Run + Firestore + Cloud Storage on my Google Workspace / GCP project (recommended for teams — Always-Free tier friendly, zero monthly SaaS fees)
   - How should we connect Google AI Intake?
     a) Google Workspace / GCP Vertex AI (project ID + region, e.g. global or europe-west1)
     b) Google AI Studio / Gemini API key (GEMINI_API_KEY)
     c) Offline local parser only for now (we can connect Google AI later in /settings)
   - What owner login password should we set? (leave blank only if running strictly on local loopback)
3. Create `backend/.env` from `.env.example` using my answers (NEVER commit `.env` or print raw secrets back into git).
4. Build the frontend (`cd frontend && npm install && npm run build`) and install the backend (`cd backend && python -m venv .venv` + install `.[gcp]` if deploying to GCP or `.` for local SQLite).
5. Start or deploy the app:
   - Local: launch `uvicorn app.main:app --host 0.0.0.0 --port 8080` and verify `/api/health`.
   - Google Cloud Run: enable Cloud Run, Firestore, Cloud Storage, and Vertex AI APIs on my GCP project, create the Firestore database and GCS vault bucket if needed, deploy stateless Cloud Run (`--min-instances=0`, `ENV=prod`, `REPO_BACKEND=firestore`, `FILE_STORAGE_BACKEND=gcs`), and verify `/api/health`.
6. Walk me through finishing team setup in 30 seconds:
   - Open `<APP_URL>/settings` as Owner.
   - In **AI Intake · Google Workspace & Gemini**, click **Refresh** to pull Google's latest available Gemini models right now, pick my preferred model (or type any future model ID), and click **Test AI**.
   - In **Team Access**, create Editor/Viewer keys for my tour manager, artist, and crew (and optional MCP URLs for their AI assistants).
   - Tell my team how to install Tour Designer as an offline-first app with zero app-store or signing friction:
     - iPhone / iPad (Safari): Share → Add to Home Screen
     - Android (Chrome): Menu → Install app
     - macOS / Windows / Linux (Chrome / Edge / Brave): Address bar → Install Tour Designer
```
