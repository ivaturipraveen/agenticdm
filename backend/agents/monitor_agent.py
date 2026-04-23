"""Agent 5 - Integration Monitor Agent"""
import asyncio
import psycopg2
from typing import Dict, List, Any
from datetime import datetime, timezone
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state, Stage
from config import get_settings

settings = get_settings()
WATCH_INTERVAL = 30
_schema_snapshot: Dict[str, Dict[str, str]] = {}
_running = False

# System/metadata tables that should never be monitored for schema drift
SYSTEM_TABLES = frozenset({
    "migration_runs", "run_logs", "run_agent_outputs",
    "fhir_loaded_resources",
})
# Tables owned by other modules that share this Postgres (LA Care, platform
# auth). Schema drift on those is irrelevant to Agentic DM's pipeline.
FOREIGN_TABLE_PREFIXES: tuple = ("lacare_", "platform_")
KNOWN_COLUMNS = {"dataset_id", "created_at"}


def _is_source_table(name: str) -> bool:
    if name in SYSTEM_TABLES:
        return False
    return not any(name.startswith(p) for p in FOREIGN_TABLE_PREFIXES)


def _get_source_tables(conn) -> List[str]:
    """Dynamically discover Agentic DM source tables only.

    Excludes internal bookkeeping tables and tables owned by other modules
    (lacare_*, platform_*) that share this Postgres.
    """
    cur = conn.cursor()
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE' "
        "ORDER BY table_name"
    )
    tables = [r[0] for r in cur.fetchall() if _is_source_table(r[0])]
    cur.close()
    return tables


def _get_current_schema() -> Dict[str, Dict[str, str]]:
    snapshot: Dict[str, Dict[str, str]] = {}
    try:
        from platform_db import get_conn
        conn = get_conn()
        tables = _get_source_tables(conn)
        cur = conn.cursor()
        for table in tables:
            cur.execute(
                "SELECT column_name, data_type FROM information_schema.columns "
                "WHERE table_name=%s AND table_schema='public' ORDER BY ordinal_position",
                (table,),
            )
            snapshot[table] = {r[0]: r[1] for r in cur.fetchall()}
        cur.close()
        conn.close()
    except Exception as e:
        snapshot["_error"] = {"error": str(e)}
    return snapshot


def _diff_schemas(old: Dict[str, Dict[str, str]], new: Dict[str, Dict[str, str]]) -> List[Dict[str, Any]]:
    changes = []
    for table in set(list(old.keys()) + list(new.keys())):
        if table.startswith("_"):
            continue
        old_cols = old.get(table, {})
        new_cols = new.get(table, {})
        for col in set(new_cols) - set(old_cols):
            if col not in KNOWN_COLUMNS:
                changes.append({"table": table, "change_type": "added", "column": col, "new_type": new_cols[col]})
        for col in set(old_cols) - set(new_cols):
            if col not in KNOWN_COLUMNS:
                changes.append({"table": table, "change_type": "removed", "column": col, "old_type": old_cols[col]})
        # Detect new tables appearing
        if table not in old and table in new:
            changes.append({"table": table, "change_type": "table_added", "column": None, "new_type": None})
        elif table in old and table not in new:
            changes.append({"table": table, "change_type": "table_removed", "column": None, "old_type": None})
    return changes


def _propose_mapping(changes: List[Dict[str, Any]]) -> Dict[str, str]:
    removed = [c for c in changes if c["change_type"] == "removed"]
    added   = [c for c in changes if c["change_type"] == "added"]
    mapping: Dict[str, str] = {}
    if len(removed) == len(added) == 1:
        mapping[removed[0]["column"]] = f"RENAMED -> {added[0]['column']}"
        mapping[added[0]["column"]]   = f"RENAMED FROM {removed[0]['column']}"
    else:
        for r in removed:
            if r["column"]:
                mapping[r["column"]] = "REMOVED - update mapping required"
        for a in added:
            if a["column"]:
                mapping[a["column"]] = f"NEW COLUMN ({a.get('new_type','unknown')}) - add to mapping"
    return mapping


async def start_monitor() -> None:
    global _schema_snapshot, _running
    _running = True

    pipeline_state.update_agent("monitor", "watching", "Initializing schema snapshot")
    await ws_manager.send_agent_status("monitor", "watching", "Initializing schema snapshot", 0)

    loop = asyncio.get_event_loop()
    _schema_snapshot = await loop.run_in_executor(None, _get_current_schema)

    watched = [t for t in _schema_snapshot if not t.startswith("_")]
    entry = log_entry_sync("monitor", "Schema snapshot initialized", "success", 0,
                            f"Watching {len(watched)} tables every {WATCH_INTERVAL}s: {', '.join(watched)}")
    await ws_manager.send_audit_entry(entry)

    run_id = getattr(pipeline_state, 'run_id', '') or ''
    await ws_manager.send_reasoning("monitor",
        f"Schema snapshot taken - {len(watched)} tables tracked",
        ', '.join(f"{t}: {len(c)} cols" for t, c in _schema_snapshot.items() if not t.startswith('_')),
        "", run_id=run_id)

    while _running:
        await asyncio.sleep(WATCH_INTERVAL)
        await _check_schema()


async def _check_schema() -> None:
    global _schema_snapshot
    loop = asyncio.get_event_loop()
    current = await loop.run_in_executor(None, _get_current_schema)
    if "_error" in current:
        return
    changes = _diff_schemas(_schema_snapshot, current)
    ts = datetime.now(timezone.utc).strftime('%H:%M:%S UTC')
    run_id = getattr(pipeline_state, 'run_id', '') or ''

    if not changes:
        watched = [t for t in current if not t.startswith("_")]
        msg = f"Schema check OK at {ts} - no drift detected across {len(watched)} tables"
        pipeline_state.update_agent("monitor", "watching", msg)
        await ws_manager.send_agent_status("monitor", "watching", msg, 0)
        await ws_manager.send_reasoning("monitor", f"Schema check passed at {ts}",
            f"Watching: {', '.join(f'{t}({len(c)} cols)' for t, c in current.items() if not t.startswith('_'))}",
            "", run_id=run_id)
        return

    change_summary = "; ".join([
        f"{c['change_type'].upper()} {c['table']}.{c['column']}" if c.get('column')
        else f"{c['change_type'].upper()} {c['table']}"
        for c in changes
    ])
    proposed = _propose_mapping(changes)

    entry = log_entry_sync("monitor", "SCHEMA_DRIFT_DETECTED", "failed", 0, change_summary)
    await ws_manager.send_audit_entry(entry)
    pipeline_state.update_agent("monitor", "failed", f"DRIFT: {change_summary}")
    await ws_manager.send_agent_status("monitor", "failed", f"Schema drift: {change_summary}", 0)

    if pipeline_state.current_stage not in (Stage.IDLE, Stage.COMPLETE, Stage.HALTED):
        await pipeline_state.halt()
        await ws_manager.send_audit_entry(
            log_entry_sync("monitor", "Pipeline halted due to schema drift", "failed", 0, change_summary)
        )

    await ws_manager.broadcast("SCHEMA_DRIFT", {
        "column_changes": changes,
        "proposed_mapping": proposed,
        "details": change_summary,
    })
    await ws_manager.send_log_message(f"Schema drift: {change_summary}", "error")
    _schema_snapshot = current


async def stop_monitor() -> None:
    global _running
    _running = False
