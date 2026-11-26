# AGENTS.md — Tour Designer

Instructions for AI coding agents (Claude Code, Codex, Gemini CLI, Cursor, Antigravity) working in this repository.

## If the user wants to install Tour Designer

Most people arrive here with "install this for me". Follow [`INSTALL_PROMPT.md`](INSTALL_PROMPT.md) step by step:

1. Check the OS, Python 3.12+, Node 20+, and whether `docker` / `gcloud` exist.
2. Ask the 4 questions in `INSTALL_PROMPT.md` (team name, local vs Cloud Run, AI intake mode, owner password) **before** configuring anything.
3. Configure, build, start, verify `/api/health`, then walk the user through `/settings` (AI Intake → Refresh → Test AI; Team Access keys; PWA install).

The fastest path that always works (no accounts, SQLite, demo tour auto-seeded):

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8080
curl -sf http://127.0.0.1:8080/api/health   # {"ok":true,...}
```

A prebuilt frontend ships in `backend/static/v3`, so the backend runs without Node. Rebuild it only after frontend changes.

## Configuration facts (trust these over older docs)

- Config is read by `backend/app/config.py` from `.env` in the **working directory the server starts in** — normally `backend/.env`. Copy from the root `.env.example`.
- Owner login password is `BASIC_AUTH_PASSWORD` (user `BASIC_AUTH_USER`, default `owner`). Empty = open mode, only safe on `127.0.0.1`. Set it before binding `0.0.0.0` or deploying.
- Storage: `REPO_BACKEND=sqlite|firestore`, `FILE_STORAGE_BACKEND=local|gcs`. Firestore/GCS need `pip install -e ".[gcp]"`.
- AI intake: `VERTEX_PROJECT` + `VERTEX_LOCATION`, or `GEMINI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. All empty = offline deterministic parser (still works).
- `docker-compose.yml` does **not** load an `.env` file. To set a password or keys under Docker, add an `env_file:` entry or `environment:` keys, or use `docker run -e ...`.
- Subpath hosting: `BASE_PATH=/tourdesigner` + `PUBLIC_ORIGIN=https://example.com`.

## Secrets and safety

- Never commit `.env`, API keys, passwords, or SQLite/vault data (`backend/data/`). Never echo secret values back to the user or into logs.
- Ask before deploying to the user's cloud project, enabling GCP APIs, or anything that costs money.
- Vault files hold passports, visas and boarding passes: keep `FILE_STORAGE_BACKEND` private (local disk or a private GCS bucket).

## Layout

| Path | What |
| :--- | :--- |
| `backend/app/` | FastAPI app (`main.py`), config, repos (SQLite/Firestore), MCP server at `/mcp` |
| `backend/tests/` | pytest suite |
| `frontend/src/` | React 19 + Vite + Tailwind PWA (Dexie/IndexedDB offline mirror) |
| `backend/static/v3/` | Built frontend (Vite `outDir`) — generated, rebuild don't hand-edit |
| `docs/LLM_INTEGRATION.md` | IT integration: Cloud Run, calendar feeds, MCP, digests |

## Developing

```bash
# Backend
cd backend && .venv/bin/pytest -q && .venv/bin/ruff check app scripts tests

# Frontend (typecheck + build into backend/static/v3, then unit tests)
cd frontend && npm install && npm run build && npm test
npm run dev   # Vite dev server on 127.0.0.1:5173
```

- Run both test suites before calling a change done.
- Keep the app offline-first: data shown on the day sheet must still load from IndexedDB with no network.
- Role isolation is a hard rule: crew roles and `/link/<key>` share payloads must never include fees, settlements, contracts or private vault files. Add a test when touching serializers.
- UI strings are bilingual (EN/FR); add both.
- License is AGPL-3.0-only; see `CONTRIBUTING.md` before adding third-party code.
