"""Agent 2 - Transformation Agent - dynamic mapping driven"""
import json
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Dict, Any
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state
from dynamic_fhir_engine import build_fhir_resource, validate_fhir_resource, stringify

ANOMALY_FILE = Path(__file__).parent.parent / "anomalies.jsonl"


def quarantine_anomaly(record: Dict[str, Any], reason: str) -> None:
    entry = {"timestamp": datetime.now(timezone.utc).isoformat(), "reason": reason, "record": record}
    with open(ANOMALY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(entry, default=str) + "\n")


async def transform_batch(
    records: List[Dict[str, Any]],
    table: str,
    mapping_summary: List[Dict[str, Any]],
    run_id: str = "",
) -> Dict[str, Any]:
    transformed = []
    anomalies = []
    trace_log = []
    validation_errors = []
    review_items = []

    table_mapping = next((m for m in mapping_summary if m["table"] == table), None)
    if not table_mapping:
        raise ValueError(f"No mapping summary found for table '{table}'")

    resource_type = table_mapping["resource"]
    fields = table_mapping["fields"]
    auto_mapped_fields = [f for f in fields if f["status"] == "auto_mapped"]
    review_fields = [f for f in fields if f["status"] == "requires_review"]

    for idx, raw in enumerate(records):
        resource, trace = build_fhir_resource(resource_type, raw, auto_mapped_fields)
        errors = validate_fhir_resource(resource)
        review_trace = []

        for rf in review_fields:
            val = raw.get(rf["source_column"])
            if val is not None and stringify(val) != "":
                review_trace.append({
                    "source_column": rf["source_column"],
                    "source_value": stringify(val),
                    "candidate_target": rf.get("target_field"),
                    "confidence": rf["confidence"],
                    "reason": rf["reason"],
                })

        trace_log.append({
            "record_index": idx,
            "resource_type": resource_type,
            "trace": trace,
            "review_trace": review_trace,
            "resource": resource,
        })

        if errors:
            anomaly = {
                "source_record": raw,
                "resource_type": resource_type,
                "generated_resource": resource,
                "errors": errors,
            }
            anomalies.append(anomaly)
            validation_errors.append({
                "table": table,
                "record_index": idx,
                "errors": errors,
                "resource_type": resource_type,
            })
            quarantine_anomaly(raw, "; ".join(errors))
        else:
            transformed.append(resource)

        if review_trace:
            review_items.append({
                "table": table,
                "record_index": idx,
                "resource_type": resource_type,
                "fields": review_trace,
            })

    stats = {
        "total": len(records),
        "converted": len(transformed),
        "requires_review": len(review_items),
        "failed": len(anomalies),
        "resource_type": resource_type,
        "auto_mapped_fields": len(auto_mapped_fields),
        "review_fields": len(review_fields),
    }

    entry = log_entry_sync(
        "transformation",
        f"Transformed batch of {len(records)} {table} records into {resource_type}",
        "success",
        len(transformed),
        f"Converted: {len(transformed)}, Review: {len(review_items)}, Failed: {len(anomalies)}",
        run_id=run_id,
    )
    await ws_manager.send_audit_entry(entry)
    pipeline_state.update_agent(
        "transformation", "running",
        f"Transformed {len(transformed)}/{len(records)} {table} rows into {resource_type}",
        len(transformed)
    )
    await ws_manager.send_agent_status(
        "transformation", "running",
        f"Transformed {len(transformed)}/{len(records)} {table} rows into {resource_type}",
        len(transformed)
    )

    return {
        "resource_type": resource_type,
        "transformed_records": transformed,
        "anomalies": anomalies,
        "stats": stats,
        "trace_log": trace_log,
        "validation_errors": validation_errors,
        "review_items": review_items,
    }
