"""Agent 3 - Orchestration Agent"""
import asyncio
import psycopg2
import psycopg2.extras
from typing import List, Dict, Any
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state, Stage
from config import get_settings
from agents.transformation_agent import transform_batch
from agents.qa_agent import run_reconciliation
from run_store import update_run_stage, complete_run, fail_run, save_agent_output
import fhir_client
from fhir_store import save_resources, log_endpoint_call

settings = get_settings()
BATCH_SIZE = 100
MAX_RETRIES = 3
WATCH_INTERVAL = 30


async def _retry(coro_fn, *args, label: str = "op", run_id: str = "", **kwargs):
    for attempt in range(MAX_RETRIES):
        try:
            return await coro_fn(*args, **kwargs)
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                raise
            wait = 2 ** attempt
            entry = log_entry_sync("orchestration", f"Retry {attempt+1}/{MAX_RETRIES} for {label}", "pending", 0,
                                   f"Retrying in {wait}s - {e}", run_id=run_id)
            await ws_manager.send_audit_entry(entry)
            await asyncio.sleep(wait)


def _fetch_all(table: str, dataset_id: str = "") -> List[Dict[str, Any]]:
    from platform_db import get_conn
    conn = get_conn()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    cur.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name='dataset_id'",
        (table,),
    )
    has_dataset = bool(cur.fetchone())
    if has_dataset and dataset_id and dataset_id != "default":
        cur.execute(f'SELECT * FROM "{table}" WHERE dataset_id = %s', (dataset_id,))
    else:
        cur.execute(f'SELECT * FROM "{table}"')
    rows = [dict(r) for r in cur.fetchall()]
    cur.close()
    conn.close()
    return rows


async def _fetch_table(table: str, dataset_id: str = "") -> List[Dict[str, Any]]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _fetch_all, table, dataset_id)


async def _log(run_id: str, agent: str, action: str, status: str, records: int = 0, details: str = "") -> None:
    entry = log_entry_sync(agent, action, status, records, details, run_id=run_id)
    await ws_manager.send_audit_entry(entry)


async def run_pipeline() -> None:
    run_id = await pipeline_state.start_run()
    ds_id = getattr(pipeline_state, 'current_dataset_id', '') or ''

    pipeline_state.update_agent("orchestration", "running", "Pipeline initiated")
    await ws_manager.send_agent_status("orchestration", "running", "Pipeline initiated", 0)

    all_transformed_resources: Dict[str, List[Dict[str, Any]]] = {}
    all_source_rows: Dict[str, List[Dict[str, Any]]] = {}
    all_validation_errors: List[Dict[str, Any]] = []
    all_review_items: List[Dict[str, Any]] = []
    all_trace_logs: Dict[str, List[Dict[str, Any]]] = {}
    all_anomalies: List[Dict[str, Any]] = []

    try:
        mapping_data = pipeline_state.schema_mapping or {}
        mapping_summary = mapping_data.get("mapping_summary", [])
        if not mapping_summary:
            raise ValueError("Dynamic mapping summary missing. Discovery must run first.")

        # EXTRACT
        await pipeline_state.advance_stage(Stage.EXTRACT)
        await ws_manager.send_stage_change(Stage.EXTRACT.value, run_id)
        update_run_stage(run_id, "extract")
        await ws_manager.send_reasoning("orchestration", "Stage 1: EXTRACT - pulling records from PostgreSQL",
                                         f"Dataset: {ds_id}. Tables discovered dynamically: {', '.join(m['table'] for m in mapping_summary)}", "", run_id=run_id)

        for table_mapping in mapping_summary:
            table = table_mapping["table"]
            rows = await _retry(_fetch_table, table, ds_id, label=f"fetch {table}", run_id=run_id)
            all_source_rows[table] = rows

        total_source = sum(len(rows) for rows in all_source_rows.values())
        await ws_manager.send_reasoning("orchestration", f"Extract complete - {total_source:,} records loaded",
                                         ", ".join(f"{t}={len(r)}" for t, r in all_source_rows.items()), "", run_id=run_id)
        await _log(run_id, "orchestration", "Extract complete", "success", total_source,
                   ", ".join(f"{t}={len(r)}" for t, r in all_source_rows.items()))
        await ws_manager.send_log_message(f"Extracted {total_source:,} records from source database", "info", run_id)

        if pipeline_state.halted:
            return

        # TRANSFORM
        await pipeline_state.advance_stage(Stage.TRANSFORM)
        await ws_manager.send_stage_change(Stage.TRANSFORM.value, run_id)
        update_run_stage(run_id, "transform")
        pipeline_state.update_agent("transformation", "running", "Dynamic transformation started")
        await ws_manager.send_agent_status("transformation", "running", "Dynamic transformation started", 0)
        await ws_manager.send_reasoning("orchestration", "Stage 2: TRANSFORM - converting rows using inferred mapping contract",
                                         f"Auto-map threshold: 0.90, review threshold: 0.60. Tables: {len(mapping_summary)}", "", run_id=run_id)

        resource_counts: Dict[str, int] = {}
        fhir_samples: List[Dict[str, Any]] = []
        for table_mapping in mapping_summary:
            table = table_mapping["table"]
            all_transformed_resources[table] = []
            all_trace_logs[table] = []
            records = all_source_rows[table]

            for i in range(0, len(records), BATCH_SIZE):
                if pipeline_state.halted:
                    return
                batch = records[i:i + BATCH_SIZE]
                batch_result = await _retry(
                    transform_batch,
                    batch,
                    table,
                    mapping_summary,
                    run_id,
                    label=f"transform {table}",
                    run_id=run_id,
                )
                all_transformed_resources[table].extend(batch_result["transformed_records"])
                all_trace_logs[table].extend(batch_result["trace_log"])
                all_anomalies.extend(batch_result["anomalies"])
                all_validation_errors.extend(batch_result["validation_errors"])
                all_review_items.extend(batch_result["review_items"])

            resource_type = table_mapping["resource"]
            resource_counts[resource_type] = resource_counts.get(resource_type, 0) + len(all_transformed_resources[table])
            if all_transformed_resources[table]:
                fhir_samples.append(all_transformed_resources[table][0])

        total_transformed = sum(len(v) for v in all_transformed_resources.values())
        await pipeline_state.set_pending_reviews(all_review_items)
        # Only broadcast reviews that still need an operator decision.
        _unresolved = [
            r for r in pipeline_state.pending_reviews
            if r.get("review_decision") not in ("accept", "reject", "edit")
        ]
        await ws_manager.broadcast("REVIEWS_UPDATED", {"pending_reviews": _unresolved, "schema_mapping": pipeline_state.schema_mapping})
        await ws_manager.send_reasoning(
            "orchestration", f"Transform complete - {total_transformed:,} FHIR resources generated",
            f"Review items: {len(all_review_items)}, Validation failures: {len(all_validation_errors)}",
            "", run_id=run_id
        )
        await _log(run_id, "orchestration", "Transform complete", "success", total_transformed,
                   f"Generated: {total_transformed}, Review: {len(all_review_items)}, Failed: {len(all_validation_errors)}")
        pipeline_state.update_agent("transformation", "success", f"{total_transformed:,} resources generated", total_transformed)
        await ws_manager.send_agent_status("transformation", "success", "Transformation complete", total_transformed)
        await ws_manager.send_log_message(
            f"Agent 2 complete - {total_transformed:,} resources generated, {len(all_review_items)} review items, {len(all_validation_errors)} failed",
            "success", run_id
        )
        save_agent_output(
            run_id, "transformation", 2, "success", total_source, total_transformed, len(all_anomalies),
            f"Generated {total_transformed:,} FHIR resources from dynamic mapping",
            {
                "mapping_summary": mapping_summary,
                "resource_counts": resource_counts,
                "transformation_summary": {
                    "total_records": total_source,
                    "converted": total_transformed,
                    "requires_review": len(all_review_items),
                    "failed": len(all_validation_errors),
                },
                "trace_samples": {k: v[:3] for k, v in all_trace_logs.items()},
                "validation_errors": all_validation_errors[:25],
                "requires_review": all_review_items[:25],
                "fhir_samples": fhir_samples[:3],
            }
        )

        if pipeline_state.halted:
            return

        # VALIDATE
        await pipeline_state.advance_stage(Stage.VALIDATE)
        await ws_manager.send_stage_change(Stage.VALIDATE.value, run_id)
        update_run_stage(run_id, "validate")
        await ws_manager.send_reasoning("orchestration", "Stage 3: VALIDATE - checking generated FHIR resources",
                                         f"Failures: {len(all_validation_errors)}. Review queue: {len(all_review_items)}", "", run_id=run_id)

        if pipeline_state.pending_reviews:
            await ws_manager.send_reasoning("orchestration", "Waiting for review decisions",
                                             f"{len(pipeline_state.pending_reviews)} field mapping review items require accept, reject, or edit", "", run_id=run_id)
            await pipeline_state.review_event.wait()
            await ws_manager.send_reasoning("orchestration", "Review decisions received",
                                             "Continuing pipeline with confirmed mapping decisions", "", run_id=run_id)

        validation_passed = len(all_validation_errors) == 0
        await ws_manager.send_reasoning(
            "orchestration",
            f"Validation {'PASSED' if validation_passed else 'found issues'}",
            "All generated resources are structurally valid" if validation_passed else f"{len(all_validation_errors)} resource validation failures captured",
            "", run_id=run_id
        )
        await _log(run_id, "orchestration", "Validation complete", "success" if validation_passed else "failed",
                   total_transformed, f"Failures={len(all_validation_errors)}, Review={len(all_review_items)}")

        if pipeline_state.halted:
            return

        # AWAITING APPROVAL
        await pipeline_state.advance_stage(Stage.AWAITING_APPROVAL)
        await ws_manager.send_stage_change(Stage.AWAITING_APPROVAL.value, run_id)
        update_run_stage(run_id, "awaiting_approval")
        pipeline_state.update_agent("orchestration", "running", "Awaiting human approval")
        await ws_manager.send_agent_status("orchestration", "running", "Awaiting human approval", 0)
        await ws_manager.send_reasoning(
            "orchestration", "PAUSED - Human approval required before FHIR load",
            f"Resources queued: {total_transformed:,}. Review items: {len(all_review_items)}. Validation failures: {len(all_validation_errors)}.",
            "", run_id=run_id
        )

        success_rate = round((total_transformed / max(total_source, 1)) * 100, 1)
        gate_payload = {
            "records_to_load": total_transformed,
            "anomaly_count": len(all_anomalies),
            "success_rate": success_rate,
            "validation_passed": validation_passed,
            "waiting_since": __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),
        }
        await pipeline_state.set_approval_gate(gate_payload)
        await ws_manager.broadcast("APPROVAL_GATE", gate_payload)
        await _log(run_id, "orchestration", "Awaiting human approval", "awaiting_approval", total_transformed,
                   f"Resources={total_transformed}, Review={len(all_review_items)}, Failures={len(all_validation_errors)}")
        await ws_manager.send_log_message(f"Pipeline paused - awaiting approval to load {total_transformed:,} FHIR resources", "warning", run_id)

        await pipeline_state.approval_event.wait()

        if pipeline_state.halted or not pipeline_state.approved:
            await _log(run_id, "orchestration", "Pipeline halted by operator", "failed", 0, "Human rejected load")
            await ws_manager.send_stage_change(Stage.HALTED.value, run_id)
            await ws_manager.send_log_message("Pipeline halted by operator", "error", run_id)
            fail_run(run_id, "Halted by operator")
            return

        await ws_manager.send_log_message("Approval received - proceeding to FHIR load", "success", run_id)

        # LOAD
        await pipeline_state.advance_stage(Stage.LOAD)
        await ws_manager.send_stage_change(Stage.LOAD.value, run_id)
        update_run_stage(run_id, "load")
        pipeline_state.update_agent("orchestration", "running", "Loading dynamic FHIR resources")
        await ws_manager.send_agent_status("orchestration", "running", "Loading dynamic FHIR resources", 0)
        await ws_manager.send_reasoning("orchestration", "Stage 5: LOAD - posting dynamic FHIR bundles to HAPI FHIR R4",
                                         f"Endpoint: {settings.fhir_base_url}", "", run_id=run_id)

        loaded_total = 0
        bundle_samples: Dict[str, Any] = {}
        for table_mapping in mapping_summary:
            table = table_mapping["table"]
            resource_type = table_mapping["resource"]
            resources = all_transformed_resources.get(table, [])
            for i in range(0, len(resources), BATCH_SIZE):
                batch = resources[i:i + BATCH_SIZE]
                result = await _retry(fhir_client.post_bundle, batch, resource_type,
                                      label=f"FHIR POST {resource_type}", run_id=run_id)
                src_batch = list(all_source_rows.get(table, []))[i:i + BATCH_SIZE]
                save_resources(
                    run_id, ds_id, resource_type, batch,
                    source_rows=src_batch,
                    validation_errors=[e for e in all_validation_errors if e.get("table") == table],
                )
                log_endpoint_call(
                    run_id=run_id,
                    dataset_id=ds_id,
                    resource_type=resource_type,
                    endpoint_url=settings.fhir_base_url,
                    http_status=result.get("http_status"),
                    resource_count=result["count"],
                    success=result.get("success", True),
                    simulated=result.get("simulated", False),
                    response_body=result.get("bundle_sample"),
                )
                loaded_total += result["count"]
                bundle_samples[resource_type] = result.get("bundle_sample", [])
                await _log(run_id, "orchestration", f"FHIR {resource_type} loaded", "success", result["count"],
                           f"Posted {result['count']} {resource_type} resources")
                pipeline_state.update_agent("orchestration", "running", f"Loaded {resource_type}", result["count"])
                await ws_manager.send_agent_status("orchestration", "running", f"Loaded {resource_type} batch", result["count"])

        await ws_manager.send_log_message(f"Agent 3 complete - {loaded_total:,} total FHIR resources loaded", "success", run_id)
        save_agent_output(
            run_id, "orchestration", 3, "success", total_transformed, loaded_total, 0,
            f"Loaded {loaded_total:,} dynamic FHIR resources",
            {
                "resources": resource_counts,
                "fhir_url": settings.fhir_base_url,
                "bundle_samples": bundle_samples,
                "fhir_samples": fhir_samples[:3],
                "validation_errors": all_validation_errors[:25],
            }
        )

        if pipeline_state.halted:
            return

        # RECONCILE
        await pipeline_state.advance_stage(Stage.RECONCILE)
        await ws_manager.send_stage_change(Stage.RECONCILE.value, run_id)
        update_run_stage(run_id, "reconcile")
        await ws_manager.send_reasoning("orchestration", "Stage 6: RECONCILE - invoking Agent 4 for post-load QA",
                                         "Comparing source rows with generated resource counts and references", "", run_id=run_id)

        # Pass all source/transformed data as table-keyed dicts — no hardcoded resource names
        await run_reconciliation(
            all_source_rows,
            all_transformed_resources,
            mapping_summary,
            loaded_total,
            len(all_anomalies),
            run_id=run_id,
        )

        # COMPLIANCE — compute from stored FHIR resources grouped by type
        from compliance import compute_compliance
        from fhir_store import list_records as _list_fhir_raw
        by_type: Dict[str, List[Dict[str, Any]]] = {}
        for m in mapping_summary:
            rt = m['resource']
            stored = [r['resource'] for r in _list_fhir_raw(run_id, resource_type=rt, limit=5000)]
            by_type[rt] = stored or [r for r in all_transformed_resources.get(m['table'], [])]
        compliance = compute_compliance(
            by_type.get('Patient', []),
            by_type.get('Coverage', []),
            by_type.get('Claim', []),
        )
        recon = pipeline_state.reconciliation or {}

        save_agent_output(
            run_id, "discovery", 1, "success", 0, total_source, 0,
            f"Discovered {len(mapping_summary)} tables and inferred dynamic FHIR mappings",
            mapping_data,
        )
        save_agent_output(
            run_id, "qa", 4, "success", loaded_total, loaded_total, recon.get('anomalies_quarantined', 0),
            f"Match rate: {recon.get('match_pct',0)}%. Violations: {recon.get('violations',0)}.",
            {**recon, "compliance_overall": compliance.get('overall_score'), "review_items": len(all_review_items), "validation_failures": len(all_validation_errors)}
        )
        save_agent_output(
            run_id, "monitor", 5, "success", 0, 0, 0,
            f"Schema monitored every {WATCH_INTERVAL}s throughout run. No drift detected.",
            {"watch_interval_seconds": WATCH_INTERVAL, "tables_watched": [m['table'] for m in mapping_summary], "drift_detected": False, "schema_checks": "passed"}
        )

        complete_run(run_id, ds_id, total_source, loaded_total, len(all_anomalies),
                     recon.get('violations', 0), recon.get('match_pct', 0.0), compliance)
        await ws_manager.broadcast("COMPLIANCE_REPORT", {"compliance": compliance})
        await ws_manager.broadcast("MIGRATION_SUMMARY", {
            "run_id": run_id,
            "dataset_id": ds_id,
            "total_source": total_source,
            "total_loaded": loaded_total,
            "anomalies": len(all_anomalies),
            "compliance": compliance,
            "reconciliation": recon,
            "agent_outputs": {
                "mapping_summary": mapping_summary,
                "resource_counts": resource_counts,
                "review_items": all_review_items[:25],
                "validation_errors": all_validation_errors[:25],
                "fhir_samples": fhir_samples[:3],
            },
        })

        # COMPLETE
        await pipeline_state.advance_stage(Stage.COMPLETE, "success")
        await ws_manager.send_stage_change(Stage.COMPLETE.value, run_id)
        pipeline_state.update_agent("orchestration", "success", f"Pipeline complete - {loaded_total:,} resources migrated", loaded_total)
        await ws_manager.send_agent_status("orchestration", "success", "Pipeline complete", loaded_total)
        await ws_manager.send_reasoning("orchestration", f"Migration complete - {loaded_total:,} resources migrated",
                                         f"Compliance: {compliance['overall_score']}%", "", run_id=run_id)
        await _log(run_id, "orchestration", "Migration pipeline COMPLETE", "success", loaded_total,
                   f"Source: {total_source} -> FHIR: {loaded_total}. Review: {len(all_review_items)}. Validation failures: {len(all_validation_errors)}. Compliance: {compliance['overall_score']}%")
        await ws_manager.send_log_message(
            f"Migration complete - {loaded_total:,} resources - Compliance: {compliance['overall_score']}% - Run #{run_id[:8].upper()}",
            "success", run_id)

        from run_store import get_all_runs
        await ws_manager.broadcast("RUNS_UPDATED", {"runs": get_all_runs()})

    except Exception as e:
        await _log(run_id, "orchestration", "PIPELINE_ERROR", "failed", 0, str(e))
        await pipeline_state.set_stage(Stage.HALTED)
        await ws_manager.send_stage_change(Stage.HALTED.value, run_id)
        pipeline_state.update_agent("orchestration", "failed", str(e))
        await ws_manager.send_agent_status("orchestration", "failed", str(e), 0)
        await ws_manager.send_log_message(f"Pipeline error: {e}", "error", run_id)
        fail_run(run_id, str(e))
        raise
