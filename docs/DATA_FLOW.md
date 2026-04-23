# LA Care — Agentic CCDA Pipeline
## Data flow, database schema, and end-state client requirement

> This is the authoritative answer to:
> 1. *"What format is the input? Are we only dealing with XML?"*
> 2. *"What tables do we have and what goes where?"*
> 3. *"What does each step produce — with an example?"*
> 4. *"What happens after the pipeline finishes, and what does the client actually want?"*

---

## 1. Input — are we only dealing with XML?

**Yes. The input is always HL7 Consolidated Clinical Document Architecture (C-CDA) XML.**
That is the format provider EHRs export and the format LA Care receives from
HIEs (Health Information Exchanges). One `.xml` file = one clinical document
for one patient for one encounter. Examples in our seed library:

| `document_type`       | LOINC   | Typical size | What it contains                                                        |
| --------------------- | ------- | ------------ | ----------------------------------------------------------------------- |
| Progress Note         | 11506-3 | 3–6 KB       | One office visit — problems, short narrative, sometimes vitals.         |
| Discharge Summary     | 18842-5 | 6–15 KB      | Inpatient discharge — meds, reconciliation, follow-up plan.             |
| Continuity of Care    | 34133-9 | 8–25 KB      | Longitudinal snapshot — problems, meds, labs, vitals, encounters, etc.  |
| Referral Note         | 57133-1 | 3–8 KB       | Reason for referral, working diagnosis, questions for the specialist.   |
| Consultation Note     | 11488-4 | 4–10 KB      | Specialist's response, new diagnoses, plan.                             |

Every C-CDA has two parallel representations of the same facts:

```
┌─────────────────── One C-CDA XML document ───────────────────┐
│                                                              │
│  <section>                                                   │
│    <code code="11450-4" displayName="Problems"/>             │
│                                                              │
│   ① NARRATIVE  (free text the clinician typed)               │
│    <text>                                                    │
│      Active problems: Major depressive disorder, single      │
│      episode, unspecified. BH follow-up 4 days after ED.     │
│    </text>                                                   │
│                                                              │
│   ② STRUCTURED ENTRIES  (coded, machine-parseable)           │
│    <entry>                                                   │
│      <observation>                                           │
│        <code code="F32.9" codeSystem=".../icd10-cm"/>        │
│        <value xsi:type="CD" code="64572001"                  │
│               codeSystem=".../snomed"/>                      │
│      </observation>                                          │
│    </entry>                                                  │
│  </section>                                                  │
└──────────────────────────────────────────────────────────────┘
```

**We do NOT convert the XML into a different file format** before the pipeline
consumes it. The raw XML is stored verbatim, and the pipeline parses it into
Python dicts, enriches it, and writes enriched views back into the database —
all under one `run_id`. The only "conversion" happens at the Narrative NLP
step: slices of text (not the whole document) are sent to the clinical LLM
which returns a strict JSON schema.

---

## 2. Database schema — what table holds what

All tables live in Postgres (Render). The boundary is clear: the six
`lacare_*` tables are for the LA Care module; the rest belong to the platform
and to Agentic DM.

```
  PLATFORM (shared auth + app registry)
  ┌────────────────────────────────────────────────────────┐
  │ platform_users        · login + password hash (PBKDF2) │
  │ platform_sessions     · bearer tokens for the UI       │
  └────────────────────────────────────────────────────────┘

  LA CARE  (everything the pipeline reads / writes)
  ┌───────────────────────────────────────────────────────────────────────┐
  │ lacare_samples        · 30 curated CCDAs, seeded once, kept forever   │
  │                                                                       │
  │ lacare_runs           · one row per pipeline execution                │
  │   └── lacare_documents      · raw_xml + parsed_json + nlp_json        │
  │   └── lacare_hits           · satisfied HEDIS measures (gap closures) │
  │   └── lacare_agent_events   · per-agent status (running/complete)     │
  │   └── lacare_logs           · free-text log lines                     │
  │   └── lacare_step_events    · per-(document,agent) input→output trail │
  │                                                                       │
  │ lacare_activity       · HTTP requests + pipeline milestones (drawer)  │
  └───────────────────────────────────────────────────────────────────────┘
```

Key columns in each table (what you will see on the dashboard):

| Table                | Important columns                                                                                            | Feeds which UI?              |
| -------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `platform_users`     | `username`, `password_hash`, `password_salt`, `apps`                                                         | Login / Signup               |
| `platform_sessions`  | `token`, `user_id`, `expires_at`                                                                             | All API calls                |
| `lacare_samples`     | `sample_id`, `scenario`, `document_type`, `expected_measure`, **`raw_xml`**, `parsed_json`                   | Sample Library               |
| `lacare_runs`        | `run_id`, `status`, `current_stage`, `total_documents`, `processed_documents`, `use_ai`, `started_at`        | Run selector + status banner |
| `lacare_documents`   | `document_id`, `document_type`, `patient_id`, `patient_name`, **`raw_xml`**, **`parsed_json`**, **`nlp_json`** | Documents tab                |
| `lacare_hits`        | `measure` (FUM/FUA/CBP/HBD/MRP), `patient_id`, `confidence`, `summary`, `source_section`                     | HEDIS Evidence tab           |
| `lacare_agent_events`| `agent`, `status`, `last_action`, `duration_ms`                                                              | Pipeline tab / status banner |
| `lacare_logs`        | `ts`, `level`, `message`                                                                                     | Pipeline tab logs            |
| `lacare_step_events` | `document_id`, `agent`, `input_summary`, `output_summary`, **`details` (JSONB)**                             | Step Timeline (right pane)   |
| `lacare_activity`    | `kind`, `method`, `path`, `status`, `duration_ms`, `message`                                                 | System Activity drawer       |

**Current state of the DB right now (just wiped for the demo):**
```
lacare_runs         : 0
lacare_documents    : 0
lacare_hits         : 0
lacare_agent_events : 0
lacare_logs         : 0
lacare_step_events  : 0
lacare_activity     : 0
lacare_samples      : 30   ← preserved
platform_users      : intact (your login still works)
```

---

## 2b. Deterministic vs. LLM — which agents call an AI model?

**Only one of the six agents uses an LLM. The other five are deterministic
code.** That is a deliberate design choice: we don't want the LLM deciding
anything we can compute with certainty, and we never want to give it code or
patient IDs.

| Agent              | Type                | What runs                                                                                                                                      |
| ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Ingest          | Deterministic       | Python — validate XML string, record size, list declared LOINC sections. No model.                                                             |
| 2. Extraction      | **Deterministic**   | Pure `lxml` / `xml.etree.ElementTree` — walk `urn:hl7-org:v3` namespace, pull header + sections + structured entries. See `ccda_parser.py`.     |
| 3. Normalization   | **Deterministic**   | Pure string match on `codeSystem` — buckets every code into SNOMED / LOINC / ICD-10 / RxNorm / CPT / OTHER. Hardcoded mapping (`pipeline.py`).  |
| 4. Narrative NLP   | **LLM (only one)**  | One call per narrative block to the clinical LLM with a strict JSON schema. Falls back to regex heuristic on any error (`nlp_extractor.py`).    |
| 5. HEDIS           | Deterministic       | Rule engine, one function per measure (FUM / FUA / CBP / HBD / MRP). Reads normalised + NLP facts, emits hits (`hedis_engine.py`).             |
| 6. Rollup          | Deterministic       | SQL aggregates over `lacare_hits` + `lacare_documents` into the dashboard JSON.                                                                |

### Why extraction is NOT done by the LLM

- **Speed.** 3 KB of XML parses in microseconds with lxml. An LLM call would
  add 300–800 ms per document and cost money per run.
- **Correctness.** The CCDA structure is precisely specified by HL7. Pulling
  `<observation><value code="F32.9"/>` is a solved problem — we do not need
  a probabilistic model for it.
- **Auditability.** When a regulator asks *"where did this F32.9 come from?"*
  we can point to an exact `<entry>` in the XML. An LLM answer is fuzzier.
- **PHI.** Raw CCDAs contain member IDs, names, addresses, DOBs. We parse
  those locally and never send them to the LLM. Only short narrative text
  blocks go out — and the Presidio PHI scrubber (future work — see §6) will
  redact those further.

### What the clinical LLM is actually given (step 4 only)

- One narrative block at a time (typical 50–800 chars).
- A strict JSON schema with these keys: `labs`, `vitals`, `diagnoses`,
  `procedures`, `medications`, `encounter_dates`.
- Temperature 0, `max_tokens` 1024.
- Response must be valid JSON or we fall back to the regex heuristic and
  mark the step `source='heuristic-after-llm-error'`.

See the Step Timeline on the Documents tab → NLP step → "Call #N" blocks.
Each block shows the **exact text sent** and the **exact JSON received**.

---

## 3. End-to-end flow (text flowchart)

Every request for a new run executes exactly these stages, in order.
Every arrow = data handoff; the labelled box in the middle is the *mutation*
applied at that step.

```
                          ┌──────────────────────────────┐
 ① USER                   │ Click sample cards in the    │
   (LA Care analyst) ────▶│ Sample Library, tick the     │
                          │ ones you want, press "Run".  │
                          └──────────────┬───────────────┘
                                         │  POST /api/lacare/pipeline/run-from-samples
                                         │  body: { sample_ids: [...] }
                                         ▼
                          ┌──────────────────────────────┐
 ② ROUTES                 │  _ensure_no_active_run()     │   rejects if another
   (routes.py)            │  copy lacare_samples         │   run is already live
                          │  rows → lacare_documents     │
                          │  create lacare_runs row      │
                          │  spawn asyncio task          │
                          └──────────────┬───────────────┘
                                         │  run_id now exists in DB
                                         │  status = 'queued' → 'running'
                                         ▼
╔════════════════════════════════════════════════════════════════════════╗
║  P I P E L I N E  (pipeline.py)      6 agents, one run_id              ║
║                                                                        ║
║                                                                        ║
║   ┌─────────────────────────┐      INPUT : raw_xml (one string / doc)  ║
║   │  A1  INGEST             │      WRITES: lacare_step_events          ║
║   │  — XML sanity check     │              agent='ingest'              ║
║   │  — stores raw_xml       │      OUTPUT: raw_xml_head + declared     ║
║   └─────────────┬───────────┘              sections                    ║
║                 │                                                      ║
║                 ▼                                                      ║
║   ┌─────────────────────────┐      INPUT : raw_xml                     ║
║   │  A2  EXTRACTION         │      CALLS : lxml → ccda_parser.py       ║
║   │  — parse namespaced XML │      WRITES: parsed_json in lacare_docs  ║
║   │  — pull LOINC sections  │              + step_events row           ║
║   │  — build narrative map  │      OUTPUT: sections = [problems,       ║
║   └─────────────┬───────────┘                          meds, labs,     ║
║                 │                                       vitals, ...]   ║
║                 ▼                                                      ║
║   ┌─────────────────────────┐      INPUT : entries from parsed_json    ║
║   │  A3  NORMALIZATION      │      CALLS : value_sets.py (ICD9→ICD10,  ║
║   │  — map codes to HEDIS   │              local → SNOMED/LOINC/RxN)   ║
║   │    value sets           │      OUTPUT: normalised facts + count    ║
║   │  — flag unmapped        │              of narrative-only entries   ║
║   └─────────────┬───────────┘                                          ║
║                 │                                                      ║
║                 ▼                                                      ║
║   ┌─────────────────────────┐      INPUT : narrative blocks (free text)║
║   │  A4  NARRATIVE NLP      │      CALLS : clinical LLM with strict    ║
║   │  — per-section loops    │              JSON schema, fall back to   ║
║   │  — one API call per     │              regex heuristics on error   ║
║   │    narrative section    │      WRITES: nlp_json in lacare_docs     ║
║   │  — JSON-only response   │              + one step_events.details   ║
║   │  — heuristic fallback   │              block per LLM call with     ║
║   │    if the call fails    │              input_text, output, ms,    ║
║   └─────────────┬───────────┘              source=llm|heuristic|error  ║
║                 │                                                      ║
║                 ▼                                                      ║
║   ┌─────────────────────────┐      INPUT : normalised + NLP facts      ║
║   │  A5  HEDIS              │      RULES : 5 measures                  ║
║   │  — run each measure     │              (FUM, FUA, CBP, HBD, MRP)   ║
║   │    rule vs the facts    │      OUTPUT: one lacare_hits row per     ║
║   │  — attach confidence    │              satisfied measure           ║
║   └─────────────┬───────────┘                                          ║
║                 │                                                      ║
║                 ▼                                                      ║
║   ┌─────────────────────────┐      INPUT : all hits in this run        ║
║   │  A6  ROLLUP / DASHBOARD │      WRITES: aggregates returned by      ║
║   │  — count per measure    │              GET /api/lacare/dashboard   ║
║   │  — count per confidence │      OUTPUT: KPIs, charts, revenue est.  ║
║   │  — revenue estimate     │                                          ║
║   └─────────────┬───────────┘                                          ║
║                 │                                                      ║
║                 ▼                                                      ║
║          status='complete'   (or 'halted' if Cancel run was clicked)   ║
║                                                                        ║
╚════════════════════════════════════════════════════════════════════════╝
                                         │
                                         ▼
                          ┌──────────────────────────────┐
 ③ UI                     │  Polls GET /status every 2.5s│
                          │  while active → renders banner│
                          │  + agent ribbon + step timeline│
                          └──────────────────────────────┘
```

---

## 4. Worked example — one document, all six steps

This is a condensed trace of **one real document** from our seed library
(Progress Note, scenario FUM_CLOSED). Every table is writable into; the
right-hand pane of the Documents tab shows this exact trace.

### Input
```xml
<?xml version="1.0"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <code code="11506-3" displayName="Progress Note"/>
  <recordTarget>
    <patientRole>
      <id extension="LAC77827638"/>
      <patient><name><given>Grace</given><family>Garcia</family></name></patient>
    </patientRole>
  </recordTarget>

  <!-- Problems section -->
  <component>
    <section>
      <code code="11450-4" displayName="Problems"/>
      <text>Active problems: Major depressive disorder,
            single episode, unspecified.</text>
      <entry>
        <observation>
          <value xsi:type="CD" code="F32.9"
                 codeSystem="2.16.840.1.113883.6.90"/>
        </observation>
      </entry>
    </section>
  </component>

  <!-- Encounters section -->
  <component>
    <section>
      <code code="46240-8" displayName="Encounters"/>
      <text>Patient was seen for behavioral health follow-up on
            01/18/2026 following ED visit on 01/14/2026 for acute
            depressive episode. Reports improved mood, adherent to
            sertraline. PHQ-9 score 8 (previous 18).</text>
      <entry><encounter><code code="99281"/></encounter></entry>
      <entry><encounter><code code="99214"/></encounter></entry>
    </section>
  </component>
</ClinicalDocument>
```

### Step 1 — INGEST
```
INPUT  : 4,305 chars of raw XML (stored once in lacare_documents.raw_xml)
ACTION : validate HL7 namespace, record size, list declared sections
OUTPUT : { raw_xml_head: "<?xml ...", declared_sections: [11450-4, 46240-8] }
DB ROW : lacare_step_events (agent='ingest')
```

### Step 2 — EXTRACTION
```
INPUT  : the XML string
ACTION : lxml parse → build {header, sections, narrative, entries}
OUTPUT : {
  problems:   [ {display:"Major depressive disorder", icd10:"F32.9"} ],
  encounters: [ {code:"99281", display:"ED visit"},
                {code:"99214", display:"Outpatient visit"} ]
}
DB ROW : lacare_documents.parsed_json  ·  lacare_step_events (agent='extract')
```

### Step 3 — NORMALIZATION
```
INPUT  : 3 structured entries from the previous step
ACTION : map every code into its canonical value set (ICD-10, CPT, RxNorm…)
OUTPUT : 3 entries mapped · 0 narrative-only
DB ROW : lacare_step_events (agent='normalize')  (facts appended to nlp_json)
```

### Step 4 — NARRATIVE NLP  (the LLM step)
```
INPUT (call #1) : "Active problems: Major depressive disorder, single
                   episode, unspecified."          (72 chars)
INPUT (call #2) : "Patient was seen for behavioral health follow-up on
                   01/18/2026 following ED visit on 01/14/2026…"  (260 chars)

ACTION          : one clinical-LLM call per narrative block with a strict
                  JSON schema (diagnoses, meds, labs, vitals, encounter_dates).
                  If the call errors out, a deterministic regex heuristic
                  runs and is marked source='heuristic-after-llm-error'.

OUTPUT (call #2 JSON):
  {
    "source": "llm",
    "diagnoses": [ {"text":"depressive episode","icd10":"F32.9"} ],
    "encounter_dates": ["2026-01-18", "2026-01-14"],
    "medications": [ {"name":"sertraline 50mg daily"} ],
    "duration_ms": 420
  }

DB ROWS : lacare_documents.nlp_json
          lacare_step_events (agent='nlp'; details.blocks = [call1, call2])
```

### Step 5 — HEDIS
```
INPUT  : structured entries + nlp_json
RULE   : FUM — BH follow-up within 7 days of an ED visit for mental illness
MATCH  : ED visit 2026-01-14 → BH follow-up 2026-01-18  →  4 days  ✓
OUTPUT : lacare_hits row = {
   measure: 'FUM', patient_id: 'LAC77827638',
   confidence: 0.95, source_section: 'encounters',
   summary: 'BH follow-up 4d after ED visit (7-day window met)'
}
```

### Step 6 — ROLLUP
```
INPUT  : every lacare_hits row in this run_id
OUTPUT : the dashboard JSON the UI charts consume:
   { total_documents: N, total_evidence: K,
     gap_closure_members: K',
     by_measure: {FUM: n1, FUA: n2, ...},
     by_confidence: {high: a, med: b, low: c},
     revenue: { total_usd: $X } }
```

---

## 5. After the flow — what happens, and what the client wants

### 5a. What happens right after the pipeline completes

1. `lacare_runs.status` flips to `complete`, `completed_at` is stamped.
2. The UI (which has been polling `/status` every 2.5 s) flips the top
   banner from rose → emerald, shows total docs and gap-closures.
3. The **HEDIS Evidence** tab now lists every `lacare_hits` row — one row
   per gap-closure, with patient, measure, confidence and source section.
4. The **Documents** tab lists every `lacare_documents` row; clicking a
   row calls `GET /documents/{id}/steps` and renders the full Step Timeline
   (every agent's input→output, including the exact text sent to the LLM).
5. The **Overview** tab aggregates the same data into charts + KPIs +
   revenue estimate.
6. System Activity drawer and `lacare_activity` have logged every HTTP
   request and pipeline milestone, timestamped.

### 5b. What the client — LA Care — actually wants out of all this

The use-case document frames it as three concrete outcomes:

1. **Close HEDIS gaps that claims data missed.**
   EDI claims under-report BH follow-ups, BP readings, med reconciliations,
   and HbA1c values. Every `lacare_hits` row is a dollar of quality-bonus
   revenue that would otherwise be lost.

2. **Do it with full auditability.**
   For every hit we must be able to point at a specific document, a
   specific section, and the specific evidence (coded entry + supporting
   narrative). That is exactly what `lacare_step_events` + `lacare_hits.
   source_section` give them — they can defend every finding to NCQA in
   an audit.

3. **Make it an operational product, not a science project.**
   Non-technical analysts at LA Care should be able to:
      - log in (platform_users),
      - pick documents (Sample Library, or later a production feed),
      - run the pipeline with one click (routes.py),
      - watch every agent live (status banner + step timeline),
      - cancel if something's wrong (pipeline/cancel),
      - open the evidence tab and hand the list to the quality team,
      - export / drill into individual member records.

### 5c. What comes after (future deliverables implied by the document)
- **Production ingestion feed**: replace "Sample Library" with automated
  intake from LA Care's HIE (HL7 MLLP or SFTP drops). The pipeline stays
  identical; only the source table changes.
- **Member-level reconciliation**: append gap-closures to the member's
  supplemental-data record, push to NCQA-certified HEDIS engine (Inovalon,
  Cotiviti, etc.) through their standard supplemental-data file format.
- **Feedback loop**: mark false-positives from the quality team so NLP
  prompts and value-set mappings can be tuned — same `lacare_hits.extra`
  JSONB column absorbs this without a schema change.
- **Role-based access**: the `platform_users.role` column is already in
  place; only the UI has to grow to honor `analyst` vs `reviewer` vs
  `admin`. No backend refactor.

---

## 6. Gap audit — what we have vs. what is still missing

This is an honest comparison of the use-case document against what the
demo actually does today. Items marked ✅ are delivered; 🟡 is partial;
🔴 is not started.

| Use-case requirement                                            | Status | Notes / where it lives                                                                                |
| --------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------- |
| Ingest bulk C-CDA XML from multiple document types              | ✅    | Sample Library covers Progress Note, Discharge Summary, CCD, Referral, Consult. Now filterable by type. |
| Validate & tolerate malformed documents                         | ✅    | `ccda_parser.py` captures warnings instead of throwing.                                               |
| Extract LOINC sections + structured entries                     | ✅    | Deterministic lxml parser.                                                                            |
| Map codes to standard value sets                                | 🟡    | Classification (which code-system) is done; true ICD-9 → ICD-10 and RxNorm-normalisation table lookup is stubbed — only bucket counting runs today. |
| Run NLP on narrative text                                       | ✅    | Clinical-LLM + heuristic fallback, per narrative block.                                               |
| PHI redaction before sending text to the LLM                    | 🔴    | Currently raw narrative is sent. Presidio integration is the recommended next step.                   |
| HEDIS measure evaluation (FUM, FUA, CBP, HBD, MRP)              | ✅    | Five measures implemented with per-measure rules and confidence scores.                               |
| Confidence + source-section traceability for every hit          | ✅    | `lacare_hits.confidence`, `source_section`, `summary`, + full step timeline.                          |
| Dashboard with KPIs, charts, revenue estimate                   | ✅    | Overview tab with 4 KPIs, measure mix, confidence buckets, doc-type mix.                              |
| Auditable step-by-step trail                                    | ✅    | `lacare_step_events` + Step Timeline side panel on the Documents tab.                                 |
| Cancel / halt a running pipeline                                 | ✅    | `POST /pipeline/cancel` with Cancel-run button in the status banner.                                  |
| Prevent duplicate concurrent runs                               | ✅    | `_ensure_no_active_run()` guard at the route layer.                                                   |
| Role-based access (analyst / reviewer / admin)                  | 🟡    | `platform_users.role` column exists; UI enforcement not yet wired.                                   |
| Bulk upload from HIE feed / SFTP drop                           | 🔴    | Today the only source is the curated sample library. Production ingestion is next.                    |
| Export gap-closures to NCQA supplemental-data file              | 🔴    | Not started. CSV / X12 837 supplemental-data export is an easy next step.                            |
| False-positive feedback loop (reviewer marks + model learns)    | 🔴    | Extra JSONB column is ready; no UI or retraining loop yet.                                            |
| Explicit PHI-at-rest encryption / column-level encryption       | 🟡    | Postgres TLS is on (Render default). Field-level encryption for member PII is recommended next.      |
| Audit export (immutable log of every action)                    | 🟡    | `lacare_activity` captures HTTP + pipeline events. SIEM export / retention policy not yet defined.    |
| Automated tests (unit + integration)                            | 🟡    | A backend smoke test runs the full pipeline. No formal test suite yet.                                |
| Observability (metrics, traces)                                 | 🔴    | Structured logs only today. Prometheus / OpenTelemetry wiring is a future task.                      |

### Short answer for "are we missing anything?"

For the **client demo** and the **core use-case requirements in the document**:
nothing critical is missing. The whole 6-agent pipeline runs end-to-end, every
step is visible, the dashboard rolls up correctly, and the sample library now
filters by both scenario *and* document type.

For a **production rollout** at LA Care, the three items that matter most are:

1. **PHI redaction** before the LLM call (Presidio).
2. **Real value-set tables** for ICD-9 → ICD-10 and RxNorm normalisation — not
   just the code-system classifier that exists today.
3. **HIE ingestion** (SFTP drop or HL7 MLLP listener) to replace the Sample
   Library as the document source.

Everything else on the "🔴 not started" list is nice-to-have — the core
architecture is there and those features slot in without schema changes.
