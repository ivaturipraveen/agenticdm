"""
FHIR resource store — persists every resource posted to the FHIR endpoint
along with its source row, validation status, and simulated endpoint response.
"""
import json
import psycopg2
from typing import Any, Dict, List, Optional
from config import get_settings

settings = get_settings()


def _conn():
    """Return a pooled psycopg2 connection. Callers must `.close()` to
    release back to the pool; .close() is intercepted by the pool
    wrapper so the socket stays open."""
    from platform_db import get_conn
    return get_conn()


def ensure_tables() -> None:
    conn = _conn()
    cur = conn.cursor()

    # --- System tables for pipeline run tracking ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS migration_runs (
            run_id          TEXT PRIMARY KEY,
            dataset_id      TEXT,
            dataset_name    TEXT,
            started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at    TIMESTAMPTZ,
            status          TEXT NOT NULL DEFAULT 'running',
            total_source    INTEGER DEFAULT 0,
            total_loaded    INTEGER DEFAULT 0,
            anomaly_count   INTEGER DEFAULT 0,
            violation_count INTEGER DEFAULT 0,
            match_pct       NUMERIC(6,2) DEFAULT 0,
            compliance_score NUMERIC(6,2) DEFAULT 0,
            fhir_completeness NUMERIC(6,2) DEFAULT 0,
            icd10_compliance  NUMERIC(6,2) DEFAULT 0,
            npi_validity      NUMERIC(6,2) DEFAULT 0,
            hipaa_score       NUMERIC(6,2) DEFAULT 0,
            notes           TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS run_logs (
            id              BIGSERIAL PRIMARY KEY,
            run_id          TEXT NOT NULL,
            ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            agent           TEXT,
            action          TEXT,
            status          TEXT,
            records_affected INTEGER DEFAULT 0,
            details         TEXT,
            log_type        TEXT DEFAULT 'audit',
            emoji           TEXT,
            step_title      TEXT
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS run_agent_outputs (
            id              BIGSERIAL PRIMARY KEY,
            run_id          TEXT NOT NULL,
            agent           TEXT NOT NULL,
            agent_num       INTEGER,
            status          TEXT,
            records_in      INTEGER DEFAULT 0,
            records_out     INTEGER DEFAULT 0,
            anomalies       INTEGER DEFAULT 0,
            summary         TEXT,
            output_json     JSONB,
            completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (run_id, agent)
        )
    """)

    # --- FHIR resources table: one row per converted FHIR resource ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fhir_loaded_resources (
            id                BIGSERIAL PRIMARY KEY,
            run_id            TEXT NOT NULL,
            dataset_id        TEXT,
            resource_type     TEXT NOT NULL,
            resource_id       TEXT,
            resource_json     JSONB NOT NULL,
            source_json       JSONB,
            status            TEXT NOT NULL DEFAULT 'success',
            validation_errors JSONB,
            loaded_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # --- FHIR endpoint calls: one row per bundle POST to the FHIR server ---
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fhir_endpoint_calls (
            id              BIGSERIAL PRIMARY KEY,
            run_id          TEXT NOT NULL,
            dataset_id      TEXT,
            resource_type   TEXT NOT NULL,
            endpoint_url    TEXT NOT NULL,
            http_status     INTEGER,
            resource_count  INTEGER DEFAULT 0,
            success         BOOLEAN NOT NULL DEFAULT FALSE,
            simulated       BOOLEAN NOT NULL DEFAULT FALSE,
            response_json   JSONB,
            called_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    # Migrate: add source_json/status/validation_errors to existing fhir_loaded_resources if absent
    for col, ddl in [
        ("source_json",       "JSONB"),
        ("status",            "TEXT NOT NULL DEFAULT 'success'"),
        ("validation_errors", "JSONB"),
    ]:
        try:
            cur.execute(f"ALTER TABLE fhir_loaded_resources ADD COLUMN IF NOT EXISTS {col} {ddl}")
        except Exception:
            pass

    # Remove legacy columns fhir_endpoint and fhir_response from fhir_loaded_resources
    # (this data now lives in fhir_endpoint_calls)
    for col in ("fhir_endpoint", "fhir_response"):
        try:
            cur.execute(f"ALTER TABLE fhir_loaded_resources DROP COLUMN IF EXISTS {col}")
        except Exception:
            pass

    conn.commit()
    cur.close()
    conn.close()


def retry_failed_records(run_id: str) -> int:
    """Mark failed records as retried. Returns count updated."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM fhir_loaded_resources WHERE run_id=%s AND status='failed'", (run_id,))
    row = cur.fetchone()
    count = row[0] if row else 0
    if count:
        cur.execute(
            "UPDATE fhir_loaded_resources SET status='retried' WHERE run_id=%s AND status='failed'",
            (run_id,),
        )
    conn.commit()
    cur.close()
    conn.close()
    return count


def log_endpoint_call(
    run_id: str,
    dataset_id: str,
    resource_type: str,
    endpoint_url: str,
    http_status: Optional[int],
    resource_count: int,
    success: bool,
    simulated: bool,
    response_body: Optional[Dict[str, Any]] = None,
) -> None:
    """Record every FHIR endpoint POST attempt in fhir_endpoint_calls."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO fhir_endpoint_calls
          (run_id, dataset_id, resource_type, endpoint_url,
           http_status, resource_count, success, simulated, response_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        run_id, dataset_id, resource_type, endpoint_url,
        http_status, resource_count, success, simulated,
        json.dumps(response_body, default=str) if response_body else None,
    ))
    conn.commit()
    cur.close()
    conn.close()


def save_resources(
    run_id: str,
    dataset_id: str,
    resource_type: str,
    resources: List[Dict[str, Any]],
    source_rows: Optional[List[Dict[str, Any]]] = None,
    validation_errors: Optional[List[Dict[str, Any]]] = None,
) -> None:
    """Persist converted FHIR resources to fhir_loaded_resources."""
    if not resources:
        return
    conn = _conn()
    cur = conn.cursor()
    err_by_idx: Dict[int, List[str]] = {}
    for e in (validation_errors or []):
        idx = e.get("record_index", -1)
        err_by_idx.setdefault(idx, []).extend(e.get("errors", []))

    for i, resource in enumerate(resources):
        src = source_rows[i] if source_rows and i < len(source_rows) else None
        errs = err_by_idx.get(i)
        status = "failed" if errs else "success"
        cur.execute("""
            INSERT INTO fhir_loaded_resources
              (run_id, dataset_id, resource_type, resource_id,
               resource_json, source_json, status, validation_errors)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            run_id, dataset_id, resource_type, resource.get("id"),
            json.dumps(resource, default=str),
            json.dumps(src, default=str) if src else None,
            status,
            json.dumps(errs, default=str) if errs else None,
        ))
    conn.commit()
    cur.close()
    conn.close()


def get_run_summary(run_id: str) -> Dict[str, Any]:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            resource_type,
            COUNT(*) AS total,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status IN ('failed') THEN 1 ELSE 0 END) AS failed_count,
            MIN(loaded_at) AS first_loaded,
            MAX(loaded_at) AS last_loaded
        FROM fhir_loaded_resources WHERE run_id=%s
        GROUP BY resource_type
    """, (run_id,))
    rows = cur.fetchall()

    # Get endpoint info from the dedicated calls table
    cur.execute(
        "SELECT DISTINCT endpoint_url FROM fhir_endpoint_calls WHERE run_id=%s LIMIT 1",
        (run_id,),
    )
    ep_row = cur.fetchone()
    cur.close()
    conn.close()

    total = sum(r[1] for r in rows)
    success = sum(r[2] for r in rows)
    failed = sum(r[3] for r in rows)
    return {
        "run_id": run_id,
        "total": total,
        "success": success,
        "failed": failed,
        "by_type": [
            {"resource_type": r[0], "total": r[1], "success": r[2], "failed": r[3]}
            for r in rows
        ],
        "status": "success" if failed == 0 and total > 0 else ("partial" if success > 0 else "failed"),
        "fhir_endpoint": ep_row[0] if ep_row else None,
        "loaded_at": rows[0][4].isoformat() if rows and rows[0][4] else None,
    }


def list_run_summaries() -> List[Dict[str, Any]]:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            r.run_id,
            r.dataset_id,
            COUNT(*) AS total,
            SUM(CASE WHEN r.status='success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END) AS failed_count,
            MIN(r.loaded_at) AS loaded_at,
            MAX(e.endpoint_url) AS endpoint
        FROM fhir_loaded_resources r
        LEFT JOIN fhir_endpoint_calls e ON e.run_id = r.run_id
        GROUP BY r.run_id, r.dataset_id
        ORDER BY MIN(r.loaded_at) DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    result = []
    for r in rows:
        total, success, failed = r[2], r[3], r[4]
        result.append({
            "run_id": r[0],
            "dataset_id": r[1],
            "total": total,
            "success": success,
            "failed": failed,
            "status": "success" if failed == 0 and total > 0 else ("partial" if success > 0 else "failed"),
            "loaded_at": r[5].isoformat() if r[5] else None,
            "fhir_endpoint": r[6],
        })
    return result


def list_records(
    run_id: str,
    resource_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    conn = _conn()
    cur = conn.cursor()
    clauses = ["run_id=%s"]
    params: List[Any] = [run_id]
    if resource_type:
        clauses.append("resource_type=%s")
        params.append(resource_type)
    if status:
        clauses.append("status=%s")
        params.append(status)
    params.append(limit)
    cur.execute(f"""
        SELECT id, run_id, dataset_id, resource_type, resource_id,
               resource_json, source_json, status, validation_errors, loaded_at
        FROM fhir_loaded_resources
        WHERE {' AND '.join(clauses)}
        ORDER BY id ASC LIMIT %s
    """, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [{
        "id": r[0], "run_id": r[1], "dataset_id": r[2],
        "resource_type": r[3], "resource_id": r[4],
        "resource": r[5], "source": r[6],
        "status": r[7], "validation_errors": r[8],
        "loaded_at": r[9].isoformat() if r[9] else None,
    } for r in rows]



def clear_resources() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM fhir_loaded_resources")
    conn.commit()
    cur.close()
    conn.close()
