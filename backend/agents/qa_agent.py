"""
Agent 4 - QA / Reconciliation Agent

Dynamic post-load reconciliation. No hardcoded source column names.
All comparisons are driven by the mapping contract established during discovery:
  - Source row counts vs loaded FHIR resource counts
  - Per-resource-type record integrity
  - FHIR R4 required field completeness on loaded resources
"""
import hashlib
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state


def _norm(v: Any) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    try:
        return str(float(s))
    except (ValueError, TypeError):
        pass
    if len(s) >= 10 and s[4:5] == '-':
        return s[:10]
    return s.lower()


def _checksum_values(values: List[Any]) -> str:
    return hashlib.md5("|".join(sorted(_norm(v) for v in values)).encode()).hexdigest()


def _extract_fhir_field(resource: Dict[str, Any], fhir_path: str) -> Any:
    """
    Navigate a FHIR resource using a dot-notation path.
    e.g. 'total.value', 'billablePeriod.start', 'patient.reference'
    """
    parts = fhir_path.split('.')
    cur: Any = resource
    for part in parts:
        if cur is None:
            return None
        import re
        m = re.match(r'(.+)\[(\d+)\]$', part)
        if m:
            name, idx = m.group(1), int(m.group(2))
            arr = cur.get(name) if isinstance(cur, dict) else None
            cur = arr[idx] if isinstance(arr, list) and idx < len(arr) else None
        else:
            cur = cur.get(part) if isinstance(cur, dict) else None
    return cur


def _build_source_checksums(
    source_rows: List[Dict[str, Any]],
    field_mappings: List[Dict[str, Any]],
) -> Dict[str, str]:
    """
    Build checksums of source values after applying the SAME deterministic
    transformation the Transformation Agent applied when writing to FHIR.
    Without this, every check would fail: raw "M001" vs Patient/<uuid>,
    raw Decimal('450.00') vs float 450.0, raw datetime(...) vs "2024-01-15".
    The post-load integrity check is only meaningful if we compare
    "what FHIR SHOULD contain" (source after classify_value) with
    "what FHIR actually contains".
    """
    from dynamic_fhir_engine import classify_value
    result = {}
    auto_mapped = [f for f in field_mappings if f.get("status") == "auto_mapped" and f.get("source_column") and f.get("target_field")]
    for mapping in auto_mapped:
        col = mapping["source_column"]
        target = str(mapping["target_field"])
        transformed = []
        for r in source_rows:
            v = r.get(col)
            if v is None:
                transformed.append(None)
                continue
            try:
                transformed.append(classify_value(target, col, v))
            except Exception:
                transformed.append(v)
        result[col] = _checksum_values(transformed)
    return result


def _build_fhir_checksums(
    fhir_resources: List[Dict[str, Any]],
    field_mappings: List[Dict[str, Any]],
) -> Dict[str, str]:
    """
    Build checksums of FHIR values for each auto-mapped target field.
    Returns: { source_column → checksum_of_fhir_values }
    """
    result = {}
    auto_mapped = [f for f in field_mappings if f.get("status") == "auto_mapped" and f.get("target_field")]
    for mapping in auto_mapped:
        col = mapping["source_column"]
        # Strip resource type prefix to get navigable path
        raw = str(mapping["target_field"])
        fhir_path = raw.split('.', 1)[1] if '.' in raw else raw
        values = [_extract_fhir_field(r, fhir_path) for r in fhir_resources]
        result[col] = _checksum_values(values)
    return result


def _check_fhir_completeness(resources: List[Dict[str, Any]], resource_type: str) -> Dict[str, Any]:
    """
    Check FHIR R4 required field presence across all loaded resources of a given type.
    Returns per-field pass rates without hardcoding source column names.
    """
    from dynamic_fhir_engine import validate_fhir_resource
    if not resources:
        return {"total": 0, "valid": 0, "violations": 0, "error_breakdown": {}}

    total = len(resources)
    violations = 0
    error_breakdown: Dict[str, int] = {}

    for r in resources:
        errors = validate_fhir_resource(r)
        if errors:
            violations += 1
            for e in errors:
                error_breakdown[e] = error_breakdown.get(e, 0) + 1

    return {
        "total": total,
        "valid": total - violations,
        "violations": violations,
        "violation_rate": round(violations / total * 100, 1) if total else 0,
        "error_breakdown": error_breakdown,
    }


async def run_reconciliation(
    # source_* and transformed_* are lists of (rows, resources) per resource type
    # Passed as generic lists — not typed as members/claims/eligibility
    all_source: Dict[str, List[Dict[str, Any]]],       # { table_name: [rows] }
    all_transformed: Dict[str, List[Dict[str, Any]]],  # { table_name: [fhir_resources] }
    mapping_summary: List[Dict[str, Any]],             # from pipeline_state.schema_mapping
    loaded_count: int,
    anomaly_count: int,
    run_id: str = "",
) -> Dict[str, Any]:
    pipeline_state.update_agent("qa", "running", "Starting post-load reconciliation")
    await ws_manager.send_agent_status("qa", "running", "Starting post-load reconciliation", 0)
    await ws_manager.send_audit_entry(log_entry_sync("qa", "Post-load reconciliation started", "pending", loaded_count, run_id=run_id))

    source_total = sum(len(rows) for rows in all_source.values())
    target_total = loaded_count

    # --- Per-table checksum validation ---
    checksum_results: Dict[str, Any] = {}
    total_violations = 0
    completeness_by_type: Dict[str, Any] = {}

    for table_map in mapping_summary:
        table = table_map["table"]
        resource_type = table_map["resource"]
        field_mappings = table_map.get("fields", [])

        src_rows = all_source.get(table, [])
        fhir_rows = all_transformed.get(table, [])

        # Count-based integrity
        count_match = len(src_rows) == len(fhir_rows)

        # Value-level checksums for auto-mapped fields
        src_checksums = _build_source_checksums(src_rows, field_mappings)
        fhir_checksums = _build_fhir_checksums(fhir_rows, field_mappings)

        field_checksum_results = {}
        for col in src_checksums:
            field_checksum_results[col] = src_checksums[col] == fhir_checksums.get(col, "")

        # FHIR completeness check
        completeness = _check_fhir_completeness(fhir_rows, resource_type)
        total_violations += completeness["violations"]
        completeness_by_type[resource_type] = completeness

        checksum_results[table] = {
            "resource_type": resource_type,
            "source_count": len(src_rows),
            "fhir_count": len(fhir_rows),
            "count_match": count_match,
            "field_checksums": field_checksum_results,
            "fields_checked": len(field_checksum_results),
            "fields_passing": sum(1 for v in field_checksum_results.values() if v),
        }

    match_pct = round((min(source_total, target_total) / max(source_total, 1)) * 100, 1)

    report: Dict[str, Any] = {
        "source_count": source_total,
        "target_count": target_total,
        "match_pct": match_pct,
        "matched": target_total - anomaly_count,
        "mismatched": anomaly_count,
        "missing": max(0, source_total - target_total),
        "violations": total_violations,
        "anomalies_quarantined": anomaly_count,
        "checksum_results": checksum_results,
        "completeness_by_type": completeness_by_type,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    pipeline_state.reconciliation = report

    checksum_summary = "; ".join(
        f"{t}: {v['fields_passing']}/{v['fields_checked']} fields pass checksum"
        for t, v in checksum_results.items()
    )
    detail_str = (
        f"Source: {source_total}, Loaded: {target_total}, Match: {match_pct}%, "
        f"FHIR violations: {total_violations}. {checksum_summary}"
    )

    await ws_manager.send_audit_entry(log_entry_sync("qa", "Reconciliation complete", "success", target_total, detail_str, run_id=run_id))
    pipeline_state.update_agent("qa", "success", f"Reconciliation done - {match_pct}% match", target_total)
    await ws_manager.send_agent_status("qa", "success", f"Reconciliation complete: {match_pct}% match", target_total)
    await ws_manager.broadcast("RECONCILIATION_COMPLETE", {"report": report})
    await ws_manager.send_log_message(
        f"QA complete - {match_pct}% match rate, {total_violations} FHIR violations",
        "info" if total_violations == 0 else "warning", run_id
    )
    return report
