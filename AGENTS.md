# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## Project: Brightcone Migration Platform

Agentic Healthcare Data Migration & System Integration demo platform.

### Purpose
AI-powered demo that automates end-to-end data migration across healthcare systems with HIPAA-grade auditability and human-in-the-loop controls.

### 5 Core Agents
1. **Discovery Agent** — Scans PostgreSQL source tables, dynamically infers FHIR resource mappings, generates mapping contract with confidence scores
2. **Transformation Agent** — Applies ICD-10 normalization, UUID reformatting, date standardization, null handling; quarantines anomalies
3. **Orchestration Agent** — Controls pipeline sequence (Extract → Transform → Validate → Load → Reconcile), manages retries, approval gate, audit logging
4. **QA / Reconciliation Agent** — Post-load validation: row counts, checksums, business rule checks, source vs target comparison
5. **Integration Monitor Agent** — Watches for schema drift every 30s; halts pipeline on structural change

### Data Flow
Synthea Synthetic Data → PostgreSQL (members / eligibility / claims) → Discovery Agent → Transformation Agent → Orchestration Agent → FHIR Target + Local FHIR Store → QA Agent

### Stack
- **Source DB:** PostgreSQL (Render remote) — tables: members, eligibility, claims
- **Agent Backend:** FastAPI (Python), port 8000
- **Frontend:** React/Vite (TypeScript), port 3000
- **FHIR Storage:** Local persisted table `fhir_loaded_resources` in Postgres
- **External FHIR Target:** Configurable via FHIR_BASE_URL env var

### Demo Requirements (Must Have)
- All 5 agents visibly triggered and narrated in UI
- Synthetic/source data displayed before run
- Human approval gate modal before FHIR load
- Post-run: source vs transformed tables viewable
- FHIR resources stored and viewable in FHIR Data tab
- Run history with per-agent step walkthrough

### Demo Requirements (Nice to Have)
- Live schema drift trigger mid-demo (Mock Controls tab)
- Side-by-side source vs FHIR reconciliation
- Exportable audit PDF
- Target endpoint verification

### Key Files
- `backend/main.py` — FastAPI app with all endpoints
- `backend/dynamic_fhir_engine.py` — Dynamic schema-to-FHIR mapping (no hardcoding)
- `backend/agents/discovery_agent.py` — Agent 1
- `backend/agents/transformation_agent.py` — Agent 2
- `backend/agents/orchestration_agent.py` — Agent 3
- `backend/agents/qa_agent.py` — Agent 4
- `backend/agents/monitor_agent.py` — Agent 5
- `backend/fhir_store.py` — Local FHIR resource persistence
- `backend/compliance.py` — HIPAA/FHIR/CMS compliance scoring
- `frontend/src/components/MigrationView.tsx` — Live run agent panels
- `frontend/src/components/PreMigrationView.tsx` — Dataset selection and start
- `frontend/src/components/FhirDataPage.tsx` — FHIR resource viewer
- `frontend/src/components/RunHistory.tsx` — Run history list
- `frontend/src/components/RunDetail.tsx` — Per-run step walkthrough

### Services
- `sudo systemctl restart brightcone-backend` — port 8000
- `sudo systemctl restart brightcone-frontend` — port 3000
- Live: http://44.200.105.222:3000 / http://44.200.105.222:8000

### UI Design
- Fully white/light theme throughout
- Consistent card/border system using slate-200 borders and white backgrounds
- No dark panels in any page
- All 5 agents clearly identified with agent number and role

## First Run

If `BOOTSTRAP.md` exists, that's your birth certificate. Follow it, figure out who you are, then delete it.

## Session Startup

Before doing anything else:
1. Read `SOUL.md`
2. Read `USER.md`
3. Read `memory/YYYY-MM-DD.md`

## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md`
- **Long-term:** `MEMORY.md`

## Red Lines

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm`
