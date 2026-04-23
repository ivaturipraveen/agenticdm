"""Agent 1 - Discovery Agent - dynamic schema-driven FHIR mapping"""
import asyncio
import psycopg2
import decimal as _dec
import datetime as _dt
from typing import Dict, Any, List
from datetime import datetime, timezone
from config import get_settings
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state
from dynamic_fhir_engine import build_mapping_summary, SAMPLE_LIMIT

settings = get_settings()


def _safe(v: Any) -> Any:
    if isinstance(v, (_dt.date, _dt.datetime)):
        return v.isoformat()
    if isinstance(v, _dec.Decimal):
        return float(v)
    return v


async def run_discovery() -> Dict[str, Any]:
    run_id = getattr(pipeline_state, 'run_id', '') or ''
    pipeline_state.update_agent("discovery", "running", "Initializing dynamic schema discovery")
    await ws_manager.send_agent_status("discovery", "running", "Initializing dynamic schema discovery", 0)

    await ws_manager.send_reasoning("discovery", "Connecting to PostgreSQL source database",
                                     "Scanning information_schema for arbitrary public tables", "", run_id=run_id)
    await ws_manager.send_audit_entry(log_entry_sync("discovery", "Connecting to PostgreSQL source database", "pending", run_id=run_id))

    try:
        from platform_db import get_conn
        conn = get_conn()
        cur = conn.cursor()

        # Exclude:
        #   * Agentic DM bookkeeping tables (migration_runs, run_logs, ...)
        #   * Foreign-module tables owned by LA Care / platform auth.
        # Keeping the NOT IN (...) clause for the system tables keeps the
        # discovery SQL self-contained; the foreign-module prefixes are
        # filtered in Python so the filter list is easy to extend.
        cur.execute(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE' "
            "AND table_name NOT IN ('migration_runs', 'run_logs', 'run_agent_outputs', 'fhir_loaded_resources') "
            "AND table_name NOT LIKE 'lacare\\_%' ESCAPE '\\' "
            "AND table_name NOT LIKE 'platform\\_%' ESCAPE '\\' "
            "ORDER BY table_name"
        )
        tables = [r[0] for r in cur.fetchall()]

        await ws_manager.send_reasoning("discovery", "Discovered source tables",
                                         f"Tables found: {', '.join(tables)}", "", run_id=run_id)

        schema_info: Dict[str, Any] = {}
        total_cols = 0
        total_rows = 0

        for table in tables:
            await ws_manager.send_reasoning("discovery", f"Inspecting schema for table: {table}",
                                             "Extracting columns, types, nullability, and sample data", "", run_id=run_id)
            cur.execute(
                "SELECT column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_name=%s AND table_schema='public' "
                "ORDER BY ordinal_position",
                (table,),
            )
            columns = cur.fetchall()
            columns_raw = [
                {"name": c[0], "type": c[1], "nullable": c[2], "default": c[3]}
                for c in columns
            ]
            col_names = [c[0] for c in columns]

            dataset_id = getattr(pipeline_state, 'current_dataset_id', '') or ''
            has_dataset_col = any(c[0] == 'dataset_id' for c in columns)
            use_filter = has_dataset_col and dataset_id and dataset_id != 'default'

            if use_filter:
                cur.execute(f'SELECT COUNT(*) FROM "{table}" WHERE dataset_id=%s', (dataset_id,))
            else:
                cur.execute(f'SELECT COUNT(*) FROM "{table}"')
            count_row = cur.fetchone()
            row_count = count_row[0] if count_row is not None else 0

            if use_filter:
                cur.execute(f'SELECT * FROM "{table}" WHERE dataset_id=%s LIMIT %s', (dataset_id, SAMPLE_LIMIT))
            else:
                cur.execute(f'SELECT * FROM "{table}" LIMIT %s', (SAMPLE_LIMIT,))
            sample_rows_raw = cur.fetchall()

            sample_rows = [{k: _safe(v) for k, v in dict(zip(col_names, row)).items()} for row in sample_rows_raw]
            schema_info[table] = {
                "row_count": row_count,
                "columns": [
                    {"name": c[0], "type": c[1], "nullable": c[2], "default": c[3]}
                    for c in columns
                ],
                "columns_raw": columns_raw,
                "sample_rows": sample_rows,
            }
            total_cols += len(columns)
            total_rows += row_count

            await ws_manager.send_audit_entry(log_entry_sync(
                "discovery", f"Scanned table: {table}", "success", row_count,
                f"{len(columns)} columns, {row_count} rows", run_id=run_id
            ))
            pipeline_state.update_agent("discovery", "running", f"Scanned {table}: {row_count:,} rows", row_count)
            await ws_manager.send_agent_status("discovery", "running", f"Scanned {table}: {row_count:,} rows", row_count)

        api_key = getattr(settings, 'anthropic_api_key', '')
        use_ai = bool(api_key and api_key.strip() and api_key != "your-anthropic-api-key-here")
        mapper_label = "AI mapper" if use_ai else "fuzzy keyword fallback"
        await ws_manager.send_reasoning(
            "discovery", f"Building FHIR mapping using: {mapper_label}",
            "LLM-based mapper selected for intelligent column inference" if use_ai
            else "No LLM key set — using keyword alias + string similarity scoring",
            "", run_id=run_id
        )
        # build_mapping_summary() internally calls the Anthropic SDK
        # synchronously (client.messages.create). Running it directly on the
        # event loop blocks every other request on this worker — which is
        # what caused the 26 s /api/pipeline/start and the WebSocket
        # timeouts we saw on Render Starter. Offload to a worker thread so
        # the event loop stays free to serve /status, /ws and /auth/apps
        # while the LLM round-trips complete.
        mapping_bundle = await asyncio.to_thread(
            build_mapping_summary, schema_info, api_key,
        )

        for item in mapping_bundle["mapping_summary"]:
            auto_count = sum(1 for f in item["fields"] if f["status"] == "auto_mapped")
            review_count = sum(1 for f in item["fields"] if f["status"] == "requires_review")
            ignored_count = sum(1 for f in item["fields"] if f["status"] == "ignored")
            mapped_by = item.get("mapped_by", "fuzzy_fallback")
            await ws_manager.send_reasoning(
                "discovery",
                f"[{mapped_by}] {item['table']} -> {item['resource']} (confidence {item['resource_confidence']})",
                f"Auto-mapped: {auto_count}, review: {review_count}, ignored: {ignored_count}. {', '.join(item['resource_reasoning'][:3])}",
                "", run_id=run_id
            )

        result = {
            "schema": {
                table: {
                    "row_count": info["row_count"],
                    "columns": info["columns"],
                    "sample_rows": info["sample_rows"],
                }
                for table, info in schema_info.items()
            },
            **mapping_bundle,
            "summary": {
                "tables_scanned": len(schema_info),
                "total_columns": total_cols,
                "total_rows": total_rows,
                "auto_mapped_fields": sum(
                    1 for t in mapping_bundle["mapping_summary"] for f in t["fields"] if f["status"] == "auto_mapped"
                ),
                "requires_review_fields": len(mapping_bundle["requires_review"]),
                "ignored_fields": len(mapping_bundle["unmapped_fields"]),
            },
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }
        pipeline_state.schema_mapping = result

        await ws_manager.send_reasoning(
            "discovery", "Dynamic mapping summary generated",
            f"Tables: {result['summary']['tables_scanned']}, rows: {total_rows:,}, auto-mapped fields: {result['summary']['auto_mapped_fields']}, review queue: {result['summary']['requires_review_fields']}",
            "", run_id=run_id
        )
        await ws_manager.send_audit_entry(log_entry_sync(
            "discovery", "Dynamic schema discovery complete", "success", total_rows,
            f"{len(schema_info)} tables, {total_cols} columns, auto={result['summary']['auto_mapped_fields']}, review={result['summary']['requires_review_fields']}",
            run_id=run_id,
        ))
        pipeline_state.update_agent("discovery", "success", f"Done - {total_rows:,} rows analyzed", 0)
        await ws_manager.send_agent_status("discovery", "success", f"Discovery complete: {total_rows:,} rows analyzed", total_rows)
        await ws_manager.send_log_message(
            f"Agent 1 complete - dynamic mapping generated for {len(schema_info)} tables with {result['summary']['auto_mapped_fields']} auto-mapped fields",
            "success", run_id=run_id
        )
        await ws_manager.broadcast("SCHEMA_MAPPING_READY", {"mapping": result})
        return result

    except Exception as e:
        err = log_entry_sync("discovery", "Discovery failed", "failed", 0, str(e), run_id=run_id)
        await ws_manager.send_audit_entry(err)
        pipeline_state.update_agent("discovery", "failed", str(e))
        await ws_manager.send_agent_status("discovery", "failed", str(e), 0)
        await ws_manager.send_log_message(f"Discovery failed: {e}", "error", run_id=run_id)
        raise
