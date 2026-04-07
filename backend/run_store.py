import psycopg2
from datetime import datetime, timezone
from typing import List, Dict, Any
from config import get_settings

settings = get_settings()

DATASET_META = {
    "synthea_standard": "Synthea Standard Cohort",
    "clean_cohort":     "Clean Reference Dataset",
    "high_anomaly":     "High Anomaly Dataset",
    "edge_cases":       "Edge Cases Dataset",
    "medicare_sample":  "Medicare Sample Cohort",
    "medicaid_complex": "Medicaid Complex Dataset",
}


def _conn():
    return psycopg2.connect(settings.sync_database_url)


def create_run(run_id: str, dataset_id: str) -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO migration_runs
              (run_id, dataset_id, dataset_name, started_at, status)
            VALUES (%s, %s, %s, NOW(), 'running')
            ON CONFLICT (run_id) DO NOTHING
        """, (run_id, dataset_id, DATASET_META.get(dataset_id, dataset_id)))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] create_run error: {e}")


def update_run_stage(run_id: str, stage: str) -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("UPDATE migration_runs SET status=%s WHERE run_id=%s",
                    (f"running:{stage.lower()}", run_id))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] update_run_stage error: {e}")


def complete_run(run_id: str, dataset_id: str, total_source: int, total_loaded: int,
                 anomaly_count: int, violation_count: int, match_pct: float,
                 compliance: Dict[str, Any]) -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE migration_runs SET
              completed_at=NOW(), status='complete',
              total_source=%s, total_loaded=%s,
              anomaly_count=%s, violation_count=%s, match_pct=%s,
              compliance_score=%s, fhir_completeness=%s,
              icd10_compliance=%s, npi_validity=%s, hipaa_score=%s
            WHERE run_id=%s
        """, (total_source, total_loaded, anomaly_count, violation_count, match_pct,
              compliance.get('overall_score', 0), compliance.get('fhir_completeness', 0),
              compliance.get('icd10_compliance', 0), compliance.get('npi_validity', 0),
              compliance.get('hipaa_score', 0), run_id))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] complete_run error: {e}")


def fail_run(run_id: str, error: str) -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            UPDATE migration_runs SET completed_at=NOW(), status='failed', notes=%s
            WHERE run_id=%s
        """, (error[:500], run_id))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] fail_run error: {e}")


def append_log(run_id: str, agent: str, action: str, status: str,
               records_affected: int = 0, details: str = "",
               log_type: str = "audit", emoji: str = "", step_title: str = "") -> None:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO run_logs (run_id, agent, action, status, records_affected, details, log_type, emoji, step_title)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (run_id, agent, action, status, records_affected, details, log_type,
              emoji or None, step_title or None))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] append_log error: {e}")


def save_agent_output(run_id: str, agent: str, agent_num: int, status: str,
                      records_in: int, records_out: int, anomalies: int,
                      summary: str, output_data: dict) -> None:
    import json as _json
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO run_agent_outputs
              (run_id, agent, agent_num, status, records_in, records_out, anomalies, summary, output_json)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT DO NOTHING
        """, (run_id, agent, agent_num, status, records_in, records_out, anomalies,
              summary, _json.dumps(output_data, default=str)))
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[run_store] save_agent_output error: {e}")


def get_run_logs(run_id: str) -> List[Dict[str, Any]]:
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT ts, agent, action, status, records_affected, details, log_type, emoji, step_title
            FROM run_logs WHERE run_id=%s ORDER BY id ASC
        """, (run_id,))
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [{"timestamp": r[0].isoformat(), "agent": r[1], "action": r[2],
                 "status": r[3], "records_affected": r[4], "details": r[5],
                 "log_type": r[6], "emoji": r[7], "step_title": r[8]}
                for r in rows]
    except Exception as e:
        print(f"[run_store] get_run_logs error: {e}")
        return []


def get_agent_outputs(run_id: str) -> List[Dict[str, Any]]:
    import json as _json
    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT agent, agent_num, status, records_in, records_out, anomalies, summary, output_json, completed_at
            FROM run_agent_outputs WHERE run_id=%s ORDER BY agent_num
        """, (run_id,))
        rows = []
        for r in cur.fetchall():
            rows.append({"agent": r[0], "agent_num": r[1], "status": r[2],
                         "records_in": r[3], "records_out": r[4], "anomalies": r[5],
                         "summary": r[6],
                         "output": _json.loads(r[7]) if r[7] else {},
                         "completed_at": r[8].isoformat() if r[8] else None})
        cur.close()
        conn.close()
        return rows
    except Exception as e:
        print(f"[run_store] get_agent_outputs error: {e}")
        return []


def get_all_runs() -> List[Dict[str, Any]]:
    import decimal
    import datetime as dt

    def s(v):
        if isinstance(v, (dt.date, dt.datetime)):
            return v.isoformat()
        if isinstance(v, decimal.Decimal):
            return float(v)
        return v

    try:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT run_id, dataset_id, dataset_name, started_at, completed_at, status,
                   total_source, total_loaded, anomaly_count, violation_count,
                   match_pct, compliance_score, fhir_completeness,
                   icd10_compliance, npi_validity, hipaa_score, notes
            FROM migration_runs ORDER BY started_at DESC LIMIT 50
        """)
        cols = [d[0] for d in cur.description]
        rows = [{cols[i]: s(v) for i, v in enumerate(row)} for row in cur.fetchall()]
        cur.close()
        conn.close()
        return rows
    except Exception as e:
        print(f"[run_store] get_all_runs error: {e}")
        return []
