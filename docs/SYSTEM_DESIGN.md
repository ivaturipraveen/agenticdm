# System Design — FHIR Migration Platform

**Version:** 3.0 (Claude AI-powered mapping)
**Last updated:** April 2026

---

## Overview

This system migrates legacy PostgreSQL healthcare data into FHIR R4-compliant JSON resources. It works on **any source schema** — table names, column names, and structure are discovered at runtime. No column names or table names are hardcoded anywhere in the system.

---

## The Full Flow — Step by Step

```
PostgreSQL DB (any schema)
        │
        ▼
[Agent 1: Discovery]
  ├── Read information_schema → find all source tables
  ├── Read column names, types, sample rows (10 rows per table)
  └── Send to Claude AI → get mapping contract
        │
        ▼
[Claude Haiku API] ← ONE call per table, NOT per record
  ├── Input:  table name + column names + data types + sample values
  ├── Output: { resource_type, per-column → FHIR field path, confidence }
  └── e.g. pt_gvn_nm → Patient.name[0].given[0] (conf=0.97)
        │
        ▼
[Mapping Contract stored in pipeline_state]
  e.g. {
    table: "members",
    resource: "Patient",
    fields: [
      { source_column: "pt_id",     target_field: "Patient.id",                 status: "auto_mapped",    confidence: 0.99 },
      { source_column: "pt_gvn_nm", target_field: "Patient.name[0].given[0]",   status: "auto_mapped",    confidence: 0.97 },
      { source_column: "mbr_dob",   target_field: "Patient.birthDate",           status: "auto_mapped",    confidence: 0.95 },
      { source_column: "sx_cd",     target_field: "Patient.gender",              status: "requires_review", confidence: 0.72 },
      { source_column: "dataset_id",target_field: null,                          status: "ignored" }
    ]
  }
        │
        ▼
[Human Review Gate — optional]
  └── UI shows "requires_review" fields (conf 0.55–0.84)
      Human accepts, rejects, or corrects each mapping
      Pipeline waits here until all reviews resolved
        │
        ▼
[Agent 2: Transformation] ← NO AI calls here, pure Python
  ├── Read ALL rows from source table (PostgreSQL → Python dicts)
  ├── For each row, call build_fhir_resource(resource_type, row, mapping)
  │     ├── Iterate auto_mapped fields only
  │     ├── Strip resource type prefix: "Patient.name[0].given[0]" → "name[0].given[0]"
  │     ├── classify_value(target_field, source_col, value):
  │     │     ├── target ends in ".id"          → ensure_resource_id() → stable UUID
  │     │     ├── target ends in ".reference"   → "Patient/{uuid}" or "Practitioner/{npi}"
  │     │     ├── target contains "date"        → normalize_date() → "YYYY-MM-DD"
  │     │     ├── target contains "gender"      → map_gender() → "male/female/other/unknown"
  │     │     ├── target ends in "coding[].code" → _normalize_icd10() → "I10.0"
  │     │     ├── target ends in ".value" + "total/payment" → float()
  │     │     └── otherwise                     → stringify as-is
  │     ├── set_fhir_path(resource, path, value) → writes into nested JSON dict
  │     ├── apply_resource_defaults() → fills FHIR R4 required fields if missing
  │     └── validate_fhir_resource() → check required fields present
  ├── Records that fail validation → quarantine_anomaly() → anomalies.jsonl
  └── Valid records → transformed_records list
        │
        ▼
[Human Approval Gate — MANDATORY]
  ├── Shows: total records, anomaly count, validation failures
  └── Human clicks APPROVE before any data is posted to FHIR server
        │
        ▼
[Agent 3: Load]
  ├── POST FHIR transaction bundles to FHIR server (BATCH_SIZE=100)
  ├── Each call recorded in fhir_endpoint_calls table:
  │     endpoint_url, http_status, resource_count, success, simulated, response
  └── Each resource saved in fhir_loaded_resources table:
        resource_json, source_json, validation_errors, status
        │
        ▼
[Agent 4: QA / Reconciliation] ← dynamic, uses mapping contract
  ├── Count check: source rows == loaded FHIR resources (per table)
  ├── Value checksum: for each auto_mapped field,
  │     MD5(sorted source values) == MD5(sorted FHIR field values)
  ├── FHIR R4 completeness: validate every loaded resource
  └── Report: match_pct, violations, per-field checksum results
        │
        ▼
[Agent 5: Monitor — runs continuously in background]
  ├── Every 30 seconds: read information_schema for all source tables
  ├── Diff current schema vs last snapshot
  └── If column added/removed → broadcast SCHEMA_DRIFT → halt pipeline
```

---

## Who Does What


| Component                                            | Responsibility                                                                | Uses AI?                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------- |
| **PostgreSQL**                                       | Stores source data. Read-only during migration                                | No                                      |
| **Discovery Agent** (`discovery_agent.py`)           | Reads schema + sample rows, calls Claude, stores mapping contract             | Yes — calls Claude Haiku once per table |
| **Claude Haiku API**                                 | Infers which FHIR field each source column maps to                            | Yes — this is the only AI call          |
| **Mapping Contract**                                 | Stored in `pipeline_state.schema_mapping`, persisted in `run_agent_outputs`   | N/A                                     |
| **Transformation Agent** (`transformation_agent.py`) | Loops every source row, calls `build_fhir_resource()`                         | No — pure Python                        |
| `**dynamic_fhir_engine.py`**                         | Converts source values to correct FHIR types (dates, IDs, references, ICD-10) | No — deterministic functions            |
| **FHIR Validator** (`validate_fhir_resource()`)      | Checks FHIR R4 required fields present                                        | No — rule-based                         |
| **Orchestration Agent** (`orchestration_agent.py`)   | Controls pipeline stages, manages approval gates, calls FHIR server           | No                                      |
| **QA Agent** (`qa_agent.py`)                         | Checksums source vs FHIR values, counts violations                            | No                                      |
| **Monitor Agent** (`monitor_agent.py`)               | Polls `information_schema` every 30s for schema drift                         | No                                      |
| **PostgreSQL (fhir_loaded_resources)**               | Stores every converted FHIR resource + its source row                         | No                                      |
| **PostgreSQL (fhir_endpoint_calls)**                 | Stores every FHIR server POST attempt                                         | No                                      |


---

## The Conversion — Exactly How It Works

### What Claude does (once per table, ~1 second per table)

**Input sent to Claude:**

```
Table: "pt_master"
Columns:
  - pt_id (varchar) | samples: ["M001", "M002", "M003"]
  - pt_gvn_nm (varchar) | samples: ["Jennifer", "Michael", "Sarah"]
  - pt_fam_nm (varchar) | samples: ["Jones", "Smith", "Brown"]
  - mbr_dob (date) | samples: ["1985-03-12", "1978-07-22", "1992-11-05"]
  - sx_cd (varchar) | samples: ["F", "M", "F"]
  - mbr_zip (varchar) | samples: ["78701", "75201", "90210"]
```

**Output from Claude (structured JSON):**

```json
{
  "resource_type": "Patient",
  "resource_confidence": 0.97,
  "resource_reasoning": "Column names and sample data match Patient demographics",
  "mappings": [
    { "source_column": "pt_id",     "target_field": "Patient.id",               "confidence": 0.99, "status": "auto_mapped" },
    { "source_column": "pt_gvn_nm", "target_field": "Patient.name[0].given[0]", "confidence": 0.97, "status": "auto_mapped" },
    { "source_column": "pt_fam_nm", "target_field": "Patient.name[0].family",   "confidence": 0.97, "status": "auto_mapped" },
    { "source_column": "mbr_dob",   "target_field": "Patient.birthDate",         "confidence": 0.99, "status": "auto_mapped" },
    { "source_column": "sx_cd",     "target_field": "Patient.gender",            "confidence": 0.85, "status": "auto_mapped" },
    { "source_column": "mbr_zip",   "target_field": "Patient.address[0].postalCode", "confidence": 0.95, "status": "auto_mapped" }
  ]
}
```

### What the Transformation Engine does (per row, no AI)

Given this source row:

```python
{ "pt_id": "M001", "pt_gvn_nm": "Jennifer", "pt_fam_nm": "Jones",
  "mbr_dob": "1985-03-12", "sx_cd": "F", "mbr_zip": "78701" }
```

And the mapping contract from Claude, `build_fhir_resource()` produces:

```json
{
  "resourceType": "Patient",
  "id": "3b9087fe-...",
  "name": [{ "given": ["Jennifer"], "family": "Jones" }],
  "birthDate": "1985-03-12",
  "gender": "female",
  "address": [{ "postalCode": "78701" }]
}
```

**No AI involved in this step.** It is a deterministic loop:

1. For each `auto_mapped` field in the contract
2. Get source value from row
3. Apply the correct transformation based on the **FHIR target path** (not the source column name)
4. Write into the FHIR JSON at the correct nested path

---

## Is the Converted Data Verified? Honest Answer

### What is verified automatically


| Check                                | How                                                                | Where                         |
| ------------------------------------ | ------------------------------------------------------------------ | ----------------------------- |
| FHIR R4 required fields present      | `validate_fhir_resource()` — rule-based                            | After every record conversion |
| Source count == FHIR count           | Row count comparison per table                                     | QA Agent                      |
| Value integrity (no data corruption) | MD5 checksum of source values vs FHIR values for each mapped field | QA Agent                      |
| Date format correct                  | `DATE_RE.match()`                                                  | Validator                     |
| Gender value valid                   | Must be male/female/other/unknown                                  | Validator                     |
| ICD-10 dot notation                  | `_normalize_icd10()`                                               | Transform engine              |
| Numeric amounts are numeric          | `float()` conversion check                                         | Validator                     |
| FHIR R4 structural compliance        | Required fields per resource type                                  | Validator                     |


### What is NOT verified automatically


| Gap                                          | Why it matters                                                                                                                                          | Mitigation                                                      |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Semantic correctness of Claude's mapping** | Claude maps `sx_cd → Patient.gender`. If `sx_cd` means something else in your system (e.g. service code), the data will be wrong but structurally valid | Human review gate for any mapping below 0.85 confidence         |
| **Business rule completeness**               | The system validates FHIR R4 structure, not domain business rules (e.g. "all claims must have a paid_amount")                                           | Extend `validate_fhir_resource()` with custom rules per project |
| **FHIR server acceptance**                   | We verify the FHIR server returned HTTP 200/201, but don't validate the server's internal processing                                                    | Check `fhir_endpoint_calls` table for response bodies           |
| **ICD-10 code validity**                     | We normalize the format (e.g. `I100 → I10.0`) but don't check if the code actually exists in the ICD-10 codebook                                        | Add ICD-10 codebook lookup table for strict validation          |
| **Reference integrity**                      | `Coverage.beneficiary.reference = Patient/uuid` — we don't verify that the Patient actually exists in the FHIR server                                   | Run after Patient load, before Coverage load (ordering matters) |


### The confidence threshold system

```
Claude confidence ≥ 0.85  →  auto_mapped  →  converted automatically
Claude confidence 0.55–0.84  →  requires_review  →  human must approve/reject/edit
Claude confidence < 0.55  →  ignored  →  not converted, logged in unmapped_fields
```

If the mapping is wrong and gets through (confidence was high but semantically incorrect), the QA checksum will **catch value corruption** — because the checksum of source values won't match the checksum of FHIR values after transformation.

### What you can do for stronger guarantees

1. **Review all `requires_review` items** in the UI before approving — these are the uncertain mappings
2. **Sample-check the FHIR output** — the UI shows source row side-by-side with converted FHIR JSON
3. **Check `anomalies.jsonl`** — every record that failed FHIR validation is written here with the reason
4. **Query `fhir_loaded_resources`** — every converted resource + its original source row is stored together
5. **Use a FHIR validator** — post the output to a HAPI FHIR server, which runs full R4 schema validation

---

## Database Tables

### Source (read-only, any schema)

```
<whatever tables are in your PostgreSQL> — discovered dynamically at runtime
```

### System tables (created automatically on startup)


| Table                   | Purpose                                                            |
| ----------------------- | ------------------------------------------------------------------ |
| `migration_runs`        | One row per pipeline run: status, counts, compliance scores        |
| `run_logs`              | Audit trail: every agent action timestamped                        |
| `run_agent_outputs`     | Full JSON output from each agent per run                           |
| `fhir_loaded_resources` | Every converted FHIR resource + source row + validation errors     |
| `fhir_endpoint_calls`   | Every FHIR server POST: URL, HTTP status, resource count, response |


---

## Fallback When Claude Is Unavailable

If `ANTHROPIC_API_KEY` is not set or the API call fails, the system falls back to **structural inference**:

- Reads **value shapes** from sample data: date patterns, UUID patterns, ICD-10 patterns, NPI patterns, numeric values, gender codes
- Maps columns to FHIR fields based on what the **data looks like**, not what the column is named
- Marks all mappings as `requires_review` (confidence 0.75) so a human reviews before proceeding
- Each table in the mapping result has `"mapped_by": "structural_fallback"` so you know which tables need attention

This means the system always produces a mapping — it never silently fails. But Claude-powered mapping is always more accurate.

---

## Pipeline Stages

```
IDLE → EXTRACT → TRANSFORM → VALIDATE → AWAITING_APPROVAL → LOAD → RECONCILE → COMPLETE
                                                   ↑
                                         Human must click Approve
                                         (or pipeline stays here forever)
```

Any stage can transition to `HALTED` if:

- Schema drift detected by Monitor Agent
- Human clicks Halt
- Unrecoverable error in any agent

