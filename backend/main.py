import asyncio
import json
import decimal
import datetime
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from config import get_settings
from audit_log import get_all_logs, export_pdf
from pipeline_state import pipeline_state, Stage
from websocket_manager import ws_manager
from agents.orchestration_agent import run_pipeline
from agents.monitor_agent import start_monitor

settings = get_settings()
app = FastAPI(title="Brightcone Migration Platform", version="3.0.0")

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


def _jsonable(obj):
    if isinstance(obj, (datetime.date, datetime.datetime)):
        return obj.isoformat()
    if isinstance(obj, decimal.Decimal):
        return float(obj)
    return str(obj)


def _clean_rows(rows):
    return [
        {k: _jsonable(v) if v is not None and not isinstance(v, (str, int, float, bool)) else v
         for k, v in r.items()}
        for r in rows
    ]


# WebSocket
@app.websocket("/ws")
async def ws_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        await websocket.send_text(json.dumps({
            "type": "PIPELINE_STAGE_CHANGE",
            "stage": pipeline_state.current_stage.value,
            "run_id": pipeline_state.run_id or "",
        }))
        for name, data in pipeline_state.agent_statuses.items():
            await websocket.send_text(json.dumps({
                "type": "AGENT_STATUS", "agent": name, "status": data["status"],
                "last_action": data["last_action"], "records_processed": data["records_processed"],
                "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }))
        for entry in get_all_logs():
            await websocket.send_text(json.dumps({"type": "AUDIT_LOG_ENTRY", "entry": entry}))
        if pipeline_state.reconciliation:
            await websocket.send_text(json.dumps({"type": "RECONCILIATION_COMPLETE", "report": pipeline_state.reconciliation}))
        if pipeline_state.schema_mapping:
            await websocket.send_text(json.dumps({"type": "SCHEMA_MAPPING_READY", "mapping": pipeline_state.schema_mapping}))
        from run_store import get_all_runs
        await websocket.send_text(json.dumps({"type": "RUNS_UPDATED", "runs": get_all_runs()}))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(websocket)
    except Exception:
        await ws_manager.disconnect(websocket)


DATASET_META = {
    "synthea_standard":  {"name": "Synthea Standard Cohort",  "description": "150 members - mixed quality - ~15% malformed ICD-10 - standard baseline",   "badge": "Standard",  "color": "blue"   },
    "clean_cohort":      {"name": "Clean Reference Dataset",  "description": "100 members - fully valid - 0% anomalies - ideal for benchmarking",          "badge": "Clean",     "color": "emerald"},
    "high_anomaly":      {"name": "High Anomaly Dataset",     "description": "80 members - 35% bad ICD-10 - 10% missing NPIs - stress test",               "badge": "Stress",    "color": "red"    },
    "edge_cases":        {"name": "Edge Cases Dataset",       "description": "60 members - boundary values - mixed formats - QA validation",                "badge": "Edge QA",   "color": "amber"  },
    "medicare_sample":   {"name": "Medicare Sample Cohort",  "description": "120 members - realistic Medicare data - 8% ICD-10 issues - production-like",  "badge": "Medicare",  "color": "blue"   },
    "medicaid_complex":  {"name": "Medicaid Complex Dataset", "description": "90 members - 40% bad ICD-10 - 15% missing NPIs - compliance stress test",   "badge": "Medicaid",  "color": "red"    },
}


@app.get("/api/datasets")
async def get_datasets():
    import psycopg2
    try:
        conn = psycopg2.connect(settings.sync_database_url)
        cur = conn.cursor()
        result = []
        for ds_id, meta in DATASET_META.items():
            cur.execute("SELECT COUNT(*) FROM members WHERE dataset_id=%s", (ds_id,))
            mc = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM eligibility WHERE dataset_id=%s", (ds_id,))
            ec = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM claims WHERE dataset_id=%s", (ds_id,))
            cc = cur.fetchone()[0]
            result.append({**meta, "id": ds_id, "members": mc, "eligibility": ec, "claims": cc, "total": mc+ec+cc})
        cur.close()
        conn.close()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.get("/api/datasets/{dataset_id}/preview")
async def dataset_preview(dataset_id: str):
    import psycopg2, psycopg2.extras
    try:
        conn = psycopg2.connect(settings.sync_database_url)
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        result = {}
        for table in ["members", "eligibility", "claims"]:
            cur.execute(f'SELECT COUNT(*) FROM "{table}" WHERE dataset_id=%s', (dataset_id,))
            count = cur.fetchone()[0]
            cur.execute(f'SELECT * FROM "{table}" WHERE dataset_id=%s LIMIT 8', (dataset_id,))
            rows = _clean_rows([dict(r) for r in cur.fetchall()])
            cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=%s AND table_schema='public' ORDER BY ordinal_position", (table,))
            cols = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
            result[table] = {"count": count, "columns": cols, "sample": rows}
        cur.close()
        conn.close()
        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/pipeline/start")
async def start_pipeline(background_tasks: BackgroundTasks, dataset_id: str = "synthea_standard"):
    if pipeline_state.current_stage not in (Stage.IDLE, Stage.COMPLETE, Stage.HALTED):
        return JSONResponse({"error": "Pipeline already running", "stage": pipeline_state.current_stage.value}, status_code=409)
    pipeline_state.current_dataset_id = dataset_id
    for agent in pipeline_state.agent_statuses:
        if agent != "monitor":
            pipeline_state.agent_statuses[agent] = {"status": "idle", "last_action": "", "records_processed": 0, "last_active": None}

    async def _run():
        from agents.discovery_agent import run_discovery
        from run_store import create_run as _create_run
        pre_run_id = str(uuid.uuid4())
        pipeline_state.run_id = pre_run_id
        _create_run(pre_run_id, dataset_id)
        await run_discovery()
        await run_pipeline()

    background_tasks.add_task(_run)
    return JSONResponse({"status": "started", "dataset_id": dataset_id})


@app.post("/api/pipeline/approve")
async def approve():
    if pipeline_state.current_stage != Stage.AWAITING_APPROVAL:
        return JSONResponse({"error": "Not awaiting approval"}, status_code=400)
    await pipeline_state.approve()
    return JSONResponse({"status": "approved"})


@app.post("/api/pipeline/halt")
async def halt():
    await pipeline_state.halt()
    return JSONResponse({"status": "halted"})


@app.post("/api/pipeline/reset")
async def reset():
    await pipeline_state.reset()
    await ws_manager.send_stage_change("IDLE", "")
    return JSONResponse({"status": "reset"})


@app.post("/api/pipeline/confirm-drift")
async def confirm_drift():
    await pipeline_state.confirm_drift()
    return JSONResponse({"status": "confirmed"})


@app.get("/api/pipeline/status")
async def get_status():
    return JSONResponse({**pipeline_state.to_dict(), "dataset_id": getattr(pipeline_state, "current_dataset_id", None)})


@app.get("/api/audit-log")
async def audit_log():
    return JSONResponse(get_all_logs())


@app.get("/api/audit-log/export-pdf")
async def export_audit():
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".pdf")
    tmp.close()
    export_pdf(tmp.name)
    return FileResponse(tmp.name, media_type="application/pdf",
                        filename=f"brightcone-audit-{datetime.datetime.now().strftime('%Y%m%d-%H%M%S')}.pdf")


@app.get("/api/schema-mapping")
async def schema_mapping():
    if not pipeline_state.schema_mapping:
        return JSONResponse({"error": "Not yet run"}, status_code=404)
    return JSONResponse(pipeline_state.schema_mapping)


@app.get("/api/reconciliation")
async def reconciliation():
    if not pipeline_state.reconciliation:
        return JSONResponse({"error": "Not yet run"}, status_code=404)
    return JSONResponse(pipeline_state.reconciliation)


@app.get("/api/agents/status")
async def agents_status():
    return JSONResponse(pipeline_state.agent_statuses)


@app.get("/api/runs")
async def get_runs():
    from run_store import get_all_runs
    return JSONResponse(get_all_runs())


@app.get("/api/runs/{run_id}/logs")
async def get_run_logs(run_id: str):
    from run_store import get_run_logs
    return JSONResponse(get_run_logs(run_id))


@app.get("/api/runs/{run_id}/agents")
async def get_run_agents(run_id: str):
    from run_store import get_agent_outputs
    return JSONResponse(get_agent_outputs(run_id))


@app.get("/api/runs/{run_id}/data-view")
async def get_run_data_view(run_id: str, table: str = "claims", limit: int = 20):
    import psycopg2, psycopg2.extras
    from agents.transformation_agent import transform_batch
    try:
        conn = psycopg2.connect(settings.sync_database_url)
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("SELECT dataset_id FROM migration_runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
        if not row:
            return JSONResponse({"error": "Run not found"}, status_code=404)
        dataset_id = row["dataset_id"]
        cur.execute(f'SELECT * FROM "{table}" WHERE dataset_id=%s LIMIT %s', (dataset_id, limit))
        raw_rows = [dict(r) for r in cur.fetchall()]
        cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name=%s AND table_schema='public' ORDER BY ordinal_position", (table,))
        columns = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        cur.close()
        conn.close()

        source_rows = _clean_rows(raw_rows)
        transform_result = await transform_batch(raw_rows, table)
        transformed_rows = _clean_rows(transform_result["transformed_records"][:limit])
        anomalies = _clean_rows(transform_result["anomalies"][:limit])
        stats = transform_result["stats"]

        diffs = []
        for i, (src, tgt) in enumerate(zip(source_rows, transformed_rows)):
            changed = {}
            for k in src:
                if k in tgt and str(src[k]) != str(tgt.get(k, '')):
                    changed[k] = {"before": src[k], "after": tgt[k]}
            for k in tgt:
                if k not in src:
                    changed[k] = {"before": None, "after": tgt[k], "added": True}
            diffs.append(changed)

        return JSONResponse({
            "table": table, "dataset_id": dataset_id, "columns": columns,
            "source_rows": source_rows, "transformed_rows": transformed_rows,
            "anomalies": anomalies, "diffs": diffs, "stats": stats,
            "total_source": len(source_rows),
        })
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.on_event("startup")
async def startup():
    asyncio.create_task(start_monitor())
