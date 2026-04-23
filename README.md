# Brightcone Platform

A unified healthcare data platform combining two agentic workspaces:

| Workspace | Purpose |
|-----------|---------|
| **Agentic Data Migration** | AI agents that discover, transform, validate and load legacy healthcare data to FHIR R4 |
| **LA Care — CCDA Intelligence** | Ingests C-CDA XML, runs Claude NLP over narrative text, and recovers HEDIS quality-measure evidence that claims miss |

Both workspaces share a common login, a common Postgres database on Render,
and a common Claude API key.

## Repository layout

```
backend/
  .env                  # shared config (DB URLs, Claude key, FHIR URL)
  main.py               # FastAPI entry point — mounts both workspaces
  requirements.txt
  platform_db.py        # shared DB + pool + user/session tables
  platform_auth.py      # signup / login / session auth (DB-backed)
  agents/               # Agentic DM agent definitions
  audit_log.py          # Agentic DM compliance
  claude_mapper.py
  compliance.py
  dynamic_fhir_engine.py
  fhir_client.py
  fhir_store.py         # Agentic DM FHIR resource store
  pipeline_state.py
  run_store.py
  websocket_manager.py
  lacare/
    routes.py           # /api/lacare/* endpoints
    pipeline.py         # 6-agent CCDA pipeline (ingest → HEDIS rollup)
    ccda_parser.py
    hedis_engine.py
    nlp_extractor.py    # Claude Sonnet + heuristic fallback
    sample_data.py      # synthetic CCDA generator (for demo seeding)
    repository.py       # DB CRUD for runs, docs, hits, logs

frontend/src/
  App.tsx               # shell router: Login → AppSelector → workspace
  main.tsx
  index.css
  shell/                # login + signup + app selector + auth client
  agenticdm/            # all Agentic DM UI (moved from /agentic)
    AgenticApp.tsx
    components/, hooks/, store/, api/, types/
  lacare/               # LA Care UI
    LaCareApp.tsx, api.ts, tabs/...
```

## Database

Everything is persisted to the Render Postgres instance configured in
`backend/.env`. Tables live in two groups:

**Shared platform tables** (created on startup):
- `platform_users` — signup accounts with PBKDF2-hashed passwords
- `platform_sessions` — bearer-token sessions

**LA Care tables**:
- `lacare_runs` — one row per pipeline run
- `lacare_documents` — every CCDA document (raw XML + parsed JSON)
- `lacare_hits` — HEDIS evidence findings
- `lacare_agent_events` — live agent progress
- `lacare_logs` — pipeline log stream

**Agentic DM tables** (unchanged): `migration_runs`, `run_logs`,
`run_agent_outputs`, `fhir_loaded_resources`, `fhir_endpoint_calls`.

## Quick start

```bash
# 1. Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000

# 2. Frontend
cd ../frontend
npm install
npm run dev
```

On first boot the platform seeds a default admin:

```
username: admin
password: brightcone2026  (or $PLATFORM_ADMIN_PASSWORD if set)
```

Sign up from the login screen to create additional accounts.

## LA Care demo flow

1. Log in → pick **LA Care — CCDA Intelligence**.
2. **Seed demo batch** (100 synthetic C-CDAs) *or* upload your own `.xml`
   CCDA files on the *Documents* tab.
3. Click **Run Pipeline** — six agents stream live progress:
   `ingest → extraction → normalization → NLP → HEDIS → dashboard`.
4. Explore evidence by measure (FUM, FUA, CBP, HBD, MRP) on the
   *HEDIS Evidence* tab; drill into any patient / document.
5. *Before / After* shows the raw C-CDA XML vs. structured clinical data.

All data is stored in the database, so the dashboard survives page reloads
and multiple users see the same results.

## License


cd /Users/yanthraa/Desktop/OpenClaw/Agenticdm/agenticdm

rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r backend/requirements.txt





cd /Users/yanthraa/Desktop/OpenClaw/Agenticdm/agenticdm
source .venv/bin/activate
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend

cd /Users/yanthraa/Desktop/OpenClaw/Agenticdm/agenticdm
uvicorn main:app --reload --host 0.0.0.0 --port 8000 --app-dir backend


cd /Users/yanthraa/Desktop/OpenClaw/Agenticdm/agenticdm/frontend
npm install
npm run dev



username: admin
password: brightcone2026