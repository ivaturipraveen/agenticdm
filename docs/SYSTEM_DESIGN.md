# Agentic Healthcare Data Migration — System Design Document

**Version:** 1.0  
**Repository:** https://github.com/ivaturipraveen/agenticdm

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [End-to-End Pipeline Flow](#2-end-to-end-pipeline-flow)
3. [Agent 1 — Discovery Agent](#3-agent-1--discovery-agent)
4. [Agent 2 — Transformation Agent](#4-agent-2--transformation-agent)
5. [Agent 3 — Orchestration Agent](#5-agent-3--orchestration-agent)
6. [Agent 4 — QA / Reconciliation Agent](#6-agent-4--qa--reconciliation-agent)
7. [Agent 5 — Integration Monitor Agent](#7-agent-5--integration-monitor-agent)
8. [Dynamic Mapping Engine (Core)](#8-dynamic-mapping-engine-core)
9. [Hardcoded vs. Dynamic Logic — Full Audit](#9-hardcoded-vs-dynamic-logic--full-audit)
10. [New Dataset Compatibility](#10-new-dataset-compatibility)
11. [Duplicate Logic Identification](#11-duplicate-logic-identification)
12. [Data Flow Diagram](#12-data-flow-diagram)

---

## 1. System Overview

This platform migrates healthcare data from a **legacy PostgreSQL relational database** into a **FHIR R4-compliant target system** using five autonomous agents. Each agent has a clearly defined responsibility and hands off to the next via a shared pipeline state object. The entire flow is observable in real-time through a WebSocket-connected React dashboard.

**Key design goal:** No hardcoded column names or table assumptions. The system infers everything from the actual schema at runtime using a scoring-based mapping engine.

---

## 2. End-to-End Pipeline Flow

```
PostgreSQL Source
       │
       ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 1: EXTRACT                                               │
│  Discovery Agent reads all public tables (except system tables) │
│  Scores every column against FHIR field patterns                │
│  Infers: which table → which FHIR resource                      │
│  Output: Mapping Contract (stored in pipeline_state)            │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 2: TRANSFORM                                             │
│  Transformation Agent reads the Mapping Contract                │
│  For each source row, applies field mappings and produces       │
│  a valid FHIR R4 resource (Patient, Coverage, or Claim)         │
│  Anomalies are quarantined; review items flagged                │
│  Output: List of FHIR-ready resource objects                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 3: VALIDATE                                              │
│  Orchestration Agent validates FHIR structure                   │
│  Waits for any human review decisions (uncertain mappings)      │
│  Output: Validated resource set                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 4: AWAITING APPROVAL (Human Gate)                        │
│  Pipeline pauses                                                │
│  Operator reviews: record count, anomaly count, success rate    │
│  Operator clicks Approve (or Halt)                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 5: LOAD                                                  │
│  Orchestration Agent sends FHIR resources to target endpoint    │
│  Batches of 100 resources per request                           │
│  Each resource + source row stored in fhir_loaded_resources     │
│  Output: Loaded resource counts                                 │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│  STAGE 6: RECONCILE                                             │
│  QA Agent compares source counts vs loaded counts               │
│  Runs checksums on key fields (normalized for type differences) │
│  Business rule violations counted                               │
│  Compliance score calculated (HIPAA, FHIR R4, CMS, HL7)        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
                        COMPLETE / HALTED

Throughout all stages:
Integration Monitor Agent checks for schema changes every 30 seconds.
If source schema changes → pipeline halted immediately.
```

---

## 3. Agent 1 — Discovery Agent

**File:** `backend/agents/discovery_agent.py`  
**Core engine:** `backend/dynamic_fhir_engine.py`

### Responsibility

Discover every source table, understand its structure, and generate a **Mapping Contract** that tells all downstream agents exactly which source column maps to which FHIR field — with a confidence score per mapping.

### How it reads PostgreSQL tables

```python
# Step 1: Find all source tables dynamically (no hardcoded table names)
SELECT table_name FROM information_schema.tables
WHERE table_schema='public' AND table_type='BASE TABLE'
AND table_name NOT IN ('migration_runs', 'run_logs', 
                        'run_agent_outputs', 'fhir_loaded_resources')
```

The exclusion list contains only internal system tables, never source data tables. **Any business table present in the database will be discovered and processed.**

For each discovered table:

```python
# Step 2: Read column metadata
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = '<table>' AND table_schema = 'public'

# Step 3: Read sample rows (5 rows) to detect value patterns
SELECT * FROM "<table>" WHERE dataset_id = '<id>' LIMIT 5
```

### How column names are processed

Discovery uses a **3-signal scoring system** per column:

#### Signal 1: Name similarity (weight 70%)

Each column name is compared against alias lists in the `FHIR_RESOURCE_CATALOG`. The comparison uses `difflib.SequenceMatcher` (character sequence similarity) plus exact substring matching:

```python
# Both "member_id" and "mbr_id" and "patient_id" will match Patient.id
# because they are in the alias list or semantically similar
aliases = ["id", "member_id", "patient_id", "person_id"]
```

Example aliases for some key FHIR fields:

| FHIR Field | Accepted Column Names |
|---|---|
| `Patient.id` | `member_id`, `patient_id`, `id`, `person_id` |
| `Patient.name.given` | `first_name`, `given_name`, `fname`, `forename` |
| `Patient.birthDate` | `dob`, `date_of_birth`, `birth_date` |
| `Claim.diagnosis.code` | `icd10_primary`, `diagnosis_code`, `dx_code` |
| `Claim.total.value` | `claim_amount`, `billed_amount`, `amount`, `total_amount` |
| `Coverage.period.start` | `effective_date`, `start_date`, `coverage_start` |

#### Signal 2: Data type compatibility (weight 15%)

```python
# date/timestamp column → scored higher for Patient.birthDate
# numeric column → scored higher for Claim.total.value
# text column → scored for name fields
```

#### Signal 3: Value pattern analysis (weight 15%)

The 5 sample values are analysed with regex patterns:

```python
patterns = {
    "date":    # YYYY-MM-DD pattern
    "icd10":   # letter + 2 digits + optional decimal
    "npi":     # exactly 10 digits
    "uuid":    # UUID v4 format
    "phone":   # phone number pattern
    "email":   # email pattern
    "gender":  # M/F/MALE/FEMALE/OTHER/UNKNOWN
    "numeric": # parseable as float
}
```

For example: if a column contains values like `"2024-07-07"`, the date pattern score is `1.0`, which boosts the score for FHIR date fields.

#### Final confidence score and decision

```
confidence = (name_score × 0.70) + (type_score × 0.15) + (pattern_score × 0.15)
```

| Confidence | Decision |
|---|---|
| ≥ 85% | **Auto-mapped** — used without operator input |
| 55–84% | **Needs review** — flagged for human confirmation |
| < 55% | **Ignored** — not included in FHIR output |

System metadata columns (`created_at`, `updated_at`, `dataset_id`) are always ignored regardless of score.

### How tables are assigned to FHIR resources

The table name is scored against resource "hints":

```python
"Patient":   hints = ["member", "patient", "person", "demographic", ...]
"Coverage":  hints = ["eligibility", "coverage", "insurance", "plan", ...]
"Claim":     hints = ["claim", "billing", "encounter", "diagnosis", ...]
```

Additionally, the column patterns of the table contribute to the resource score. A table with columns that look like diagnosis codes, NPI numbers and claim amounts will score high for `Claim` even if the table is named differently.

### Output: Mapping Contract

The Discovery Agent stores the following in `pipeline_state.schema_mapping`:

```json
{
  "mapping_summary": [
    {
      "table": "claims",
      "resource": "Claim",
      "resource_confidence": 0.99,
      "resource_reasoning": ["table name resembles claim", "11 columns match Claim semantics"],
      "fields": [
        {
          "source_column": "icd10_primary",
          "target_field": "Claim.diagnosis[0].diagnosisCodeableConcept.coding[0].code",
          "confidence": 0.90,
          "status": "auto_mapped",
          "reason": "name matched aliases: icd10_primary; datatype compatible",
          "sample_values": ["F321", "M54.5", "I10"]
        }
      ],
      "row_count": 250
    }
  ],
  "requires_review": [...],
  "unmapped_fields": [...]
}
```

---

## 4. Agent 2 — Transformation Agent

**File:** `backend/agents/transformation_agent.py`  
**Core engine:** `backend/dynamic_fhir_engine.py` → `build_fhir_resource()`

### Responsibility

Take the Mapping Contract from Agent 1 and convert every source row into a valid FHIR R4 resource. Apply value transformations, quarantine bad records, flag uncertain mappings for review.

### How the transformation works

For each source row and each `auto_mapped` field in the contract:

```python
# 1. Read the source value
source_value = row.get(source_column)

# 2. Apply value transformation
transformed_value = classify_value(column_name, source_value)

# 3. Apply special transformations based on target FHIR field
if target == "Patient.id":
    # Convert any ID to UUID format
    transformed_value = ensure_resource_id(source_value)

if target == "Coverage.beneficiary.reference":
    # Prefix with resource type
    transformed_value = f"Patient/{ensure_resource_id(source_value)}"

if target == "Claim.patient.reference":
    transformed_value = f"Patient/{ensure_resource_id(source_value)}"

if target contains "diagnosis" and "code":
    # Normalize ICD-10 format: F321 → F32.1
    if len(code) >= 4 and '.' not in code:
        transformed_value = f"{code[:3]}.{code[3:]}"

# 4. Set the value at the FHIR path
set_fhir_path(resource, fhir_path, transformed_value)
```

### Value transformations applied

| Source Type | Transformation |
|---|---|
| Date / Timestamp | Normalized to `YYYY-MM-DD` |
| Decimal / Float | Converted to Python `float` for FHIR numeric fields |
| Gender codes | `M` → `male`, `F` → `female`, other → `unknown` |
| Member ID | Converted to UUID v5 if not already UUID format |
| Provider NPI | Prefixed as `Practitioner/{npi}` |
| ICD-10 codes | Dot inserted if missing: `F321` → `F32.1` |
| Email | Lowercased |

### FHIR path writing

The FHIR path string (e.g. `name[0].given[0]`) is parsed and applied to the resource dict:

```python
# "name[0].given[0]" → resource["name"][0]["given"][0]
# "diagnosis[0].diagnosisCodeableConcept.coding[0].code"
#   → resource["diagnosis"][0]["diagnosisCodeableConcept"]["coding"][0]["code"]
```

Special handling for `telecom[phone].value` and `telecom[email].value` which build a FHIR `telecom` array.

### Validation

After building the resource, it is validated:

```python
# Patient:  requires id, name (family or given), valid birthDate format
# Coverage: requires beneficiary.reference, status
# Claim:    requires patient.reference, diagnosis array, valid total.value
```

Failed records are **quarantined** — written to `anomalies.jsonl` and excluded from the load. A detailed error is stored per record.

### Full processing per table

```python
for table in mapping_summary:
    for batch in batches_of_100(source_rows[table]):
        for row in batch:
            fhir_resource = build_fhir_resource(resource_type, row, auto_mapped_fields)
            errors = validate_fhir_resource(fhir_resource)
            if errors:
                quarantine(row, errors)   # excluded from FHIR load
            else:
                transformed.append(fhir_resource)
```

---

## 5. Agent 3 — Orchestration Agent

**File:** `backend/agents/orchestration_agent.py`

### Responsibility

The pipeline controller. Sequences all stages, manages retries, handles the human approval gate, and drives the load to the FHIR endpoint.

### Stage sequencing

```
EXTRACT → TRANSFORM → VALIDATE → AWAITING_APPROVAL → LOAD → RECONCILE → COMPLETE
```

The orchestration agent:
1. Calls the Discovery Agent and Transformation Agent
2. After transform, sets the pipeline to `AWAITING_APPROVAL` and broadcasts to the UI
3. Waits on `pipeline_state.approval_event` (asyncio.Event)
4. After approval, POSTs FHIR bundles to the configured endpoint in batches of 100
5. Saves each loaded resource to `fhir_loaded_resources` with the source row attached
6. Calls the QA Agent for post-load verification
7. Saves all agent outputs to `run_agent_outputs` for history

### Retry logic

Up to 3 retries with exponential backoff (1s, 2s, 4s) for:
- Source data fetch failures
- FHIR POST failures

### FHIR batch loading

```python
BATCH_SIZE = 100

for resource_type, resources in [("Patient", patients), ("Coverage", coverages), ("Claim", claims)]:
    for i in range(0, len(resources), BATCH_SIZE):
        batch = resources[i:i+BATCH_SIZE]
        result = await fhir_client.post_bundle(batch, resource_type)
        save_resources(run_id, dataset_id, resource_type, batch,
                       source_rows=source_batch,
                       fhir_endpoint=settings.FHIR_BASE_URL)
```

---

## 6. Agent 4 — QA / Reconciliation Agent

**File:** `backend/agents/qa_agent.py`

### Responsibility

After load completes, verify that what was in the source made it through correctly to the FHIR target.

### What it checks

#### Count verification
```
source_count = len(members) + len(eligibility) + len(claims)
target_count = total records loaded to FHIR
match_pct = min(source_count, target_count) / source_count × 100
```

#### Field checksums (type-aware)

The QA agent normalizes values before computing checksums to avoid false failures caused by type conversions:

```python
def _norm(v):
    # Numbers: "2108.58" == 2108.58
    try: return str(float(str(v)))
    except: pass
    # Dates: take first 10 chars
    if len(str(v)) >= 10: return str(v)[:10]
    return str(v).lower()
```

Checksums verified:
- `member_id` — count equality check (IDs are UUID-converted, so direct checksum would always fail)
- `claim_amount` — normalized float comparison
- `date_of_service` — normalized date comparison

#### Business rule violations

For each Claim resource in the FHIR output:
- Must have `patient.reference` populated
- Must have at least one `diagnosis[].code`
- Must have `provider.reference` populated

#### Compliance scoring

Evaluates 8 regulatory rules:

| Rule ID | Standard | What it checks |
|---|---|---|
| HIPAA-NPI | HIPAA 45 CFR 162 | Provider NPI is 10 digits |
| FHIR-ICD10 | FHIR R4 CodeSystem | ICD-10 format valid |
| FHIR-COMPLETE | FHIR R4 Must Support | Required fields present |
| HIPAA-PHI | HIPAA Privacy Rule | Patient name + DOB present |
| CMS-DATE | CMS Claims Data | Dates in ISO 8601 format |
| HL7-GENDER | HL7 FHIR Admin | Gender uses HL7 codes |
| FHIR-UUID | FHIR R4 Resource.id | Patient ID is UUID |
| CMS-AMOUNT | CMS Claim Submission | Claim amounts positive |

---

## 7. Agent 5 — Integration Monitor Agent

**File:** `backend/agents/monitor_agent.py`

### Responsibility

Continuously watch the source schema during execution. If any source table gains, loses, or renames a column, halt the pipeline immediately to prevent data corruption.

### How it works

```python
# On startup: take a snapshot of all source table schemas
snapshot = {
    "members":     {"member_id": "character varying", "first_name": ...},
    "eligibility": {"eligibility_id": "character varying", ...},
    "claims":      {"claim_id": "character varying", ...}
}

# Every 30 seconds: compare current schema to snapshot
while True:
    await asyncio.sleep(30)
    current = read_schema_from_information_schema()
    changes = diff(snapshot, current)
    if changes:
        halt_pipeline()
        broadcast("SCHEMA_DRIFT", changes)
    snapshot = current
```

Changes detected: columns added or removed. Known metadata columns (`created_at`, `dataset_id`) are excluded from drift detection.

### Schema drift simulation

For demo purposes, a drift can be triggered via:
```
POST /api/mock/schema-drift/trigger  # adds a column
POST /api/mock/schema-drift/clear    # removes it
```

---

## 8. Dynamic Mapping Engine (Core)

**File:** `backend/dynamic_fhir_engine.py`

This is the brain of the system. All mapping intelligence lives here.

### FHIR Resource Catalog

The catalog is the configurable knowledge base that drives all mapping decisions. It lists the aliases and compatible data types for every mappable FHIR field:

```python
FHIR_RESOURCE_CATALOG = {
    "Patient": {
        "hints": ["member", "patient", "person", ...],
        "fields": {
            "birthDate": {
                "aliases": ["dob", "date_of_birth", "birth_date"],
                "types":   ["date", "timestamp", "text", "varchar"]
            },
            ...
        }
    },
    "Coverage": { ... },
    "Claim":    { ... }
}
```

The catalog covers **3 FHIR resource types** with a total of **34 mappable FHIR fields**, each supporting **3–6 column name aliases** and **2–5 data type patterns**.

### Scoring algorithm

```
final_confidence = (name_score × 0.70) + (type_score × 0.15) + (pattern_score × 0.15)

# Bonus: if column name exactly matches an alias → confidence boosted to ≥ 0.90
# Bonus: if column name contains an alias string → confidence boosted proportionally
```

### FHIR resource construction

`build_fhir_resource()` iterates only over `auto_mapped` fields:

```python
for mapping in auto_mapped_fields:
    source_value = row[mapping["source_column"]]
    transformed = classify_value(column_name, source_value)
    # apply special transforms (UUID, ICD-10 norm, prefix, date)
    set_fhir_path(resource, fhir_path, transformed)
apply_resource_defaults(resource)  # fill required FHIR structure
```

### FHIR path writer

A recursive path parser that handles arrays with integer indices and named brackets:

```
"name[0].given[0]"          → resource.name[0].given[0]
"telecom[phone].value"       → resource.telecom[] where system="phone", .value
"diagnosis[0].code.coding[0].code"  → deep nested structure
```

---

## 9. Hardcoded vs. Dynamic Logic — Full Audit

### Truly dynamic (no hardcoding)

| What | Where | How it's dynamic |
|---|---|---|
| Source table names | `discovery_agent.py` | Read from `information_schema.tables` at runtime |
| Column names | `discovery_agent.py` | Read from `information_schema.columns` at runtime |
| FHIR resource type assignment | `dynamic_fhir_engine.py` | Scored from table name + column patterns |
| Field-to-FHIR mapping | `dynamic_fhir_engine.py` | Scored from column name, type, and sample values |
| Row counts and dataset ID | `discovery_agent.py` | Read from actual table at runtime |
| Source-to-FHIR field path | `dynamic_fhir_engine.py` | Resolved from mapping contract |

### Configurable (catalog-driven, not hardcoded)

| What | Where | How it works |
|---|---|---|
| FHIR field aliases | `dynamic_fhir_engine.py → FHIR_RESOURCE_CATALOG` | Can be extended by adding entries to the catalog dict |
| Resource hints | `FHIR_RESOURCE_CATALOG` | Can be extended per resource type |
| Scoring thresholds | `AUTO_MAP_THRESHOLD = 0.85`, `REVIEW_THRESHOLD = 0.55` | Constants at top of file, easy to adjust |
| Ignored metadata columns | `IGNORE_SOURCE_COLUMNS = {'created_at', 'updated_at', 'dataset_id'}` | Set at top of file |

### Hard boundaries (intentional design decisions, not bugs)

| What | Where | Why |
|---|---|---|
| Only 3 FHIR resource types supported | `FHIR_RESOURCE_CATALOG` | Healthcare demo scope; extend by adding entries |
| Batch size 100 | `orchestration_agent.py → BATCH_SIZE` | FHIR server performance; configurable constant |
| Monitor check every 30s | `monitor_agent.py → WATCH_INTERVAL` | Configurable constant |
| Max 3 retries | `MAX_RETRIES = 3` | Configurable constant |

### Conclusion on hardcoding

**No column names, table names, or field-specific logic is hardcoded in the pipeline itself.** The system reads everything dynamically. The `FHIR_RESOURCE_CATALOG` is a knowledge base (like a configuration file) that tells the engine what FHIR looks like — this is intentional and correct design, not hardcoding.

---

## 10. New Dataset Compatibility

### Will the pipeline work for a completely new dataset with different column names?

**Yes, with conditions.**

#### What will work automatically

If your new dataset uses common medical naming conventions, the engine will map it with no changes:

```
# These will auto-map to Patient.birthDate
date_of_birth, dob, birth_date, patient_dob

# These will auto-map to Claim.diagnosis.code  
icd10_primary, diagnosis_code, dx_code, primary_diagnosis

# These will auto-map to Patient.name.given
first_name, given_name, fname, forename
```

#### What will go to the review queue

Unusual but recognizable column names (e.g. `patient_birth_dt`, `claim_total`) will be scored 55–84% and shown in the review queue. The operator confirms or reassigns.

#### What will be ignored

Genuinely unrecognizable columns (< 55% confidence) are skipped. If a column is important, add it to the alias list in `FHIR_RESOURCE_CATALOG`.

#### How to add support for a new column name

Edit `backend/dynamic_fhir_engine.py`, find the relevant FHIR field, and add to aliases:

```python
# Before:
"birthDate": {"aliases": ["dob", "date_of_birth", "birth_date"], ...}

# After (added "patient_birth_dt"):
"birthDate": {"aliases": ["dob", "date_of_birth", "birth_date", "patient_birth_dt"], ...}
```

#### How to add a completely new FHIR resource type

Add a new entry to `FHIR_RESOURCE_CATALOG` following the same pattern (hints, fields with aliases and types). The Discovery, Transformation, QA, and orchestration agents all work from this catalog with no code changes.

---

## 11. Duplicate Logic Identification

### Confirmed duplicates / redundant code

#### 1. Unused legacy components in `frontend/src/components/`

The following components exist in the file system but are **no longer imported** by any page (they are from an earlier version of the UI):

- `AgentCard.tsx`
- `AgentPanel.tsx`
- `AgentWorkspace.tsx`
- `AuditLog.tsx`
- `ComplianceDashboard.tsx`
- `CompliancePage.tsx`
- `DatabasePanel.tsx`
- `EmptyState.tsx`
- `Footer.tsx`
- `ReconciliationPanel.tsx`
- `ArchitecturePage.tsx` *(kept but no longer in nav)*

**Recommendation:** Delete these files. They add no value and may confuse future developers.

#### 2. Compliance computed twice

Compliance is computed in `orchestration_agent.py` after the run using stored FHIR resources:

```python
# In orchestration_agent.py (USED — from stored FHIR resources)
compliance = compute_compliance(fhir_patients, fhir_coverage, fhir_claims)

# Also available in qa_agent run report output
# But QA only stores reconciliation counts, not the full compliance breakdown
```

This is acceptable — the orchestration agent owns the final compliance score. No true duplication.

#### 3. Review item deduplication in two places

Review items are deduplicated:
- In `transformation_agent.py` (backend) — deduplicates before returning
- In `MigrationView.tsx` (frontend) — deduplicates again before rendering

**Recommendation:** The backend deduplication is the correct place. The frontend deduplication is a safety net and can stay, but the logic is redundant.

#### 4. `list_resources()` kept as legacy alias

`fhir_store.py` has both `list_records()` (new, full-featured) and `list_resources()` (legacy, simpler format). The legacy function is only used by one old endpoint.

**Recommendation:** Migrate the old endpoint to `list_records()` and remove `list_resources()`.

#### 5. DATASET_META in both `main.py` and `run_store.py`

The dataset name lookup exists in two places:
- `main.py → DATASET_META` dict (for the datasets API)
- `run_store.py → DATASET_META` dict (for saving dataset_name to migration_runs)

**Recommendation:** Consolidate into one shared config module.

---

## 12. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SOURCE: PostgreSQL                                  │
│   Table: members          Table: eligibility          Table: claims         │
│   ─────────────           ─────────────────           ─────────────         │
│   member_id               eligibility_id              claim_id              │
│   first_name              member_id                   member_id             │
│   last_name               plan_id                     provider_npi          │
│   date_of_birth           effective_date              icd10_primary         │
│   gender                  status                      claim_amount          │
│   address_line1           ...                         date_of_service       │
│   ...                                                 ...                   │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                         Agent 1: DISCOVERY
                                   │
                    ┌──────────────┼───────────────┐
                    │ Scores each column vs catalog │
                    │ Infers: members → Patient     │
                    │         eligibility → Coverage│
                    │         claims → Claim        │
                    │ Outputs: Mapping Contract     │
                    └──────────────┬───────────────┘
                                   │
                         Agent 2: TRANSFORMATION
                                   │
        ┌─────────────────────────────────────────────────────┐
        │  For each source row:                                │
        │  member_id      ──UUID──→ Patient.id                │
        │  first_name     ─direct→ Patient.name.given         │
        │  date_of_birth  ─format→ Patient.birthDate          │
        │  icd10_primary  ─norm──→ Claim.diagnosis[0].code    │
        │  claim_amount   ─float→ Claim.total.value           │
        │  member_id      ─ref──→ Claim.patient.reference     │
        │                                                      │
        │  Failed records → anomalies.jsonl (quarantined)     │
        │  Uncertain fields → review queue (human confirms)   │
        └──────────────────────────┬──────────────────────────┘
                                   │
                         Agent 3: ORCHESTRATION
                                   │
                    ┌──────────────┼───────────────┐
                    │ ► Validate structure          │
                    │ ► PAUSE for human approval    │
                    │ ► POST to FHIR endpoint       │
                    │   (batches of 100)            │
                    │ ► Store in fhir_loaded_resources│
                    └──────────────┬───────────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │       FHIR Target             │
                    │  Patient resources            │
                    │  Coverage resources           │
                    │  Claim resources              │
                    └──────────────┬───────────────┘
                                   │
                         Agent 4: QA / RECONCILIATION
                                   │
                    ┌──────────────┼───────────────┐
                    │ Count: source == loaded?      │
                    │ Checksums: amounts, dates     │
                    │ Business rules: NPI, ICD-10   │
                    │ Compliance: 8 regulatory rules│
                    └───────────────────────────────┘

Throughout all stages:
                         Agent 5: MONITOR
         (checks schema every 30s — halts on structural change)
```

---

## Appendix: Key Configuration Constants

| Constant | File | Default | Description |
|---|---|---|---|
| `AUTO_MAP_THRESHOLD` | `dynamic_fhir_engine.py` | `0.85` | Min confidence for auto-mapping |
| `REVIEW_THRESHOLD` | `dynamic_fhir_engine.py` | `0.55` | Min confidence to show in review queue |
| `IGNORE_SOURCE_COLUMNS` | `dynamic_fhir_engine.py` | `{'created_at', 'updated_at', 'dataset_id'}` | Never mapped |
| `SAMPLE_LIMIT` | `dynamic_fhir_engine.py` | `5` | Rows sampled per table for pattern detection |
| `BATCH_SIZE` | `orchestration_agent.py` | `100` | FHIR POST batch size |
| `MAX_RETRIES` | `orchestration_agent.py` | `3` | Max retries on failure |
| `WATCH_INTERVAL` | `monitor_agent.py` | `30` | Schema check interval (seconds) |
| `FHIR_BASE_URL` | `.env` | `http://localhost:8080/fhir` | Target FHIR endpoint |

---

*Document generated from source code analysis of the agenticdm repository.*
