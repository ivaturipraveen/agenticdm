# Agentic Healthcare Data Migration Platform

An AI-powered agentic platform that automates end-to-end healthcare data migration and system integration workflows, maintaining HIPAA-grade auditability and human-in-the-loop controls.

## Overview

Migrates synthetic healthcare data from a **PostgreSQL source** (members, eligibility, claims tables) to a **FHIR R4 target** using 5 autonomous agents.

## Architecture

```
PostgreSQL (Source) → Discovery Agent → Transformation Agent → Orchestration Agent → FHIR Endpoint
                                                                          ↑
                            QA / Reconciliation Agent ←─────────────────┘
                            Integration Monitor Agent (runs throughout)
```

### 5 Core Agents

| Agent | Role |
|-------|------|
| **Discovery Agent** | Scans source tables, infers FHIR resource types, generates field mapping with confidence scores |
| **Transformation Agent** | Converts rows to FHIR R4 resources — normalizes ICD-10, UUIDs, dates, handles nulls |
| **Orchestration Agent** | Sequences pipeline stages, enforces validation, manages approval gate, batch loads |
| **QA / Reconciliation Agent** | Post-load verification — row counts, checksums, business rule compliance |
| **Integration Monitor Agent** | Watches for schema drift throughout execution |

## Stack

| Layer | Technology |
|-------|-----------|
| Source DB | PostgreSQL (remote via Render) |
| Backend | FastAPI (Python 3.12) |
| Frontend | React + Vite + TypeScript + Tailwind CSS |
| FHIR Target | Configurable HAPI FHIR endpoint |
| Compliance | HIPAA, FHIR R4, CMS, HL7 validation |

## Features

- Dynamic schema-to-FHIR mapping (no hardcoded field assumptions)
- Real-time WebSocket pipeline visualization
- Human approval gate before FHIR load
- Per-record source → mapped JSON → FHIR R4 traceability
- Field-level PASS/FAIL validation
- Retry failed records
- Run history with per-agent step walkthrough
- FHIR Endpoint Registry with drill-down
- Schema drift detection and simulation
- Exportable compliance audit PDF

## Setup

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # fill in DATABASE_URL, FHIR_BASE_URL
uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev          # development
npm run build        # production build
npm run preview      # serve production build
```

### Environment Variables

```env
DATABASE_URL=postgresql+asyncpg://user:pass@host/db
SYNC_DATABASE_URL=postgresql://user:pass@host/db
FHIR_BASE_URL=http://localhost:8080/fhir
RUN_HOST=0.0.0.0
RUN_PORT=8000
```

## Demo Datasets

Pre-loaded synthetic datasets (no PHI):

| Dataset | Records | Description |
|---------|---------|-------------|
| synthea_standard | 650 | Balanced baseline |
| clean_cohort | 500 | Minimal issues |
| high_anomaly | 405 | Stress test with errors |
| edge_cases | 319 | Boundary conditions |
| medicare_sample | 640 | Production-style |
| medicaid_complex | 457 | Complex Medicaid |

## License

MIT
