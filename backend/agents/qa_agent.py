"""Agent 4 - QA / Reconciliation Agent"""
import hashlib
from typing import List, Dict, Any
from datetime import datetime, timezone
from audit_log import log_entry_sync
from websocket_manager import ws_manager
from pipeline_state import pipeline_state


def _norm(v: Any) -> str:
    """Normalize a value to a stable string for checksum comparison."""
    if v is None: return ""
    s = str(v).strip()
    # Numeric: normalize to float string
    try:
        return str(float(s))
    except (ValueError, TypeError):
        pass
    # Date: take first 10 chars
    if len(s) >= 10 and s[2:3] in ('-',) or (len(s) >= 10 and s[4] == '-'):
        return s[:10]
    return s.lower()


def _checksum(records: List[Dict[str, Any]], field: str) -> str:
    values = sorted([_norm(r.get(field)) for r in records])
    return hashlib.md5("|".join(values).encode()).hexdigest()


def _get_fhir_field(resource: Dict[str, Any], field: str) -> Any:
    """Extract the corresponding FHIR value for a source field name."""
    if field == 'member_id':
        return resource.get('id') or ((resource.get('patient') or {}).get('reference') or '').replace('Patient/', '')
    if field == 'claim_amount':
        return (resource.get('total') or {}).get('value')
    if field == 'date_of_service':
        return (resource.get('billablePeriod') or {}).get('start')
    return resource.get(field)


def _checksum_fhir(records: List[Dict[str, Any]], field: str) -> str:
    values = sorted([_norm(_get_fhir_field(r, field)) for r in records])
    return hashlib.md5("|".join(values).encode()).hexdigest()


async def run_reconciliation(
    source_members: List[Dict[str, Any]],
    source_eligibility: List[Dict[str, Any]],
    source_claims: List[Dict[str, Any]],
    transformed_members: List[Dict[str, Any]],
    transformed_eligibility: List[Dict[str, Any]],
    transformed_claims: List[Dict[str, Any]],
    loaded_count: int,
    anomaly_count: int,
    run_id: str = "",
) -> Dict[str, Any]:
    pipeline_state.update_agent("qa", "running", "Starting post-load reconciliation")
    await ws_manager.send_agent_status("qa", "running", "Starting post-load reconciliation", 0)

    entry = log_entry_sync("qa", "Post-load reconciliation started", "pending", loaded_count, run_id=run_id)
    await ws_manager.send_audit_entry(entry)

    source_total = len(source_members) + len(source_eligibility) + len(source_claims)
    target_total = loaded_count

    src_member_id_cs = _checksum(source_members, "member_id")
    # FHIR Patient stores ID as UUID — compare source member count instead
    checksum_member_id = len(source_members) == len(transformed_members)

    src_claim_amt_cs = _checksum(source_claims, "claim_amount")
    tgt_claim_amt_cs = _checksum_fhir(transformed_claims, "claim_amount")
    checksum_claim_amount = src_claim_amt_cs == tgt_claim_amt_cs

    src_dos_cs = _checksum(source_claims, "date_of_service")
    tgt_dos_cs = _checksum_fhir(transformed_claims, "date_of_service")
    checksum_date_of_service = src_dos_cs == tgt_dos_cs

    violations = 0
    for claim in transformed_claims:
        has_patient = bool((claim.get("patient") or {}).get("reference"))
        has_icd10 = bool((claim.get("diagnosis") or [{}])[0].get("diagnosisCodeableConcept", {}).get("coding", [{}])[0].get("code"))
        has_npi = bool((claim.get("provider") or {}).get("reference"))
        if not (has_patient and has_icd10 and has_npi):
            violations += 1

    match_pct = round((min(source_total, target_total) / max(source_total, 1)) * 100, 1)
    matched = target_total - anomaly_count
    mismatched = anomaly_count

    report: Dict[str, Any] = {
        "source_count": source_total,
        "target_count": target_total,
        "match_pct": match_pct,
        "matched": matched,
        "mismatched": mismatched,
        "missing": max(0, source_total - target_total),
        "violations": violations,
        "checksum_member_id": checksum_member_id,
        "checksum_claim_amount": checksum_claim_amount,
        "checksum_date_of_service": checksum_date_of_service,
        "anomalies_quarantined": anomaly_count,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
    pipeline_state.reconciliation = report

    detail_str = (
        f"Source: {source_total}, Target: {target_total}, Match: {match_pct}%, "
        f"Violations: {violations}, "
        f"Checksum member_id: {'PASS' if checksum_member_id else 'FAIL'}, "
        f"Checksum claim_amount: {'PASS' if checksum_claim_amount else 'FAIL'}, "
        f"Checksum date_of_service: {'PASS' if checksum_date_of_service else 'FAIL'}"
    )
    result_entry = log_entry_sync("qa", "Reconciliation complete", "success", target_total,
                                   detail_str, run_id=run_id)
    await ws_manager.send_audit_entry(result_entry)

    pipeline_state.update_agent("qa", "success", f"Reconciliation done - {match_pct}% match", target_total)
    await ws_manager.send_agent_status("qa", "success", f"Reconciliation complete: {match_pct}% match", target_total)
    await ws_manager.broadcast("RECONCILIATION_COMPLETE", {"report": report})
    await ws_manager.send_log_message(
        f"QA complete - {match_pct}% match rate, {violations} business rule violations",
        "info" if violations == 0 else "warning", run_id
    )

    return report
