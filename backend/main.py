import asyncio
import json
import decimal
import datetime
import tempfile
import uuid
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from config import get_settings
from audit_log import get_all_logs, export_pdf
from pipeline_state import pipeline_state, Stage
from websocket_manager import ws_manager
from agents.orchestration_agent import run_pipeline
from agents.monitor_agent import start_monitor
from fhir_store import ensure_tables, clear_resources, list_run_summaries, get_run_summary, list_records, retry_failed_records
from run_store import create_run as _create_run, is_pipeline_running, clear_stale_runs, force_fail_all_running
from lacare.routes import router as lacare_router
from platform_auth import router as auth_router
from platform_db import ensure_platform_tables, seed_default_admin, log_activity

settings = get_settings()
app = FastAPI(title="Brightcone Platform", version="4.2.0")
_pipeline_lock = asyncio.Lock()

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

# --- Activity/access log middleware -----------------------------------------
# Every /api/lacare/* and /api/auth/* call gets tailed into lacare_activity so
# the UI's "System Activity" drawer can show the live HTTP traffic the client
# is driving. This mirrors uvicorn's INFO log shape but persists across
# restarts and is scoped per-tenant.
import time as _time
_ACTIVITY_PATH_PREFIXES = ("/api/lacare/", "/api/auth/")
# Polling endpoints that the UI hits every ~1.2s — skipping GETs on these
# keeps the activity tail focused on real events (mutations + drill-downs).
_ACTIVITY_SKIP_GET = (
    "/api/lacare/status",
    "/api/lacare/dashboard",
    "/api/lacare/runs",
    "/api/lacare/activity",
    "/api/lacare/documents",
    "/api/lacare/evidence",
)

@app.middleware("http")
async def _activity_log_middleware(request: Request, call_next):
    start = _time.perf_counter()
    response = await call_next(request)
    try:
        path = request.url.path
        is_tracked = any(path.startswith(p) for p in _ACTIVITY_PATH_PREFIXES)
        is_polling_get = (request.method == "GET"
                          and any(path == p or path.startswith(p + "?") or path == p + "/"
                                  for p in _ACTIVITY_SKIP_GET))
        if is_tracked and not is_polling_get:
            dur_ms = int((_time.perf_counter() - start) * 1000)
            # Extract actor from the Bearer token when present (best-effort)
            actor = ""
            auth = request.headers.get("authorization") or ""
            if auth.lower().startswith("bearer "):
                from platform_db import lookup_session
                try:
                    sess = lookup_session(auth.split(" ", 1)[1])
                    if sess:
                        actor = sess.get("username") or ""
                except Exception:
                    pass
            log_activity(
                kind="http",
                method=request.method,
                path=path,
                status=response.status_code,
                duration_ms=dur_ms,
                actor=actor,
            )
    except Exception:
        pass
    return response


app.include_router(lacare_router)
app.include_router(auth_router)


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
        if pipeline_state.current_stage == Stage.AWAITING_APPROVAL and pipeline_state.approval_gate:
            await websocket.send_text(json.dumps({"type": "APPROVAL_GATE", **pipeline_state.approval_gate}))
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


# Tables Agentic DM must NEVER discover / FHIR-map. Two groups:
#   * Internal Agentic DM bookkeeping tables (migration_runs, run_logs, ...)
#   * Tables owned by other apps that share the same Postgres:
#       - lacare_*     — the LA Care CCDA module
#       - platform_*   — shared auth / tenancy
#
# Without this filter, discovery walks every public table in the DB,
# runs the Claude mapper against each one, and blows up with things
# like "[claude_mapper] Failed for table 'lacare_hits'". It also made
# /api/datasets and /api/pipeline/start take 4–14 seconds because
# every table triggered a COUNT(*) and an information_schema round-trip.
_SYSTEM_TABLES = frozenset({
    "migration_runs", "run_logs", "run_agent_outputs", "fhir_loaded_resources",
})

# Prefixes that identify tables owned by OTHER modules sharing this Postgres.
# Add new module prefixes here as more apps join the shared DB.
_FOREIGN_TABLE_PREFIXES: tuple[str, ...] = (
    "lacare_",
    "platform_",
)


def _is_source_table(name: str) -> bool:
    """True iff this table is an Agentic DM source table (not system, not foreign)."""
    if name in _SYSTEM_TABLES:
        return False
    for prefix in _FOREIGN_TABLE_PREFIXES:
        if name.startswith(prefix):
            return False
    return True


def _get_source_tables(cur) -> list:
    """Return all public source tables, excluding system + foreign-module tables."""
    cur.execute(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_type='BASE TABLE' "
        "ORDER BY table_name"
    )
    return [r[0] for r in cur.fetchall() if _is_source_table(r[0])]


def _tables_with_dataset_id(cur, tables: list) -> list:
    """Return only those tables that have a dataset_id column."""
    result = []
    for t in tables:
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=%s AND column_name='dataset_id'",
            (t,),
        )
        if cur.fetchone():
            result.append(t)
    return result


# --------------------------------------------------------------------------- #
# Root banner — Render's internal prober hits `/` every minute and a bare
# FastAPI app returns 404, which looks alarming in logs. Return a minimal
# 200 JSON instead so the log stream stays clean and anyone browsing the
# URL gets a one-line confirmation the API is up.
# --------------------------------------------------------------------------- #


@app.get("/")
async def root():
    return JSONResponse({
        "service": "Brightcone Platform API",
        "version": app.version,
        "docs": "/docs",
        "health": "/api/healthz",
    })


# --------------------------------------------------------------------------- #
# Health + liveness probes
#
# /api/healthz is the endpoint Render hits every few seconds to decide
# whether this process is alive. It MUST be fast (<200 ms), MUST NOT
# trigger any LLM calls, and MUST NOT hold the DB pool — if Render gets
# no response it assumes the container is dead and restarts it, which is
# exactly what caused the cascading failures we saw at 27:30 UTC.
# --------------------------------------------------------------------------- #

_APP_BOOTED_AT = datetime.datetime.utcnow()


@app.get("/api/healthz")
async def healthz():
    """Liveness probe for Render. Lightweight DB-pool ping only."""
    db_ok = False
    db_error: str | None = None
    try:
        # Use a borrowed pool connection and immediately return it — do not
        # hold it while serving this endpoint.
        from platform_db import pooled_connection
        with pooled_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
            cur.close()
        db_ok = True
    except Exception as exc:  # noqa: BLE001 — health check must never raise
        db_error = str(exc)[:160]

    uptime_seconds = (datetime.datetime.utcnow() - _APP_BOOTED_AT).total_seconds()
    # Cache introspection — useful for confirming on a redeploy that
    # the in-process TTL cache is actually populated and warming up
    # under real traffic. Counts-only, not contents.
    cache_entries = 0
    try:
        from cache import stats as _cache_stats
        cache_entries = _cache_stats().get("entries", 0)
    except Exception:
        pass

    return JSONResponse({
        "status": "ok" if db_ok else "degraded",
        "version": app.version,
        "uptime_seconds": int(uptime_seconds),
        "db": "up" if db_ok else "down",
        "db_error": db_error,
        "pipeline_active": bool(getattr(pipeline_state, "run_id", "")),
        "cache_entries": cache_entries,
    }, status_code=200 if db_ok else 503)


@app.get("/api/readyz")
async def readyz():
    """Readiness probe — same as healthz but without the DB dependency,
    for use behind a load balancer that wants to pre-warm before sending
    traffic."""
    return JSONResponse({"ready": True, "version": app.version})


def _get_datasets_sync() -> list:
    """Synchronous implementation of /api/datasets.

    Runs in a worker thread via asyncio.to_thread so the event loop stays
    free to serve /status, /ws, /healthz during the ~30 COUNT(*) queries
    this can trigger on a fully-seeded Synthea schema.

    Uses the shared `platform_db` pool — fresh psycopg2.connect() on a
    managed Postgres takes ~200–400 ms for the TCP+TLS handshake; the
    pool makes this ~0 ms for warm connections.
    """
    from platform_db import get_conn
    conn = get_conn()
    try:
        cur = conn.cursor()
        source_tables = _get_source_tables(cur)
        tables_with_ds = _tables_with_dataset_id(cur, source_tables)

        if not tables_with_ds:
            counts: dict = {}
            for t in source_tables:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                row = cur.fetchone()
                counts[t] = row[0] if row else 0
            total = sum(counts.values())
            return [{
                "id": "default",
                "name": "Default Dataset",
                "description": "All source records (no dataset_id partitioning detected).",
                "badge": "Dataset",
                "color": "blue",
                "total": total,
                **counts,
            }]

        union_parts = " UNION ".join(
            f'SELECT DISTINCT dataset_id FROM "{t}" WHERE dataset_id IS NOT NULL'
            for t in tables_with_ds
        )
        cur.execute(union_parts)
        dataset_ids = sorted(r[0] for r in cur.fetchall())

        result = []
        for ds_id in dataset_ids:
            counts = {}
            total = 0
            for t in tables_with_ds:
                cur.execute(f'SELECT COUNT(*) FROM "{t}" WHERE dataset_id=%s', (ds_id,))
                row = cur.fetchone()
                cnt = row[0] if row else 0
                counts[t] = cnt
                total += cnt
            result.append({
                "id": ds_id,
                "name": ds_id.replace('_', ' ').title(),
                "description": f"Dataset '{ds_id}' from source database.",
                "total": total,
                **counts,
            })
        return result
    finally:
        conn.close()


@app.get("/api/datasets")
async def get_datasets():
    """Dataset discovery — cached for 30 s.

    Walks `information_schema.tables` and fires N COUNT(*) queries;
    even at pooled speeds that's ~100 ms of DB work. Caching for 30 s
    makes polling effectively free (dataset list only changes when the
    operator re-imports Synthea).
    """
    import cache
    cache_key = "datasets:list"
    hit, cached_payload = cache.get(cache_key)
    if hit:
        return JSONResponse(
            cached_payload,
            headers={"Cache-Control": "public, max-age=10"},
        )
    try:
        result = await asyncio.to_thread(_get_datasets_sync)
        cache.set(cache_key, result, ttl_seconds=30)
        return JSONResponse(
            result,
            headers={"Cache-Control": "public, max-age=10"},
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


def _dataset_preview_sync(dataset_id: str) -> dict:
    """Synchronous implementation of /api/datasets/{id}/preview.

    Batches all information_schema.columns lookups into ONE query instead
    of N (one per table). The old implementation did 3–4 queries per table
    which, on a 25-table schema, was 100 round-trips to Render Postgres
    and explained the 14-second responses.

    Uses the shared `platform_db` pool.
    """
    import psycopg2.extras
    from platform_db import get_conn
    conn = get_conn()
    try:
        plain_cur = conn.cursor()
        source_tables = _get_source_tables(plain_cur)
        plain_cur.close()

        if not source_tables:
            return {}

        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # ONE query to fetch columns for every source table.
        cur.execute(
            "SELECT table_name, column_name, data_type "
            "FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name = ANY(%s) "
            "ORDER BY table_name, ordinal_position",
            (source_tables,),
        )
        columns_by_table: dict[str, list] = {t: [] for t in source_tables}
        dataset_id_tables: set[str] = set()
        for row in cur.fetchall():
            tname = row["table_name"]
            columns_by_table.setdefault(tname, []).append(
                {"name": row["column_name"], "type": row["data_type"]}
            )
            if row["column_name"] == "dataset_id":
                dataset_id_tables.add(tname)

        result: dict = {}
        for table in source_tables:
            has_ds = table in dataset_id_tables
            use_filter = has_ds and dataset_id != "default"

            if use_filter:
                cur.execute(f'SELECT COUNT(*) FROM "{table}" WHERE dataset_id=%s', (dataset_id,))
            else:
                cur.execute(f'SELECT COUNT(*) FROM "{table}"')
            count_row = cur.fetchone()
            count = count_row[0] if count_row else 0

            if use_filter:
                cur.execute(f'SELECT * FROM "{table}" WHERE dataset_id=%s LIMIT 8', (dataset_id,))
            else:
                cur.execute(f'SELECT * FROM "{table}" LIMIT 8')
            rows = _clean_rows([dict(r) for r in cur.fetchall()])

            result[table] = {
                "count": count,
                "columns": columns_by_table.get(table, []),
                "sample": rows,
            }
        return result
    finally:
        conn.close()


@app.get("/api/datasets/{dataset_id}/preview")
async def dataset_preview(dataset_id: str):
    """Dataset preview — cached per-dataset for 20 s.

    Even at pooled speed this endpoint fetches 8 sample rows × N tables
    plus a batched column-metadata query — ~200-400 ms of DB work. The
    preview only changes when the Synthea import runs, so a 20 s cache
    is a safe, large win for the dashboard that shows this card.
    """
    import cache
    cache_key = f"dataset_preview:{dataset_id}"
    hit, cached_payload = cache.get(cache_key)
    if hit:
        return JSONResponse(
            cached_payload,
            headers={"Cache-Control": "public, max-age=10"},
        )
    try:
        result = await asyncio.to_thread(_dataset_preview_sync, dataset_id)
        cache.set(cache_key, result, ttl_seconds=20)
        return JSONResponse(
            result,
            headers={"Cache-Control": "public, max-age=10"},
        )
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/pipeline/start")
async def start_pipeline(dataset_id: str = "default"):
    # In-process check (fast)
    if _pipeline_lock.locked():
        return JSONResponse({"error": "Pipeline already running"}, status_code=409)
    if pipeline_state.current_stage not in (Stage.IDLE, Stage.COMPLETE, Stage.HALTED):
        return JSONResponse(
            {
                "error": "Pipeline already running",
                "stage": pipeline_state.current_stage.value,
                "hint": "POST /api/pipeline/reset to force-clear the current run.",
            },
            status_code=409,
        )
    # Cross-process DB check: if in-memory says IDLE but DB still has a
    # 'running' row from a crashed process, force-clear it instead of 409-ing.
    if is_pipeline_running():
        cleared = force_fail_all_running("Auto-cleared before fresh start (stale DB run)")
        print(f"[start_pipeline] force-cleared {cleared} stuck run(s) before starting {dataset_id}")

    async def _run():
        async with _pipeline_lock:
            from agents.discovery_agent import run_discovery
            await pipeline_state.clear_approval_gate()
            pipeline_state.current_dataset_id = dataset_id
            for agent in pipeline_state.agent_statuses:
                if agent != "monitor":
                    pipeline_state.agent_statuses[agent] = {"status": "idle", "last_action": "", "records_processed": 0, "last_active": None}
            pre_run_id = str(uuid.uuid4())
            pipeline_state.run_id = pre_run_id
            _create_run(pre_run_id, dataset_id)
            await run_discovery()
            await run_pipeline()

    asyncio.create_task(_run())
    return JSONResponse({"status": "started", "dataset_id": dataset_id})


@app.get("/api/pipeline/reviews")
async def get_reviews():
    return JSONResponse({"pending_reviews": _unresolved_reviews()})


_RESOLVED_DECISIONS = {"accept", "reject", "edit"}


def _unresolved_reviews() -> list:
    """Only items the operator has not yet decided on.

    pipeline_state.pending_reviews keeps every item (even decided ones) so the
    pipeline can audit decisions later, but the UI should only display items
    that still need action.
    """
    return [
        r for r in pipeline_state.pending_reviews
        if r.get("review_decision") not in _RESOLVED_DECISIONS
    ]


@app.post("/api/pipeline/reviews/resolve")
async def resolve_review(payload: dict):
    table = payload.get("table")
    source_column = payload.get("source_column")
    decision = payload.get("decision")
    selected_target = payload.get("selected_target")
    if not table or not source_column or decision not in _RESOLVED_DECISIONS:
        return JSONResponse({"error": "Invalid review payload"}, status_code=400)
    await pipeline_state.resolve_review(table, source_column, decision, selected_target)
    unresolved = _unresolved_reviews()
    await ws_manager.broadcast(
        "REVIEWS_UPDATED",
        {"pending_reviews": unresolved, "schema_mapping": pipeline_state.schema_mapping},
    )
    return JSONResponse({"status": "ok", "pending_reviews": unresolved})


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


@app.delete("/api/runs/{run_id}")
async def delete_run(run_id: str):
    import cache
    from platform_db import get_conn
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM run_logs WHERE run_id=%s', (run_id,))
    cur.execute('DELETE FROM run_agent_outputs WHERE run_id=%s', (run_id,))
    cur.execute('DELETE FROM migration_runs WHERE run_id=%s', (run_id,))
    cur.execute('DELETE FROM fhir_loaded_resources WHERE run_id=%s', (run_id,))
    conn.commit(); cur.close(); conn.close()
    # Datasets / preview counts just changed.
    cache.invalidate("datasets")
    cache.invalidate("dataset_preview")
    from run_store import get_all_runs
    await ws_manager.broadcast("RUNS_UPDATED", {"runs": get_all_runs()})
    return JSONResponse({"status": "deleted"})


@app.delete("/api/runs")
async def delete_runs():
    import cache
    from platform_db import get_conn
    conn = get_conn()
    cur = conn.cursor()
    cur.execute('DELETE FROM run_logs')
    cur.execute('DELETE FROM run_agent_outputs')
    cur.execute('DELETE FROM migration_runs')
    conn.commit()
    cur.close()
    conn.close()
    cache.invalidate("datasets")
    cache.invalidate("dataset_preview")
    return JSONResponse({"status": "deleted"})


@app.post("/fhir")
async def fhir_ingest(request: Request):
    """Built-in FHIR R4 endpoint. Accepts transaction bundles posted by the pipeline."""
    import json as _json
    try:
        bundle = await request.json()
    except Exception:
        return JSONResponse({"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "invalid", "diagnostics": "Invalid JSON"}]}, status_code=400)

    resource_type = bundle.get("resourceType")
    if resource_type != "Bundle":
        return JSONResponse({"resourceType": "OperationOutcome", "issue": [{"severity": "error", "code": "invalid", "diagnostics": "Expected Bundle"}]}, status_code=400)

    entries = bundle.get("entry", [])
    response_entries = []
    for entry in entries:
        res = entry.get("resource", {})
        rt = res.get("resourceType", "Unknown")
        rid = res.get("id", "")
        location = f"{rt}/{rid}" if rid else rt
        response_entries.append({"response": {"status": "201 Created", "location": location}})

    return JSONResponse({
        "resourceType": "Bundle",
        "type": "transaction-response",
        "entry": response_entries
    }, status_code=200)


@app.get("/api/fhir/resources")
async def get_fhir_resources(run_id: str | None = None, resource_type: str | None = None, limit: int = 100):
    # Use list_records for full data; return simplified shape for legacy compatibility
    recs = list_records(run_id, resource_type=resource_type, limit=limit)
    return JSONResponse([{
        "run_id": r["run_id"], "dataset_id": r["dataset_id"],
        "resource_type": r["resource_type"], "resource_id": r["resource_id"],
        "resource": r["resource"], "loaded_at": r["loaded_at"]
    } for r in recs])


@app.get("/api/fhir/runs")
async def get_fhir_runs():
    return JSONResponse(list_run_summaries())


@app.get("/api/fhir/runs/{run_id}/summary")
async def get_fhir_run_summary(run_id: str):
    return JSONResponse(get_run_summary(run_id))


@app.get("/api/fhir/runs/{run_id}/records")
async def get_fhir_run_records(run_id: str, resource_type: str | None = None, status: str | None = None, limit: int = 200):
    return JSONResponse(list_records(run_id, resource_type=resource_type, status=status, limit=limit))


@app.post("/api/fhir/runs/{run_id}/retry")
async def retry_run_failures(run_id: str):
    retried = retry_failed_records(run_id)
    return JSONResponse({"status": "ok", "retried": retried})


@app.delete("/api/fhir/resources")
async def delete_fhir_resources():
    clear_resources()
    return JSONResponse({"status": "deleted"})


@app.get('/api/target/health')
async def target_health():
    """FHIR endpoint reachability probe — cached for 20 s.

    Without caching, every LA Care dashboard refresh and every Agentic
    DM MigrationView mount hits the external HAPI server. HAPI adds
    200–500 ms of latency and rate-limits aggressive callers. The
    answer only changes when the endpoint itself goes up/down, so a
    20 s cache is safe and cuts outbound calls by ~95 %.
    """
    import httpx
    import cache

    cache_key = f"target_health:{settings.fhir_base_url}"
    hit, cached_payload = cache.get(cache_key)
    if hit:
        return JSONResponse(
            cached_payload,
            headers={"Cache-Control": "public, max-age=15"},
        )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(settings.fhir_base_url)
            payload = {
                "reachable": True,
                "status_code": resp.status_code,
                "target": settings.fhir_base_url,
            }
    except Exception as e:
        payload = {
            "reachable": False,
            "status_code": None,
            "target": settings.fhir_base_url,
            "error": str(e),
        }
    cache.set(cache_key, payload, ttl_seconds=20)
    return JSONResponse(
        payload,
        headers={"Cache-Control": "public, max-age=15"},
    )




@app.get("/api/runs/{run_id}/logs")
async def get_run_logs(run_id: str):
    from run_store import get_run_logs
    return JSONResponse(get_run_logs(run_id))


@app.get("/api/runs/{run_id}/agents")
async def get_run_agents(run_id: str):
    from run_store import get_agent_outputs
    return JSONResponse(get_agent_outputs(run_id))


@app.get("/api/runs/{run_id}/data-view")
async def get_run_data_view(run_id: str, table: str = "", limit: int = 20):
    import psycopg2.extras
    from agents.transformation_agent import transform_batch
    from platform_db import get_conn
    try:
        conn = get_conn()
        plain_cur = conn.cursor()

        # Resolve the table to inspect
        resolved_table = table
        if not resolved_table:
            source_tables = _get_source_tables(plain_cur)
            resolved_table = source_tables[0] if source_tables else None
        plain_cur.close()

        if not resolved_table:
            conn.close()
            return JSONResponse({"error": "No source tables found"}, status_code=404)

        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        cur.execute("SELECT dataset_id FROM migration_runs WHERE run_id=%s", (run_id,))
        row = cur.fetchone()
        if not row:
            cur.close()
            conn.close()
            return JSONResponse({"error": "Run not found"}, status_code=404)
        dataset_id = row["dataset_id"]

        # Check if table has dataset_id column
        cur.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema='public' AND table_name=%s AND column_name='dataset_id'",
            (resolved_table,),
        )
        has_ds = bool(cur.fetchone())

        if has_ds and dataset_id and dataset_id != "default":
            cur.execute(f'SELECT * FROM "{resolved_table}" WHERE dataset_id=%s LIMIT %s', (dataset_id, limit))
        else:
            cur.execute(f'SELECT * FROM "{resolved_table}" LIMIT %s', (limit,))
        raw_rows = [dict(r) for r in cur.fetchall()]

        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_name=%s AND table_schema='public' ORDER BY ordinal_position",
            (resolved_table,),
        )
        columns = [{"name": r[0], "type": r[1]} for r in cur.fetchall()]
        cur.close()
        conn.close()
        table = resolved_table

        source_rows = _clean_rows(raw_rows)
        mapping = pipeline_state.schema_mapping.get("mapping_summary", []) if pipeline_state.schema_mapping else []
        if not mapping:
            from agents.discovery_agent import run_discovery
            await run_discovery()
            mapping = pipeline_state.schema_mapping.get("mapping_summary", []) if pipeline_state.schema_mapping else []
        transform_result = await transform_batch(raw_rows, table, mapping)
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
    ensure_tables()
    ensure_platform_tables()
    try:
        seed_default_admin()
    except Exception as exc:
        print(f"[startup] seed_default_admin skipped: {exc}")
    # Auto-populate the curated CCDA sample library on first boot so the
    # Sample Library tab always has data to pick from — no manual seeding.
    try:
        from lacare.seed_library import seed_library
        result = seed_library(target_count=30)
        print(f"[startup] lacare sample library: {result}")
    except Exception as exc:
        print(f"[startup] lacare seed_library skipped: {exc}")
    # Single-instance service: any 'running%' row at startup is from a dead
    # process. Force-fail all of them so new pipeline starts are never
    # blocked after a Render restart / deploy / crash.
    forced = force_fail_all_running("Auto-failed on server startup")
    if forced:
        print(f"[startup] Force-failed {forced} stuck running run(s) from previous process")
    asyncio.create_task(start_monitor())


@app.post("/api/pipeline/clear-stuck")
async def clear_stuck_runs():
    """Force-fail any runs stuck in 'running' state (for ops recovery)."""
    fixed = clear_stale_runs()
    # Also force-fail runs with NO time limit if any remain (e.g. from recent crash)
    from run_store import _get_conn
    with _get_conn() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE migration_runs
            SET status = 'failed', completed_at = NOW(),
                notes = 'Force-failed via admin endpoint'
            WHERE status LIKE 'running%'
        """)
        forced = cur.rowcount
        cur.close()
    pipeline_state.current_stage = Stage.IDLE
    pipeline_state.run_id = None
    return JSONResponse({"stale_cleared": fixed, "force_cleared": forced})
