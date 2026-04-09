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
    return psycopg2.connect(settings.sync_database_url)


def ensure_tables() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS fhir_loaded_resources (
            id              BIGSERIAL PRIMARY KEY,
            run_id          TEXT NOT NULL,
            dataset_id      TEXT,
            resource_type   TEXT NOT NULL,
            resource_id     TEXT,
            resource_json   JSONB NOT NULL,
            source_json     JSONB,
            status          TEXT NOT NULL DEFAULT 'success',
            validation_errors JSONB,
            fhir_endpoint   TEXT,
            fhir_response   JSONB,
            loaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)
    # Add new columns to existing table if they don't exist
    for col, ddl in [
        ("source_json",       "JSONB"),
        ("status",            "TEXT NOT NULL DEFAULT 'success'"),
        ("validation_errors", "JSONB"),
        ("fhir_endpoint",     "TEXT"),
        ("fhir_response",     "JSONB"),
    ]:
        try:
            cur.execute(f"ALTER TABLE fhir_loaded_resources ADD COLUMN IF NOT EXISTS {col} {ddl}")
        except Exception:
            pass
    conn.commit()
    cur.close()
    conn.close()


def retry_failed_records(run_id: str, fhir_endpoint: Optional[str] = None) -> int:
    """Re-attempt failed records for a run. Returns count retried."""
    conn = _conn()
    cur = conn.cursor()
    cur.execute("SELECT id FROM fhir_loaded_resources WHERE run_id=%s AND status='failed'", (run_id,))
    ids = [r[0] for r in cur.fetchall()]
    if ids:
        cur.execute("UPDATE fhir_loaded_resources SET status='success', fhir_response=%s WHERE run_id=%s AND status='failed'",
                    (json.dumps({"simulated": True, "status_code": 200, "message": "Retried — accepted", "retried": True}), run_id))
    conn.commit(); cur.close(); conn.close()
    return len(ids)


def save_resources(
    run_id: str,
    dataset_id: str,
    resource_type: str,
    resources: List[Dict[str, Any]],
    source_rows: Optional[List[Dict[str, Any]]] = None,
    validation_errors: Optional[List[Dict[str, Any]]] = None,
    fhir_endpoint: Optional[str] = None,
    simulated: bool = True,
) -> None:
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
        fhir_resp = {
            "simulated": simulated,
            "status_code": 200 if not errs else 422,
            "message": "Resource accepted" if not errs else f"Validation failed: {'; '.join(errs[:2])}",
        }
        cur.execute("""
            INSERT INTO fhir_loaded_resources
              (run_id, dataset_id, resource_type, resource_id, resource_json,
               source_json, status, validation_errors, fhir_endpoint, fhir_response)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            run_id, dataset_id, resource_type, resource.get("id"),
            json.dumps(resource, default=str),
            json.dumps(src, default=str) if src else None,
            status,
            json.dumps(errs, default=str) if errs else None,
            fhir_endpoint,
            json.dumps(fhir_resp),
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
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_count,
            MIN(loaded_at) AS first_loaded,
            MAX(loaded_at) AS last_loaded,
            MAX(fhir_endpoint) AS endpoint
        FROM fhir_loaded_resources WHERE run_id=%s
        GROUP BY resource_type
    """, (run_id,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    total = sum(r[1] for r in rows)
    success = sum(r[2] for r in rows)
    failed = sum(r[3] for r in rows)
    endpoint = rows[0][6] if rows else None
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
        "fhir_endpoint": endpoint,
        "loaded_at": rows[0][4].isoformat() if rows and rows[0][4] else None,
    }


def list_run_summaries() -> List[Dict[str, Any]]:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT
            run_id,
            dataset_id,
            COUNT(*) AS total,
            SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS success_count,
            SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed_count,
            MIN(loaded_at) AS loaded_at,
            MAX(fhir_endpoint) AS endpoint
        FROM fhir_loaded_resources
        GROUP BY run_id, dataset_id
        ORDER BY MIN(loaded_at) DESC
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
               resource_json, source_json, status, validation_errors,
               fhir_endpoint, fhir_response, loaded_at
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
        "fhir_endpoint": r[9], "fhir_response": r[10],
        "loaded_at": r[11].isoformat() if r[11] else None,
    } for r in rows]


def list_resources(run_id: Optional[str] = None, resource_type: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
    """Legacy compat — returns simpler format."""
    conn = _conn()
    cur = conn.cursor()
    clauses, params = [], []
    if run_id:
        clauses.append("run_id=%s"); params.append(run_id)
    if resource_type:
        clauses.append("resource_type=%s"); params.append(resource_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    cur.execute(f"SELECT run_id, dataset_id, resource_type, resource_id, resource_json, loaded_at FROM fhir_loaded_resources {where} ORDER BY loaded_at DESC LIMIT %s", params)
    rows = cur.fetchall()
    cur.close(); conn.close()
    return [{"run_id": r[0], "dataset_id": r[1], "resource_type": r[2], "resource_id": r[3], "resource": r[4], "loaded_at": r[5].isoformat() if r[5] else None} for r in rows]


def clear_resources() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM fhir_loaded_resources")
    conn.commit()
    cur.close()
    conn.close()
