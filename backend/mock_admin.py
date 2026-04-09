import psycopg2
from config import get_settings

settings = get_settings()


def trigger_schema_drift() -> dict:
    conn = psycopg2.connect(settings.sync_database_url)
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE claims ADD COLUMN IF NOT EXISTS drift_probe_text TEXT")
        conn.commit()
        return {"status": "drift_triggered", "change": "claims.drift_probe_text added"}
    finally:
        cur.close()
        conn.close()


def clear_schema_drift() -> dict:
    conn = psycopg2.connect(settings.sync_database_url)
    cur = conn.cursor()
    try:
        cur.execute("ALTER TABLE claims DROP COLUMN IF EXISTS drift_probe_text")
        conn.commit()
        return {"status": "drift_cleared", "change": "claims.drift_probe_text removed"}
    finally:
        cur.close()
        conn.close()
