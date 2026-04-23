"""FastAPI routes for the LA Care CCDA Intelligence module.

All endpoints are mounted under /api/lacare/* by the main app. Every
endpoint reads and writes through the Postgres repository — no in-memory
state, no hardcoded responses. One key invariant: at most ONE pipeline
run can be active at a time (see `active_run()` check below).
"""
from __future__ import annotations

import asyncio
import uuid
from typing import Any

from fastapi import APIRouter, Body, File, Header, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

from platform_auth import require_session
from platform_db import log_activity

from .ccda_parser import parse_ccda
from .hedis_engine import MEASURES, evaluate_document, estimate_revenue_impact
from .pipeline import run_pipeline
from .sample_data import generate_batch
from . import repository as repo


router = APIRouter(prefix="/api/lacare", tags=["lacare"])

_active_tasks: dict[str, asyncio.Task] = {}


def _scenario_expected_measure(scenario: str) -> str:
    # Map seed scenario code to the HEDIS measure it demonstrates
    mapping = {
        "FUM_CLOSED": "FUM", "FUM_CLOSED_30": "FUM",
        "FUA_CLOSED": "FUA",
        "CBP_CONTROLLED": "CBP", "CBP_UNCONTROLLED": "CBP",
        "HBD_CONTROLLED": "HBD", "HBD_UNCONTROLLED": "HBD",
        "MRP_CLOSED": "MRP",
        "NO_EVIDENCE": "",
    }
    return mapping.get(scenario, "")


def _scenario_label(scenario: str) -> str:
    return {
        "FUM_CLOSED": "FUM — 7-day BH follow-up after ED (closed)",
        "FUM_CLOSED_30": "FUM — 30-day BH follow-up after ED",
        "FUA_CLOSED": "FUA — 7-day AOD follow-up after ED",
        "CBP_CONTROLLED": "CBP — Blood pressure controlled",
        "CBP_UNCONTROLLED": "CBP — Blood pressure uncontrolled",
        "HBD_CONTROLLED": "HBD — HbA1c <8% (controlled)",
        "HBD_UNCONTROLLED": "HBD — HbA1c ≥8% (uncontrolled)",
        "MRP_CLOSED": "MRP — Medication reconciliation post-discharge",
        "NO_EVIDENCE": "No evidence — claims-only, nothing to find",
    }.get(scenario, scenario)


# --------------------------------------------------------------------------- #
# Public: measure catalog
# --------------------------------------------------------------------------- #

@router.get("/measures")
async def list_measures():
    return JSONResponse(MEASURES)


# --------------------------------------------------------------------------- #
# Sample library (seed-once, reuse-many)
# --------------------------------------------------------------------------- #

@router.get("/samples")
async def get_samples(scenario: str = "", document_type: str = "", search: str = "",
                      limit: int = 500, offset: int = 0,
                      authorization: str | None = Header(default=None)):
    require_session(authorization)
    total, items = repo.list_samples(scenario=scenario, document_type=document_type,
                                     search=search, limit=limit, offset=offset)
    facets = repo.sample_scenario_facets()
    return JSONResponse({
        "total": total,
        "items": items,
        "facets": facets,
        "seeded": repo.sample_count(),
    })


@router.get("/samples/{sample_id}/xml", response_class=PlainTextResponse)
async def sample_xml(sample_id: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    docs = repo.fetch_samples_by_ids([sample_id])
    if not docs:
        raise HTTPException(status_code=404, detail="Sample not found")
    return docs[0].get("raw_xml") or ""


@router.get("/samples/{sample_id}/preview")
async def sample_preview(sample_id: str, authorization: str | None = Header(default=None)):
    """Rich preview of a curated CCDA sample: parsed sections, structured
    entries, narrative blocks, and the HEDIS measures it's expected to
    trigger. Feeds the 'Preview before run' pane in the UI.
    """
    require_session(authorization)
    rows = repo.fetch_samples_by_ids([sample_id])
    if not rows:
        raise HTTPException(status_code=404, detail="Sample not found")
    row = rows[0]
    parsed = row.get("parsed_json") or parse_ccda(row.get("raw_xml") or "")
    header = parsed.get("header", {}) or {}
    sections_map = parsed.get("sections", {}) or {}
    narrative_map = parsed.get("narrative", {}) or {}
    # Compact per-section stats + a few example entries. The raw parser
    # returns `code` / `value` as structured dicts (e.g. {code, system,
    # display, system_name}); we flatten them into plain strings so the
    # preview is safe to render directly in the UI.
    def _flatten_entry(e: dict[str, Any]) -> dict[str, str]:
        code_obj = e.get("code") if isinstance(e.get("code"), dict) else {}
        value_obj = e.get("value") if isinstance(e.get("value"), dict) else {}
        eff_obj = e.get("effective_time") if isinstance(e.get("effective_time"), dict) else {}
        # Prefer the code's display name; fall back to value text; then to
        # a short human-readable type tag.
        display = (
            (code_obj.get("display") if isinstance(code_obj, dict) else "")
            or (value_obj.get("display") if isinstance(value_obj, dict) else "")
            or (value_obj.get("text") if isinstance(value_obj, dict) else "")
            or str(e.get("type") or "")
            or ""
        )
        return {
            "display": str(display),
            "code": str(code_obj.get("code") or "") if isinstance(code_obj, dict) else str(code_obj or ""),
            "code_system": str(
                (code_obj.get("system_name") or code_obj.get("system") or "")
                if isinstance(code_obj, dict) else ""
            ),
            "value": str(value_obj.get("value") or "") if isinstance(value_obj, dict) else str(value_obj or ""),
            "unit": str(value_obj.get("unit") or "") if isinstance(value_obj, dict) else "",
            "effective_time": str(
                (eff_obj.get("value") or eff_obj.get("low") or eff_obj.get("high") or "")
                if isinstance(eff_obj, dict) else (eff_obj or "")
            ),
        }

    sections = []
    for name, entries in sections_map.items():
        sample_entries = [_flatten_entry(e) for e in (entries or [])[:4] if isinstance(e, dict)]
        sections.append({
            "name": name,
            "entry_count": len(entries or []),
            "narrative_chars": len(narrative_map.get(name) or ""),
            "narrative_excerpt": (narrative_map.get(name) or "")[:400],
            "sample_entries": sample_entries,
        })

    hits_preview = evaluate_document(parsed)
    return JSONResponse({
        "sample_id": row["sample_id"],
        "scenario": row["scenario"],
        "scenario_label": row.get("scenario_label"),
        "document_type": row.get("document_type"),
        "patient": header.get("patient", {}) or {},
        "encounter": header.get("encounter", {}) or {},
        "expected_measure": _scenario_expected_measure(row["scenario"]),
        "summary": row.get("summary") or "",
        "sections": sections,
        "total_entries": sum(len(v or []) for v in sections_map.values()),
        "total_narrative_chars": sum(len(v or "") for v in narrative_map.values()),
        "expected_hits_preview": hits_preview,
    })


@router.post("/samples/seed")
async def seed_samples(payload: dict[str, Any] = Body(default_factory=dict),
                       authorization: str | None = Header(default=None)):
    """Populate the curated sample library. Safe to call multiple times —
    INSERT … ON CONFLICT DO NOTHING ensures idempotency.

    Payload:
      { "count": 200, "force": false }

    If the library already has samples and force=false, returns the current
    count without regenerating (fast).
    """
    require_session(authorization)
    count = int(payload.get("count", 200))
    force = bool(payload.get("force", False))
    existing = repo.sample_count()
    if existing >= count and not force:
        return JSONResponse({"status": "already_seeded", "total": existing})

    batch = generate_batch(count=count)
    inserted = 0
    for item in batch:
        meta = item["metadata"]
        parsed = parse_ccda(item["xml"])
        header = parsed.get("header", {}) or {}
        patient = header.get("patient", {}) or {}
        enc = header.get("encounter", {}) or {}
        sections_map = parsed.get("sections", {}) or {}
        narrative_map = parsed.get("narrative", {}) or {}
        scenario = meta.get("scenario", "NO_EVIDENCE")
        sample_id = f"LAC-{meta['document_id']}"
        summary = meta.get("summary") or meta.get("scenario_label") or _scenario_label(scenario)
        repo.insert_sample(
            sample_id=sample_id,
            scenario=scenario,
            scenario_label=_scenario_label(scenario),
            document_type=parsed.get("document_type") or "Clinical Document",
            patient_id=patient.get("id") or meta.get("member_id") or "",
            patient_name=patient.get("name") or meta.get("member_name") or "",
            facility=enc.get("facility", ""),
            encounter_date=(enc.get("effective_time") or {}).get("value", ""),
            section_count=len(sections_map),
            entry_count=sum(len(v) for v in sections_map.values()),
            narrative_chars=sum(len(v or "") for v in narrative_map.values()),
            expected_measure=_scenario_expected_measure(scenario),
            summary=summary,
            raw_xml=item["xml"],
            parsed_json=parsed,
        )
        inserted += 1
    log_activity("seed", message=f"Sample library seeded — {inserted} CCDAs inserted")
    return JSONResponse({"status": "seeded", "total": repo.sample_count(), "inserted": inserted})


# --------------------------------------------------------------------------- #
# Run orchestration
# --------------------------------------------------------------------------- #

def _ensure_no_active_run() -> None:
    """Reject new pipeline work while another run is active.

    If the caller tries to start a second run concurrently, we respond
    with HTTP 409 + the active run_id so the UI can redirect them to it.
    """
    active = repo.active_run()
    if active:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "A pipeline run is already in progress. Please wait for it to finish.",
                "active_run_id": active["run_id"],
                "active_status": active["status"],
                "started_at": active.get("started_at"),
            },
        )


@router.post("/pipeline/start")
async def start_pipeline(payload: dict[str, Any] = Body(default_factory=dict),
                         authorization: str | None = Header(default=None)):
    """Kick off the pipeline for an existing run.

    payload:
      { "run_id": "<required>", "use_ai": true }
    """
    session = require_session(authorization)
    run_id = payload.get("run_id")
    use_ai = bool(payload.get("use_ai", True))

    if not run_id:
        raise HTTPException(status_code=400,
                            detail="run_id is required. Pick samples or upload documents first.")
    run = repo.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")

    # Concurrency: reject if *any* run is currently active (even a different one)
    _ensure_no_active_run()

    async def _job():
        try:
            await run_pipeline(run_id, use_ai=use_ai)
        except Exception:
            pass
        finally:
            _active_tasks.pop(run_id, None)

    _active_tasks[run_id] = asyncio.create_task(_job())
    return JSONResponse({"status": "started", "run_id": run_id, "use_ai": use_ai,
                         "user": session["username"]})


@router.get("/pipeline/active")
async def active_run_endpoint(authorization: str | None = Header(default=None)):
    """Let the UI probe whether *any* run is currently active."""
    require_session(authorization)
    active = repo.active_run()
    return JSONResponse({"active": bool(active), "run": active})


@router.post("/pipeline/cancel")
async def cancel_pipeline(payload: dict[str, Any] = Body(default_factory=dict),
                          authorization: str | None = Header(default=None)):
    """Cancel / halt an active pipeline run.

    If the asyncio task for this run is still in flight on this worker we
    cancel it cooperatively; we always flip the DB status to ``halted`` so
    the lock-is-active probe stops blocking further runs (this also fixes
    the case where a previous process crashed mid-run and left the row in
    'running' forever).

    payload:
      { "run_id": "<required>" }
    """
    session = require_session(authorization)
    run_id = payload.get("run_id") or ""
    if not run_id:
        # Fall back to the currently-active run so the UI can send an empty
        # body and still stop whatever is happening.
        active = repo.active_run()
        run_id = active["run_id"] if active else ""
    if not run_id:
        return JSONResponse({"status": "no_active_run"})

    task = _active_tasks.pop(run_id, None)
    cancelled_task = False
    if task and not task.done():
        task.cancel()
        cancelled_task = True

    run = repo.get_run(run_id)
    if run and run.get("status") in ("queued", "running"):
        repo.set_run_status(
            run_id, "halted", stage="halted",
            notes=f"Cancelled by {session['username']}",
        )
        repo.write_log(run_id, "warning",
                       f"Run cancelled by {session['username']}"
                       + (" (asyncio task cancelled)" if cancelled_task else ""))
        log_activity("pipeline", message=f"Pipeline CANCELLED — run {run_id[:8]} by {session['username']}")

    return JSONResponse({
        "status": "halted",
        "run_id": run_id,
        "cancelled_task": cancelled_task,
    })


@router.post("/pipeline/from-samples")
async def run_from_samples(payload: dict[str, Any] = Body(default_factory=dict),
                           authorization: str | None = Header(default=None)):
    """Create a new run from SELECTED samples in the library and optionally
    kick off the pipeline.

    payload:
      { "sample_ids": ["LAC-...", ...], "use_ai": true, "auto_start": true }
    """
    session = require_session(authorization)
    sample_ids = payload.get("sample_ids") or []
    if not isinstance(sample_ids, list) or not sample_ids:
        raise HTTPException(status_code=400, detail="sample_ids must be a non-empty list")
    use_ai = bool(payload.get("use_ai", True))
    auto_start = bool(payload.get("auto_start", True))

    if auto_start:
        _ensure_no_active_run()

    samples = repo.fetch_samples_by_ids(sample_ids)
    if not samples:
        raise HTTPException(status_code=404, detail="No samples matched the provided ids")

    run_id = str(uuid.uuid4())
    repo.create_run(run_id, user_id=session["id"], use_ai=use_ai,
                    source="sample-library",
                    notes=f"Selected {len(samples)} samples by {session['username']}")
    repo.write_log(run_id, "info", f"Run created from {len(samples)} selected sample CCDAs")

    inserted = 0
    for s in samples:
        parsed = s.get("parsed_json") or parse_ccda(s.get("raw_xml") or "")
        sections = list((parsed.get("sections") or {}).keys())
        entry_count = sum(len(v) for v in (parsed.get("sections") or {}).values())
        narrative_chars = sum(len(v or "") for v in (parsed.get("narrative") or {}).values())
        repo.insert_document(
            run_id=run_id,
            document_id=s["sample_id"],
            document_type=s.get("document_type") or "",
            patient_id=s.get("patient_id") or "",
            patient_name=s.get("patient_name") or "",
            facility=s.get("facility") or "",
            encounter_date=s.get("encounter_date") or "",
            sections=sections,
            entry_count=entry_count,
            narrative_chars=narrative_chars,
            scenario=s.get("scenario") or "",
            warnings=parsed.get("warnings", []),
            raw_xml=s.get("raw_xml") or "",
            parsed_json=parsed,
        )
        inserted += 1
    repo.set_run_counts(run_id, total=inserted, processed=0)
    log_activity("run", message=f"Run {run_id[:8]} created from {inserted} samples")

    task_started = False
    if auto_start:
        async def _job():
            try:
                await run_pipeline(run_id, use_ai=use_ai)
            except Exception:
                pass
            finally:
                _active_tasks.pop(run_id, None)
        _active_tasks[run_id] = asyncio.create_task(_job())
        task_started = True

    return JSONResponse({
        "status": "started" if task_started else "ready",
        "run_id": run_id,
        "inserted": inserted,
        "use_ai": use_ai,
    })


@router.post("/pipeline/seed-demo")
async def seed_demo(payload: dict[str, Any] = Body(default_factory=dict),
                    authorization: str | None = Header(default=None)):
    """Legacy: generate + insert fresh synthetic CCDAs as a new run.

    Kept for the "Seed to DB" quick-action on the dashboard. Prefer the
    sample-library flow (`/samples/seed` once, then `/pipeline/from-samples`)
    for repeatable demos.
    """
    session = require_session(authorization)
    _ensure_no_active_run()
    count = int(payload.get("count", 100))
    if count < 1 or count > 2000:
        raise HTTPException(status_code=400, detail="count must be between 1 and 2000")

    run_id = str(uuid.uuid4())
    repo.create_run(run_id, user_id=session["id"], use_ai=bool(payload.get("use_ai", True)),
                    source="demo-seed", notes=f"Seeded {count} synthetic CCDAs by {session['username']}")
    repo.write_log(run_id, "info", f"Creating {count} synthetic CCDA documents for demo batch")

    batch = generate_batch(count=count)
    inserted = 0
    for item in batch:
        meta = item["metadata"]
        parsed = parse_ccda(item["xml"])
        sections = list((parsed.get("sections") or {}).keys())
        entry_count = sum(len(v) for v in (parsed.get("sections") or {}).values())
        narrative_chars = sum(len(v or "") for v in (parsed.get("narrative") or {}).values())
        header = parsed.get("header", {}) or {}
        enc = header.get("encounter", {}) or {}
        patient = header.get("patient", {}) or {}
        repo.insert_document(
            run_id=run_id,
            document_id=meta["document_id"],
            document_type=parsed.get("document_type") or "",
            patient_id=patient.get("id") or meta.get("member_id") or "",
            patient_name=patient.get("name") or meta.get("member_name") or "",
            facility=enc.get("facility", ""),
            encounter_date=(enc.get("effective_time") or {}).get("value", ""),
            sections=sections,
            entry_count=entry_count,
            narrative_chars=narrative_chars,
            scenario=meta.get("scenario_label", ""),
            warnings=parsed.get("warnings", []),
            raw_xml=item["xml"],
            parsed_json=parsed,
        )
        inserted += 1
    repo.set_run_counts(run_id, total=inserted, processed=0)
    repo.write_log(run_id, "success", f"Persisted {inserted} CCDA documents to lacare_documents")
    return JSONResponse({"status": "seeded", "run_id": run_id, "inserted": inserted})


@router.post("/documents/upload")
async def upload_documents(
    files: list[UploadFile] = File(...),
    run_id: str | None = None,
    authorization: str | None = Header(default=None),
):
    """Real CCDA upload. One or more .xml files are stored verbatim in
    lacare_documents.raw_xml and parsed into parsed_json on the way in.
    Creates a new run if run_id is not provided.
    """
    session = require_session(authorization)
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    # Only block when we'd be *starting* a new run. Uploads into an existing run are OK.
    if not run_id:
        _ensure_no_active_run()

    new_run = False
    if not run_id:
        run_id = str(uuid.uuid4())
        repo.create_run(run_id, user_id=session["id"], use_ai=True, source="upload",
                        notes=f"Upload by {session['username']}")
        new_run = True

    inserted = 0
    errors: list[dict] = []
    for f in files:
        try:
            content = (await f.read()).decode("utf-8", errors="replace")
            parsed = parse_ccda(content)
            header = parsed.get("header", {}) or {}
            enc = header.get("encounter", {}) or {}
            patient = header.get("patient", {}) or {}
            sections = list((parsed.get("sections") or {}).keys())
            entry_count = sum(len(v) for v in (parsed.get("sections") or {}).values())
            narrative_chars = sum(len(v or "") for v in (parsed.get("narrative") or {}).values())
            doc_id = parsed.get("document_id") or f.filename or str(uuid.uuid4())
            repo.insert_document(
                run_id=run_id,
                document_id=str(doc_id),
                document_type=parsed.get("document_type") or "Clinical Document",
                patient_id=patient.get("id") or "",
                patient_name=patient.get("name") or "",
                facility=enc.get("facility", ""),
                encounter_date=(enc.get("effective_time") or {}).get("value", ""),
                sections=sections,
                entry_count=entry_count,
                narrative_chars=narrative_chars,
                scenario=f"Uploaded: {f.filename}",
                warnings=parsed.get("warnings", []),
                raw_xml=content,
                parsed_json=parsed,
            )
            inserted += 1
        except Exception as exc:
            errors.append({"filename": f.filename, "error": str(exc)})

    run = repo.get_run(run_id)
    total_so_far = (run.get("total_documents") if run else 0) + inserted
    repo.set_run_counts(run_id, total=total_so_far)
    repo.write_log(run_id, "success" if inserted else "warn",
                   f"Uploaded {inserted} CCDA documents" + (f" ({len(errors)} failed)" if errors else ""))

    return JSONResponse({
        "run_id": run_id,
        "inserted": inserted,
        "errors": errors,
        "new_run": new_run,
    })


@router.post("/pipeline/reset")
async def reset_pipeline(payload: dict = Body(default_factory=dict),
                         authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = payload.get("run_id")
    if not run_id:
        raise HTTPException(status_code=400, detail="run_id required")
    repo.delete_run(run_id)
    return JSONResponse({"status": "deleted", "run_id": run_id})


@router.post("/admin/wipe-runs")
async def wipe_runs(authorization: str | None = Header(default=None)):
    """Delete ALL pipeline runs + documents + hits + logs. Keeps the
    curated sample library intact. Handy for cleaning out demo data
    between sessions.
    """
    require_session(authorization)
    counts = repo.wipe_run_data()
    return JSONResponse({"status": "wiped", "counts": counts})


# --------------------------------------------------------------------------- #
# Reads
# --------------------------------------------------------------------------- #

@router.get("/runs")
async def get_runs(limit: int = 50, authorization: str | None = Header(default=None)):
    require_session(authorization)
    return JSONResponse({"items": repo.list_runs(limit=limit)})


@router.get("/status")
async def get_status(run_id: str | None = None, authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse(_empty_status())
    run = repo.get_run(run_id)
    if not run:
        return JSONResponse(_empty_status())
    agents = repo.get_agents(run_id)
    logs = repo.read_logs(run_id, limit=120)
    hits = repo.list_hits(run_id, limit=5000)
    satisfied = [h for h in hits if h.get("satisfied")]
    measure_counts: dict[str, int] = {}
    for h in satisfied:
        measure_counts[h["measure"]] = measure_counts.get(h["measure"], 0) + 1
    revenue = estimate_revenue_impact(satisfied)
    gap_members = {(h.get("patient_id"), h.get("measure")) for h in satisfied}
    from .pipeline import AGENT_NAMES
    agent_map = {name: {"status": "idle", "last_action": "", "processed": 0, "duration_ms": 0} for name in AGENT_NAMES}
    for name, data in agents.items():
        agent_map[name] = {
            "status": data.get("status"),
            "last_action": data.get("last_action") or "",
            "processed": data.get("processed") or 0,
            "duration_ms": data.get("duration_ms") or 0,
        }

    return JSONResponse({
        "run_id": run_id,
        "status": run["status"],
        "started_at": run.get("started_at") or "",
        "completed_at": run.get("completed_at") or "",
        "total_documents": run.get("total_documents") or 0,
        "processed_documents": run.get("processed_documents") or 0,
        "current_stage": run.get("current_stage") or "",
        "agents": agent_map,
        "measure_counts": measure_counts,
        "revenue": revenue,
        "gaps_closed": len(gap_members),
        "warnings": [],
        "logs": list(reversed(logs)),
    })


def _empty_status() -> dict:
    from .pipeline import AGENT_NAMES
    return {
        "run_id": "",
        "status": "idle",
        "started_at": "",
        "completed_at": "",
        "total_documents": 0,
        "processed_documents": 0,
        "current_stage": "idle",
        "agents": {name: {"status": "idle", "last_action": "", "processed": 0, "duration_ms": 0} for name in AGENT_NAMES},
        "measure_counts": {},
        "revenue": {"total_usd": 0, "by_measure": {}},
        "gaps_closed": 0,
        "warnings": [],
        "logs": [],
    }


@router.get("/dashboard")
async def get_dashboard(run_id: str | None = None, authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse(_empty_dashboard())

    total_docs, docs = repo.list_documents(run_id=run_id, limit=5000, offset=0)
    hits = repo.list_hits(run_id=run_id, limit=10000)
    satisfied = [h for h in hits if h.get("satisfied")]
    gap_closure = len({(h["patient_id"], h["measure"]) for h in satisfied})
    by_measure = {}
    for m_code, m_meta in MEASURES.items():
        count = sum(1 for h in satisfied if h["measure"] == m_code)
        by_measure[m_code] = {
            "code": m_code,
            "name": m_meta["name"],
            "description": m_meta["description"],
            "count": count,
            "priority": m_meta["priority"],
        }
    by_doc_type: dict[str, int] = {}
    by_scenario: dict[str, int] = {}
    for d in docs:
        by_doc_type[d["document_type"]] = by_doc_type.get(d["document_type"], 0) + 1
        if d.get("scenario"):
            by_scenario[d["scenario"]] = by_scenario.get(d["scenario"], 0) + 1
    confidence_buckets = {"high (>=0.9)": 0, "medium (0.75-0.9)": 0, "low (<0.75)": 0}
    for h in satisfied:
        c = float(h.get("confidence", 0) or 0)
        if c >= 0.9:
            confidence_buckets["high (>=0.9)"] += 1
        elif c >= 0.75:
            confidence_buckets["medium (0.75-0.9)"] += 1
        else:
            confidence_buckets["low (<0.75)"] += 1
    revenue = estimate_revenue_impact(satisfied)
    run = repo.get_run(run_id) or {}
    return JSONResponse({
        "total_documents": total_docs,
        "total_evidence": len(satisfied),
        "gap_closure_members": gap_closure,
        "by_measure": by_measure,
        "by_document_type": by_doc_type,
        "by_scenario": by_scenario,
        "confidence_buckets": confidence_buckets,
        "revenue": revenue,
        "run_id": run_id,
        "status": run.get("status") or "idle",
    })


def _empty_dashboard() -> dict:
    return {
        "total_documents": 0,
        "total_evidence": 0,
        "gap_closure_members": 0,
        "by_measure": {k: {"code": k, "name": v["name"], "description": v["description"], "count": 0, "priority": v["priority"]} for k, v in MEASURES.items()},
        "by_document_type": {},
        "by_scenario": {},
        "confidence_buckets": {"high (>=0.9)": 0, "medium (0.75-0.9)": 0, "low (<0.75)": 0},
        "revenue": {"total_usd": 0, "by_measure": {}},
        "run_id": "",
        "status": "idle",
    }


@router.get("/documents")
async def list_docs(run_id: str | None = None, limit: int = 500, offset: int = 0,
                    search: str = "", scenario: str = "",
                    authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse({"total": 0, "items": []})
    total, items = repo.list_documents(run_id=run_id, limit=limit, offset=offset,
                                       search=search, scenario=scenario)
    return JSONResponse({"total": total, "items": items})


@router.get("/documents/{document_id}")
async def document_detail(document_id: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    doc = repo.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return JSONResponse(doc)


@router.get("/documents/{document_id}/xml", response_class=PlainTextResponse)
async def document_xml(document_id: str, authorization: str | None = Header(default=None)):
    require_session(authorization)
    doc = repo.get_document(document_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc.get("raw_xml") or ""


@router.get("/documents/{document_id}/steps")
async def document_steps(document_id: str, run_id: str | None = None,
                         authorization: str | None = Header(default=None)):
    """Per-agent transformation timeline for a single document."""
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse({"items": []})
    items = repo.list_steps(run_id=run_id, document_id=document_id, limit=50)
    return JSONResponse({"items": items, "run_id": run_id, "document_id": document_id})


@router.get("/steps")
async def run_steps(run_id: str | None = None, agent: str = "", limit: int = 200,
                    authorization: str | None = Header(default=None)):
    """All per-document step events for a run (optionally filtered by agent)."""
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse({"items": []})
    items = repo.list_steps(run_id=run_id, agent=agent or None, limit=limit)
    return JSONResponse({"items": items, "run_id": run_id})


@router.get("/evidence")
async def list_evidence(measure: str = "", patient_id: str = "", limit: int = 1000,
                        run_id: str | None = None,
                        authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    items = repo.list_hits(run_id=run_id, measure=measure, patient_id=patient_id, limit=limit) if run_id else []
    return JSONResponse({"total": len(items), "items": items})


@router.post("/documents/preview")
async def preview_document(payload: dict[str, Any] = Body(...),
                           authorization: str | None = Header(default=None)):
    require_session(authorization)
    xml = payload.get("xml") or ""
    if not xml.strip():
        raise HTTPException(status_code=400, detail="xml is required")
    parsed = parse_ccda(xml)
    hits = evaluate_document(parsed)
    revenue = estimate_revenue_impact(hits)
    return JSONResponse({"parsed": parsed, "hits": hits, "revenue": revenue})


@router.get("/sample")
async def get_sample(scenario: str = "FUM_CLOSED", authorization: str | None = Header(default=None)):
    require_session(authorization)
    batch = generate_batch(count=12)
    chosen = next((b for b in batch if scenario in b["metadata"]["scenario"]), batch[0])
    parsed = parse_ccda(chosen["xml"])
    hits = evaluate_document(parsed)
    return JSONResponse({
        "metadata": chosen["metadata"],
        "xml": chosen["xml"],
        "parsed": parsed,
        "hits": hits,
    })


@router.get("/logs")
async def get_logs(run_id: str | None = None, limit: int = 200,
                   authorization: str | None = Header(default=None)):
    require_session(authorization)
    run_id = run_id or repo.latest_run_id()
    if not run_id:
        return JSONResponse({"logs": []})
    return JSONResponse({"logs": list(reversed(repo.read_logs(run_id, limit=limit)))})


@router.get("/activity")
async def get_activity(limit: int = 150, authorization: str | None = Header(default=None)):
    """Platform activity tail — HTTP requests, pipeline milestones, seeds, uploads.

    Used by the 'System Activity' drawer to let clients see the real work
    the platform is doing in real time.
    """
    require_session(authorization)
    return JSONResponse({"items": repo.read_activity(limit=limit)})
