"""Database repository for LA Care CCDA runs / documents / hits / logs.

All LA Care read + write paths go through here. The pipeline writes its
progress live so the UI survives page reloads and multiple workers can
cooperate on the same data.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import psycopg2
import psycopg2.extras

from platform_db import get_conn as _conn  # pooled connection factory


# --------------------------------------------------------------------------- #
# Runs
# --------------------------------------------------------------------------- #

def create_run(run_id: str, user_id: int | None, use_ai: bool, source: str = "upload", notes: str | None = None) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_runs (run_id, user_id, status, current_stage, use_ai, source, notes)
        VALUES (%s, %s, 'queued', 'idle', %s, %s, %s)
    """, (run_id, user_id, use_ai, source, notes))
    conn.commit()
    cur.close()
    conn.close()


def set_run_status(run_id: str, status: str, stage: str | None = None, notes: str | None = None) -> None:
    conn = _conn()
    cur = conn.cursor()
    sets = ["status = %s"]
    params: list[Any] = [status]
    if stage is not None:
        sets.append("current_stage = %s")
        params.append(stage)
    if notes is not None:
        sets.append("notes = %s")
        params.append(notes)
    if status in ("complete", "failed", "halted"):
        sets.append("completed_at = NOW()")
    params.append(run_id)
    cur.execute(f"UPDATE lacare_runs SET {', '.join(sets)} WHERE run_id = %s", params)
    conn.commit()
    cur.close()
    conn.close()


def set_run_counts(run_id: str, total: int | None = None, processed: int | None = None) -> None:
    conn = _conn()
    cur = conn.cursor()
    sets, params = [], []
    if total is not None:
        sets.append("total_documents = %s")
        params.append(total)
    if processed is not None:
        sets.append("processed_documents = %s")
        params.append(processed)
    if not sets:
        cur.close()
        conn.close()
        return
    params.append(run_id)
    cur.execute(f"UPDATE lacare_runs SET {', '.join(sets)} WHERE run_id = %s", params)
    conn.commit()
    cur.close()
    conn.close()


def latest_run_id(user_id: int | None = None) -> str | None:
    conn = _conn()
    cur = conn.cursor()
    if user_id is not None:
        cur.execute("SELECT run_id FROM lacare_runs WHERE user_id=%s ORDER BY started_at DESC LIMIT 1", (user_id,))
    else:
        cur.execute("SELECT run_id FROM lacare_runs ORDER BY started_at DESC LIMIT 1")
    row = cur.fetchone()
    cur.close()
    conn.close()
    return row[0] if row else None


def get_run(run_id: str) -> dict[str, Any] | None:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("SELECT * FROM lacare_runs WHERE run_id=%s", (run_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return _serialize(dict(row)) if row else None


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT r.*, COALESCE(h.hit_count, 0) AS hit_count
        FROM lacare_runs r
        LEFT JOIN (
            SELECT run_id, COUNT(*) AS hit_count
            FROM lacare_hits WHERE satisfied = TRUE
            GROUP BY run_id
        ) h ON h.run_id = r.run_id
        ORDER BY r.started_at DESC LIMIT %s
    """, (limit,))
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return [_serialize(r) for r in rows]


def delete_run(run_id: str) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM lacare_runs WHERE run_id=%s", (run_id,))
    conn.commit()
    cur.close()
    conn.close()


# --------------------------------------------------------------------------- #
# Documents
# --------------------------------------------------------------------------- #

def insert_document(
    run_id: str | None,
    document_id: str,
    document_type: str,
    patient_id: str,
    patient_name: str,
    facility: str,
    encounter_date: str,
    sections: list[str],
    entry_count: int,
    narrative_chars: int,
    scenario: str,
    warnings: list[str],
    raw_xml: str,
    parsed_json: dict,
    nlp_json: dict | None = None,
) -> int:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_documents
          (run_id, document_id, document_type, patient_id, patient_name,
           facility, encounter_date, sections, entry_count, narrative_chars,
           scenario, warnings, raw_xml, parsed_json, nlp_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s::jsonb)
        RETURNING id
    """, (
        run_id, document_id, document_type, patient_id, patient_name,
        facility, encounter_date, json.dumps(sections), entry_count,
        narrative_chars, scenario, json.dumps(warnings), raw_xml,
        json.dumps(parsed_json, default=str),
        json.dumps(nlp_json, default=str) if nlp_json else None,
    ))
    new_id = cur.fetchone()[0]
    conn.commit()
    cur.close()
    conn.close()
    return new_id


def set_document_nlp(doc_pk: int, nlp_json: dict) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("UPDATE lacare_documents SET nlp_json=%s::jsonb WHERE id=%s",
                (json.dumps(nlp_json, default=str), doc_pk))
    conn.commit()
    cur.close()
    conn.close()


def list_documents(run_id: str | None, limit: int = 500, offset: int = 0,
                   search: str = "", scenario: str = "") -> tuple[int, list[dict]]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    where = ["1=1"]
    params: list[Any] = []
    if run_id:
        where.append("run_id = %s")
        params.append(run_id)
    if search:
        where.append("(LOWER(patient_name) LIKE %s OR LOWER(patient_id) LIKE %s OR LOWER(document_id) LIKE %s)")
        s = f"%{search.lower()}%"
        params.extend([s, s, s])
    if scenario:
        where.append("scenario = %s")
        params.append(scenario)
    clause = " AND ".join(where)
    cur.execute(f"SELECT COUNT(*) FROM lacare_documents WHERE {clause}", params)
    total = cur.fetchone()[0]
    cur.execute(f"""
        SELECT id, run_id, document_id, document_type, patient_id, patient_name,
               facility, encounter_date, sections, entry_count, narrative_chars,
               scenario, warnings, uploaded_at
        FROM lacare_documents
        WHERE {clause}
        ORDER BY id DESC LIMIT %s OFFSET %s
    """, [*params, limit, offset])
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return total, rows


def get_document(document_id: str) -> dict | None:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT * FROM lacare_documents WHERE document_id=%s
        ORDER BY id DESC LIMIT 1
    """, (document_id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return _serialize(dict(row)) if row else None


def fetch_documents_for_run(run_id: str) -> list[dict]:
    """Full records with parsed_json for the pipeline worker."""
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT id, document_id, document_type, patient_id, patient_name,
               facility, encounter_date, sections, entry_count, narrative_chars,
               scenario, warnings, raw_xml, parsed_json, nlp_json
        FROM lacare_documents WHERE run_id=%s ORDER BY id ASC
    """, (run_id,))
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


def clone_seed_documents_into_run(run_id: str) -> int:
    """Copy existing seed documents (from a previous run marked as 'seed')
    into a new run_id. Returns the count of rows copied.

    Used when the user runs a repeat demo: we keep one seed library in the
    DB and link each run to those documents without duplicating raw XML.
    """
    return 0  # not used for the current demo flow; reserved hook


# --------------------------------------------------------------------------- #
# Hits
# --------------------------------------------------------------------------- #

def insert_hits(run_id: str, hits: list[dict]) -> None:
    if not hits:
        return
    conn = _conn()
    cur = conn.cursor()
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO lacare_hits
          (run_id, document_id, measure, measure_name, patient_id, patient_name,
           satisfied, confidence, evidence_type, source_document_type,
           source_section, summary, numerator_date, denominator_date, extra)
        VALUES (%(run_id)s, %(document_id)s, %(measure)s, %(measure_name)s,
                %(patient_id)s, %(patient_name)s, %(satisfied)s, %(confidence)s,
                %(evidence_type)s, %(source_document_type)s, %(source_section)s,
                %(summary)s, %(numerator_date)s, %(denominator_date)s, %(extra)s::jsonb)
    """, [
        {
            "run_id": run_id,
            "document_id": h.get("source_document_id"),
            "measure": h.get("measure"),
            "measure_name": h.get("measure_name"),
            "patient_id": h.get("patient_id"),
            "patient_name": h.get("patient_name"),
            "satisfied": bool(h.get("satisfied", True)),
            "confidence": float(h.get("confidence", 0) or 0),
            "evidence_type": h.get("evidence_type"),
            "source_document_type": h.get("source_document_type"),
            "source_section": h.get("source_section"),
            "summary": h.get("summary"),
            "numerator_date": h.get("numerator_date"),
            "denominator_date": h.get("denominator_date"),
            "extra": json.dumps({k: v for k, v in h.items() if k not in _HIT_CORE_KEYS}, default=str),
        }
        for h in hits
    ])
    conn.commit()
    cur.close()
    conn.close()


_HIT_CORE_KEYS = {
    "measure", "measure_name", "patient_id", "patient_name", "satisfied",
    "confidence", "evidence_type", "source_document_id", "source_document_type",
    "source_section", "summary", "numerator_date", "denominator_date",
}


def list_hits(run_id: str | None, measure: str = "", patient_id: str = "", limit: int = 1000) -> list[dict]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    where, params = [], []
    if run_id:
        where.append("run_id = %s")
        params.append(run_id)
    if measure:
        where.append("measure = %s")
        params.append(measure)
    if patient_id:
        where.append("patient_id = %s")
        params.append(patient_id)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    cur.execute(f"""
        SELECT * FROM lacare_hits {clause} ORDER BY id DESC LIMIT %s
    """, [*params, limit])
    rows = [_serialize_hit(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


# --------------------------------------------------------------------------- #
# Agent events + logs
# --------------------------------------------------------------------------- #

def upsert_agent(run_id: str, agent: str, status: str, last_action: str, processed: int, duration_ms: int) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_agent_events (run_id, agent, status, last_action, processed, duration_ms, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (run_id, agent) DO UPDATE SET
          status = EXCLUDED.status,
          last_action = EXCLUDED.last_action,
          processed = EXCLUDED.processed,
          duration_ms = EXCLUDED.duration_ms,
          updated_at = NOW()
    """, (run_id, agent, status, last_action, processed, duration_ms))
    conn.commit()
    cur.close()
    conn.close()


def get_agents(run_id: str) -> dict[str, dict]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("SELECT agent, status, last_action, processed, duration_ms FROM lacare_agent_events WHERE run_id=%s", (run_id,))
    rows = {r["agent"]: dict(r) for r in cur.fetchall()}
    cur.close()
    conn.close()
    return rows


def write_log(run_id: str, level: str, message: str, meta: dict | None = None) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_logs (run_id, level, message, meta)
        VALUES (%s, %s, %s, %s::jsonb)
    """, (run_id, level, message, json.dumps(meta or {})))
    conn.commit()
    cur.close()
    conn.close()


def active_run() -> dict | None:
    """Return the currently-active run row, if one exists.

    A run is 'active' while its status is queued or running. The UI +
    pipeline start endpoint use this to enforce one-run-at-a-time.
    """
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT * FROM lacare_runs
        WHERE status IN ('queued', 'running')
        ORDER BY started_at DESC
        LIMIT 1
    """)
    row = cur.fetchone()
    cur.close()
    conn.close()
    return _serialize(dict(row)) if row else None


# --------------------------------------------------------------------------- #
# Step events — per-document per-agent transformation trail
# --------------------------------------------------------------------------- #

def record_step(
    run_id: str,
    document_id: str,
    agent: str,
    step_label: str,
    input_summary: str,
    output_summary: str,
    details: dict | None = None,
    duration_ms: int = 0,
    status: str = "complete",
) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_step_events
          (run_id, document_id, agent, step_label, status,
           input_summary, output_summary, details, duration_ms)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
    """, (run_id, document_id, agent, step_label, status,
          input_summary, output_summary,
          json.dumps(details or {}, default=str), duration_ms))
    conn.commit()
    cur.close()
    conn.close()


def record_steps_batch(events: list[dict]) -> None:
    """Bulk insert — used for high-throughput stages like extraction."""
    if not events:
        return
    conn = _conn()
    cur = conn.cursor()
    psycopg2.extras.execute_batch(cur, """
        INSERT INTO lacare_step_events
          (run_id, document_id, agent, step_label, status,
           input_summary, output_summary, details, duration_ms)
        VALUES (%(run_id)s, %(document_id)s, %(agent)s, %(step_label)s,
                %(status)s, %(input_summary)s, %(output_summary)s,
                %(details)s::jsonb, %(duration_ms)s)
    """, [
        {
            "run_id": e["run_id"],
            "document_id": e["document_id"],
            "agent": e["agent"],
            "step_label": e["step_label"],
            "status": e.get("status", "complete"),
            "input_summary": e.get("input_summary", ""),
            "output_summary": e.get("output_summary", ""),
            "details": json.dumps(e.get("details") or {}, default=str),
            "duration_ms": int(e.get("duration_ms", 0)),
        }
        for e in events
    ])
    conn.commit()
    cur.close()
    conn.close()


def list_steps(run_id: str, document_id: str | None = None, agent: str | None = None,
               limit: int = 500) -> list[dict]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    where = ["run_id = %s"]
    params: list[Any] = [run_id]
    if document_id:
        where.append("document_id = %s")
        params.append(document_id)
    if agent:
        where.append("agent = %s")
        params.append(agent)
    cur.execute(f"""
        SELECT id, run_id, document_id, agent, step_label, status,
               input_summary, output_summary, details, duration_ms, created_at
        FROM lacare_step_events
        WHERE {' AND '.join(where)}
        ORDER BY id ASC
        LIMIT %s
    """, [*params, limit])
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


# --------------------------------------------------------------------------- #
# Sample library — seed-once, reuse-many curated CCDAs
# --------------------------------------------------------------------------- #

def sample_count() -> int:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM lacare_samples")
    row = cur.fetchone()
    cur.close()
    conn.close()
    return int(row[0]) if row else 0


def insert_sample(
    sample_id: str,
    scenario: str,
    scenario_label: str,
    document_type: str,
    patient_id: str,
    patient_name: str,
    facility: str,
    encounter_date: str,
    section_count: int,
    entry_count: int,
    narrative_chars: int,
    expected_measure: str,
    summary: str,
    raw_xml: str,
    parsed_json: dict,
) -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO lacare_samples
          (sample_id, scenario, scenario_label, document_type,
           patient_id, patient_name, facility, encounter_date,
           section_count, entry_count, narrative_chars,
           expected_measure, summary, raw_xml, parsed_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (sample_id) DO NOTHING
    """, (sample_id, scenario, scenario_label, document_type,
          patient_id, patient_name, facility, encounter_date,
          section_count, entry_count, narrative_chars,
          expected_measure, summary, raw_xml,
          json.dumps(parsed_json, default=str)))
    conn.commit()
    cur.close()
    conn.close()


def list_samples(scenario: str = "", document_type: str = "", search: str = "",
                 limit: int = 500, offset: int = 0) -> tuple[int, list[dict]]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    where = ["1=1"]
    params: list[Any] = []
    if scenario:
        where.append("scenario = %s")
        params.append(scenario)
    if document_type:
        where.append("document_type = %s")
        params.append(document_type)
    if search:
        where.append("(LOWER(patient_name) LIKE %s OR LOWER(patient_id) LIKE %s OR LOWER(summary) LIKE %s)")
        s = f"%{search.lower()}%"
        params.extend([s, s, s])
    clause = " AND ".join(where)
    cur.execute(f"SELECT COUNT(*) FROM lacare_samples WHERE {clause}", params)
    total = int(cur.fetchone()[0])
    cur.execute(f"""
        SELECT id, sample_id, scenario, scenario_label, document_type,
               patient_id, patient_name, facility, encounter_date,
               section_count, entry_count, narrative_chars,
               expected_measure, summary, created_at
        FROM lacare_samples
        WHERE {clause}
        ORDER BY id ASC
        LIMIT %s OFFSET %s
    """, [*params, limit, offset])
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return total, rows


def sample_scenario_facets() -> list[dict]:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT scenario, scenario_label, document_type, COUNT(*)
        FROM lacare_samples
        GROUP BY scenario, scenario_label, document_type
        ORDER BY scenario, document_type
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {"scenario": r[0], "scenario_label": r[1], "document_type": r[2], "count": int(r[3])}
        for r in rows
    ]


def fetch_samples_by_ids(sample_ids: list[str]) -> list[dict]:
    if not sample_ids:
        return []
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT sample_id, scenario, scenario_label, document_type,
               patient_id, patient_name, facility, encounter_date,
               section_count, entry_count, narrative_chars,
               raw_xml, parsed_json
        FROM lacare_samples
        WHERE sample_id = ANY(%s)
    """, (sample_ids,))
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


# --------------------------------------------------------------------------- #
# Activity log (HTTP access + pipeline events for client demo)
# --------------------------------------------------------------------------- #

def log_activity(kind: str, method: str = "", path: str = "",
                 status: int = 0, duration_ms: int = 0,
                 actor: str = "", message: str = "") -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO lacare_activity (kind, method, path, status, duration_ms, actor, message)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (kind, method, path, int(status or 0), int(duration_ms or 0), actor, message))
        conn.commit()
        cur.close()
        conn.close()
    except Exception:
        pass  # never let activity logging break a request


def read_activity(limit: int = 150) -> list[dict]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT ts, kind, method, path, status, duration_ms, actor, message
        FROM lacare_activity
        ORDER BY id DESC
        LIMIT %s
    """, (limit,))
    rows = [_serialize(dict(r)) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


def read_logs(run_id: str, limit: int = 200) -> list[dict]:
    conn = _conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute("""
        SELECT ts, level, message, meta
        FROM lacare_logs WHERE run_id=%s
        ORDER BY id DESC LIMIT %s
    """, (run_id, limit))
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return [{"ts": r["ts"].isoformat(), "level": r["level"], "message": r["message"], "meta": r["meta"] or {}} for r in rows]


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #

def wipe_run_data() -> dict:
    """Delete all pipeline run data (runs, documents, hits, logs, step
    events, agent events). Samples in `lacare_samples` are preserved —
    the curated library is meant to be reusable across demo resets.
    """
    conn = _conn()
    cur = conn.cursor()
    tables = [
        "lacare_step_events",
        "lacare_agent_events",
        "lacare_logs",
        "lacare_hits",
        "lacare_documents",
        "lacare_runs",
        "lacare_activity",
    ]
    counts: dict[str, int] = {}
    for t in tables:
        try:
            cur.execute(f"DELETE FROM {t}")
            counts[t] = cur.rowcount
        except Exception as exc:
            counts[t] = -1
    conn.commit()
    cur.close()
    conn.close()
    return counts


def wipe_sample_library() -> int:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM lacare_samples")
    n = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    return n


def _serialize(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if isinstance(v, datetime):
            out[k] = v.astimezone(timezone.utc).isoformat() if v.tzinfo else v.isoformat()
        else:
            out[k] = v
    return out


def _serialize_hit(row: dict) -> dict:
    base = _serialize(row)
    extra = base.pop("extra", None) or {}
    if isinstance(extra, str):
        try:
            extra = json.loads(extra)
        except Exception:
            extra = {}
    base["confidence"] = float(base.get("confidence", 0) or 0)
    base["source_document_id"] = base.get("document_id")
    return {**base, **extra}
