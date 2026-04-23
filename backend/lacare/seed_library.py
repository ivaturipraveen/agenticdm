"""Idempotent seeding of the curated CCDA sample library.

Called once at server startup (see main.py). If the DB already has the
target count of samples, this is a no-op — so restarts are cheap.

We generate a modest, diverse set of scenarios covering every HEDIS
measure the platform evaluates (FUM, FUA, CBP, HBD, MRP) plus negative
controls (NO_EVIDENCE). Keeping the seed count small (default 30)
means demos start instantly and the Sample Library view stays focused.
"""
from __future__ import annotations

from .ccda_parser import parse_ccda
from .sample_data import generate_batch
from . import repository as repo


SCENARIO_LABEL = {
    "FUM_CLOSED": "FUM — 7-day BH follow-up after ED (closed)",
    "FUM_CLOSED_30": "FUM — 30-day BH follow-up after ED",
    "FUA_CLOSED": "FUA — 7-day AOD follow-up after ED",
    "CBP_CONTROLLED": "CBP — Blood pressure controlled",
    "CBP_UNCONTROLLED": "CBP — Blood pressure uncontrolled",
    "HBD_CONTROLLED": "HBD — HbA1c <8% (controlled)",
    "HBD_UNCONTROLLED": "HBD — HbA1c ≥8% (uncontrolled)",
    "MRP_CLOSED": "MRP — Medication reconciliation post-discharge",
    "NO_EVIDENCE": "No evidence — claims-only, nothing to find",
}

SCENARIO_MEASURE = {
    "FUM_CLOSED": "FUM", "FUM_CLOSED_30": "FUM",
    "FUA_CLOSED": "FUA",
    "CBP_CONTROLLED": "CBP", "CBP_UNCONTROLLED": "CBP",
    "HBD_CONTROLLED": "HBD", "HBD_UNCONTROLLED": "HBD",
    "MRP_CLOSED": "MRP",
    "NO_EVIDENCE": "",
}


def seed_library(target_count: int = 30, force: bool = False) -> dict:
    """Ensure the `lacare_samples` table has at least `target_count` rows.

    Returns a small summary dict with before/after counts for logging.
    """
    existing = repo.sample_count()
    if existing >= target_count and not force:
        return {"status": "already_seeded", "total": existing, "inserted": 0}

    batch = generate_batch(count=target_count, seed=42)
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
        summary = meta.get("summary") or meta.get("scenario_label") or SCENARIO_LABEL.get(scenario, scenario)
        repo.insert_sample(
            sample_id=sample_id,
            scenario=scenario,
            scenario_label=SCENARIO_LABEL.get(scenario, scenario),
            document_type=parsed.get("document_type") or "Clinical Document",
            patient_id=patient.get("id") or meta.get("member_id") or "",
            patient_name=patient.get("name") or meta.get("member_name") or "",
            facility=enc.get("facility", ""),
            encounter_date=(enc.get("effective_time") or {}).get("value", ""),
            section_count=len(sections_map),
            entry_count=sum(len(v) for v in sections_map.values()),
            narrative_chars=sum(len(v or "") for v in narrative_map.values()),
            expected_measure=SCENARIO_MEASURE.get(scenario, ""),
            summary=summary,
            raw_xml=item["xml"],
            parsed_json=parsed,
        )
        inserted += 1
    return {
        "status": "seeded",
        "total": repo.sample_count(),
        "inserted": inserted,
    }
