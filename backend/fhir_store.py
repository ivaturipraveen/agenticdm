import json
import psycopg2
from typing import Any, Dict, List
from config import get_settings

settings = get_settings()


def _conn():
    return psycopg2.connect(settings.sync_database_url)


def ensure_tables() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS fhir_loaded_resources (
            id BIGSERIAL PRIMARY KEY,
            run_id TEXT NOT NULL,
            dataset_id TEXT,
            resource_type TEXT NOT NULL,
            resource_id TEXT,
            resource_json JSONB NOT NULL,
            loaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    conn.commit()
    cur.close()
    conn.close()


def save_resources(run_id: str, dataset_id: str, resource_type: str, resources: List[Dict[str, Any]]) -> None:
    if not resources:
        return
    conn = _conn()
    cur = conn.cursor()
    for resource in resources:
        cur.execute(
            """
            INSERT INTO fhir_loaded_resources (run_id, dataset_id, resource_type, resource_id, resource_json)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (run_id, dataset_id, resource_type, resource.get("id"), json.dumps(resource, default=str)),
        )
    conn.commit()
    cur.close()
    conn.close()


def list_resources(run_id: str | None = None, resource_type: str | None = None, limit: int = 100) -> List[Dict[str, Any]]:
    conn = _conn()
    cur = conn.cursor()
    clauses = []
    params: List[Any] = []
    if run_id:
        clauses.append("run_id=%s")
        params.append(run_id)
    if resource_type:
        clauses.append("resource_type=%s")
        params.append(resource_type)
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
    params.append(limit)
    cur.execute(
        f"SELECT run_id, dataset_id, resource_type, resource_id, resource_json, loaded_at FROM fhir_loaded_resources {where} ORDER BY loaded_at DESC LIMIT %s",
        params,
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "run_id": r[0],
            "dataset_id": r[1],
            "resource_type": r[2],
            "resource_id": r[3],
            "resource": r[4],
            "loaded_at": r[5].isoformat() if r[5] else None,
        }
        for r in rows
    ]


def clear_resources() -> None:
    conn = _conn()
    cur = conn.cursor()
    cur.execute("DELETE FROM fhir_loaded_resources")
    conn.commit()
    cur.close()
    conn.close()
