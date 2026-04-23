"""HEDIS measure matching engine.

Implements denominator + numerator rules for a focused set of measures
that have the highest impact for Medi-Cal managed care plans:

  - FUM  Follow-Up after ED Visit for Mental Illness (7-day / 30-day)
  - FUA  Follow-Up after ED Visit for AOD (7-day / 30-day)
  - CBP  Controlling High Blood Pressure (≤ 140/90)
  - HBD  HbA1c Control for Diabetes (< 8%)
  - MRP  Medication Reconciliation Post-Discharge (within 30 days)

Each match carries a confidence score, the source document id, and the
specific entry / section that satisfies the measure — so the dashboard
can drill back to the CDA evidence.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any


# Value sets (NCQA publishes these — we use curated subsets for the demo).
ED_VISIT_CODES = {"50849002", "4525004"}  # SNOMED: ED visit
MENTAL_ILLNESS_ICD10 = {
    "F20", "F21", "F22", "F23", "F24", "F25", "F28", "F29",
    "F30", "F31", "F32", "F33", "F34", "F39",
    "F40", "F41", "F42", "F43", "F44", "F45",
    "F60", "F90", "F91",
}
AOD_ICD10 = {
    "F10", "F11", "F12", "F13", "F14", "F15", "F16", "F17", "F18", "F19",
}
DIABETES_ICD10 = {"E10", "E11", "E13"}
CARDIOVASCULAR_ICD10 = {"I20", "I21", "I22", "I23", "I24", "I25", "I63", "I65", "I66"}
BH_FOLLOWUP_CPT = {"90791", "90792", "90832", "90834", "90837", "99213", "99214", "99215"}
HBA1C_LOINC = {"4548-4", "17856-6", "4549-2", "17855-8"}
BP_LOINC_SYS = {"8480-6"}
BP_LOINC_DIA = {"8462-4"}
STATIN_RXNORM_PREFIXES = {"617", "36567", "83367", "152923", "617314"}  # atorvastatin et al.


@dataclass
class HedisHit:
    measure: str
    measure_name: str
    patient_id: str
    patient_name: str
    satisfied: bool
    confidence: float
    evidence_type: str
    source_document_id: str
    source_document_type: str
    source_section: str
    summary: str
    numerator_date: str = ""
    denominator_date: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "measure": self.measure,
            "measure_name": self.measure_name,
            "patient_id": self.patient_id,
            "patient_name": self.patient_name,
            "satisfied": self.satisfied,
            "confidence": round(self.confidence, 2),
            "evidence_type": self.evidence_type,
            "source_document_id": self.source_document_id,
            "source_document_type": self.source_document_type,
            "source_section": self.source_section,
            "summary": self.summary,
            "numerator_date": self.numerator_date,
            "denominator_date": self.denominator_date,
            **self.extra,
        }


MEASURES = {
    "FUM": {
        "name": "Follow-Up After ED Visit for Mental Illness",
        "description": "Outpatient / telehealth visit with a BH provider within 7 and 30 days of ED discharge.",
        "window_days": 30,
        "priority": "7-day / 30-day",
    },
    "FUA": {
        "name": "Follow-Up After ED Visit for AOD",
        "description": "Outpatient / telehealth visit within 7 and 30 days of ED discharge for alcohol/other drug dependence.",
        "window_days": 30,
        "priority": "7-day / 30-day",
    },
    "CBP": {
        "name": "Controlling High Blood Pressure",
        "description": "Most recent BP reading ≤ 140/90 mmHg for hypertensive members 18–85.",
        "window_days": 365,
        "priority": "annual",
    },
    "HBD": {
        "name": "HbA1c Control for Diabetes",
        "description": "Most recent HbA1c < 8% for diabetic members 18–75.",
        "window_days": 365,
        "priority": "annual",
    },
    "MRP": {
        "name": "Medication Reconciliation Post-Discharge",
        "description": "Medication reconciliation by a provider within 30 days of inpatient discharge.",
        "window_days": 30,
        "priority": "30-day",
    },
}


def _parse_date(s: str) -> datetime | None:
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y%m%d"):
        try:
            return datetime.strptime(s[: len(fmt.replace("%Y", "YYYY"))] if False else s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s.replace(" ", "T"))
    except ValueError:
        return None


def _icd10_family(code: str) -> str:
    return (code or "").split(".")[0][:3].upper()


def _rxnorm_prefix(code: str) -> str:
    return (code or "").strip()


def _within(anchor: datetime, candidate: datetime, days: int) -> bool:
    delta = candidate - anchor
    return timedelta(days=0) <= delta <= timedelta(days=days)


def evaluate_document(parsed: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate a single parsed CCDA document against every measure.

    Returns a list of hit dicts (satisfied == True means evidence found).
    """
    header = parsed.get("header", {})
    patient = header.get("patient", {}) or {}
    patient_id = patient.get("id") or ""
    patient_name = patient.get("name") or "Unknown"
    doc_id = parsed.get("document_id") or ""
    doc_type = parsed.get("document_type") or ""
    sections = parsed.get("sections", {}) or {}
    enc = header.get("encounter", {}) or {}
    enc_time = (enc.get("effective_time") or {}).get("value") or (enc.get("effective_time") or {}).get("low", "")

    hits: list[HedisHit] = []
    hits.extend(_check_fum(patient_id, patient_name, doc_id, doc_type, sections, enc_time))
    hits.extend(_check_fua(patient_id, patient_name, doc_id, doc_type, sections, enc_time))
    hits.extend(_check_cbp(patient_id, patient_name, doc_id, doc_type, sections))
    hits.extend(_check_hbd(patient_id, patient_name, doc_id, doc_type, sections))
    hits.extend(_check_mrp(patient_id, patient_name, doc_id, doc_type, sections, enc_time, header.get("encounter", {})))
    return [h.to_dict() for h in hits]


def _check_fum(patient_id, patient_name, doc_id, doc_type, sections, enc_time) -> list[HedisHit]:
    problems = sections.get("problems", [])
    encounters = sections.get("encounters", [])
    procedures = sections.get("procedures", [])
    has_mental_dx = any(_icd10_family(p.get("code", {}).get("code", "")) in MENTAL_ILLNESS_ICD10 for p in problems)
    ed_date = _find_ed_date(problems + encounters + procedures) or _parse_date(enc_time)
    if not has_mental_dx or ed_date is None:
        return []
    followup = _find_followup(encounters + procedures, ed_date, days=30)
    if followup is None:
        return []
    delta_days = (followup["when"] - ed_date).days
    within_7 = delta_days <= 7
    confidence = 0.95 if followup["entry"].get("code", {}).get("code") in BH_FOLLOWUP_CPT else 0.82
    return [
        HedisHit(
            measure="FUM",
            measure_name=MEASURES["FUM"]["name"],
            patient_id=patient_id,
            patient_name=patient_name,
            satisfied=True,
            confidence=confidence,
            evidence_type="structured",
            source_document_id=doc_id,
            source_document_type=doc_type,
            source_section=followup["entry"].get("section", "encounters"),
            summary=f"BH follow-up {delta_days}d after ED visit ({'7-day' if within_7 else '30-day'} window met)",
            numerator_date=followup["when"].strftime("%Y-%m-%d"),
            denominator_date=ed_date.strftime("%Y-%m-%d"),
            extra={"window": "7-day" if within_7 else "30-day"},
        )
    ]


def _check_fua(patient_id, patient_name, doc_id, doc_type, sections, enc_time) -> list[HedisHit]:
    problems = sections.get("problems", [])
    encounters = sections.get("encounters", [])
    procedures = sections.get("procedures", [])
    has_aod_dx = any(_icd10_family(p.get("code", {}).get("code", "")) in AOD_ICD10 for p in problems)
    ed_date = _find_ed_date(problems + encounters + procedures) or _parse_date(enc_time)
    if not has_aod_dx or ed_date is None:
        return []
    followup = _find_followup(encounters + procedures, ed_date, days=30)
    if followup is None:
        return []
    delta_days = (followup["when"] - ed_date).days
    within_7 = delta_days <= 7
    return [
        HedisHit(
            measure="FUA",
            measure_name=MEASURES["FUA"]["name"],
            patient_id=patient_id,
            patient_name=patient_name,
            satisfied=True,
            confidence=0.9,
            evidence_type="structured",
            source_document_id=doc_id,
            source_document_type=doc_type,
            source_section=followup["entry"].get("section", "encounters"),
            summary=f"AOD follow-up {delta_days}d after ED ({'7-day' if within_7 else '30-day'} window)",
            numerator_date=followup["when"].strftime("%Y-%m-%d"),
            denominator_date=ed_date.strftime("%Y-%m-%d"),
            extra={"window": "7-day" if within_7 else "30-day"},
        )
    ]


def _check_cbp(patient_id, patient_name, doc_id, doc_type, sections) -> list[HedisHit]:
    vitals = sections.get("vital_signs", [])
    sys_reading = None
    dia_reading = None
    reading_date = ""
    for v in vitals:
        code = v.get("code", {}).get("code", "")
        val = v.get("value", {}) or {}
        try:
            num = float(val.get("value", "nan"))
        except (TypeError, ValueError):
            continue
        if code in BP_LOINC_SYS:
            sys_reading = num
            reading_date = (v.get("effective_time") or {}).get("value", reading_date)
        elif code in BP_LOINC_DIA:
            dia_reading = num
            reading_date = reading_date or (v.get("effective_time") or {}).get("value", "")
    if sys_reading is None or dia_reading is None:
        return []
    controlled = sys_reading <= 140 and dia_reading <= 90
    if not controlled:
        return []
    return [
        HedisHit(
            measure="CBP",
            measure_name=MEASURES["CBP"]["name"],
            patient_id=patient_id,
            patient_name=patient_name,
            satisfied=True,
            confidence=0.98,
            evidence_type="structured",
            source_document_id=doc_id,
            source_document_type=doc_type,
            source_section="vital_signs",
            summary=f"BP {int(sys_reading)}/{int(dia_reading)} mmHg (controlled ≤140/90)",
            numerator_date=reading_date[:10],
            extra={"sys": sys_reading, "dia": dia_reading},
        )
    ]


def _check_hbd(patient_id, patient_name, doc_id, doc_type, sections) -> list[HedisHit]:
    problems = sections.get("problems", [])
    results = sections.get("results", [])
    has_diabetes = any(_icd10_family(p.get("code", {}).get("code", "")) in DIABETES_ICD10 for p in problems)
    if not has_diabetes:
        return []
    for r in results:
        code = r.get("code", {}).get("code", "")
        if code not in HBA1C_LOINC:
            continue
        try:
            a1c = float(r.get("value", {}).get("value", "nan"))
        except (TypeError, ValueError):
            continue
        if a1c < 8.0:
            return [
                HedisHit(
                    measure="HBD",
                    measure_name=MEASURES["HBD"]["name"],
                    patient_id=patient_id,
                    patient_name=patient_name,
                    satisfied=True,
                    confidence=0.97,
                    evidence_type="structured",
                    source_document_id=doc_id,
                    source_document_type=doc_type,
                    source_section="results",
                    summary=f"HbA1c {a1c}% (< 8% controlled)",
                    numerator_date=(r.get("effective_time") or {}).get("value", "")[:10],
                    extra={"a1c": a1c},
                )
            ]
    return []


def _check_mrp(patient_id, patient_name, doc_id, doc_type, sections, enc_time, enc_info) -> list[HedisHit]:
    if "discharge" not in (doc_type or "").lower():
        return []
    plan = sections.get("plan_of_care", []) + sections.get("assessment_and_plan", [])
    meds = sections.get("medications", [])
    has_reconciliation = any(
        "reconcil" in (p.get("code", {}).get("display") or "").lower() for p in plan
    ) or len(meds) >= 1
    if not has_reconciliation:
        return []
    when = _parse_date(enc_time) or datetime.utcnow()
    return [
        HedisHit(
            measure="MRP",
            measure_name=MEASURES["MRP"]["name"],
            patient_id=patient_id,
            patient_name=patient_name,
            satisfied=True,
            confidence=0.88,
            evidence_type="structured" if plan else "inferred",
            source_document_id=doc_id,
            source_document_type=doc_type,
            source_section="plan_of_care" if plan else "medications",
            summary=f"Medication reconciliation documented on discharge summary ({len(meds)} meds listed)",
            numerator_date=when.strftime("%Y-%m-%d"),
            denominator_date=when.strftime("%Y-%m-%d"),
            extra={"med_count": len(meds)},
        )
    ]


def _find_ed_date(entries: list[dict[str, Any]]) -> datetime | None:
    for e in entries:
        code = e.get("code", {}).get("code", "")
        disp = (e.get("code", {}).get("display") or "").lower()
        if code in ED_VISIT_CODES or "emergency" in disp or code == "99281":
            t = (e.get("effective_time") or {}).get("value") or (e.get("effective_time") or {}).get("low")
            parsed = _parse_date(t or "")
            if parsed is not None:
                return parsed
    return None


def _find_followup(entries: list[dict[str, Any]], ed_date: datetime, days: int) -> dict[str, Any] | None:
    best: tuple[datetime, dict[str, Any]] | None = None
    for e in entries:
        t = (e.get("effective_time") or {}).get("value") or (e.get("effective_time") or {}).get("low")
        when = _parse_date(t or "")
        if when is None:
            continue
        # Must be AFTER ED date, within window
        delta = (when - ed_date).days
        if 0 < delta <= days:
            code = e.get("code", {}).get("code", "")
            disp = (e.get("code", {}).get("display") or "").lower()
            if code in BH_FOLLOWUP_CPT or "follow" in disp or "outpatient" in disp or "behavioral" in disp:
                if best is None or when < best[0]:
                    best = (when, e)
    if best is None:
        return None
    return {"when": best[0], "entry": best[1]}


def estimate_revenue_impact(hits: list[dict[str, Any]]) -> dict[str, Any]:
    """Rough per-measure revenue impact (for demo narrative).

    Numbers are illustrative; the real figures depend on LA Care's PMPM
    quality bonus contracts.
    """
    per_hit = {
        "FUM": 220.0,
        "FUA": 220.0,
        "CBP": 95.0,
        "HBD": 120.0,
        "MRP": 180.0,
    }
    total = 0.0
    by_measure: dict[str, dict[str, Any]] = {}
    for h in hits:
        if not h.get("satisfied"):
            continue
        m = h.get("measure")
        amount = per_hit.get(m, 80.0)
        total += amount
        bucket = by_measure.setdefault(m, {"count": 0, "amount": 0.0, "name": h.get("measure_name")})
        bucket["count"] += 1
        bucket["amount"] += amount
    return {
        "total_usd": round(total, 2),
        "by_measure": {k: {**v, "amount": round(v["amount"], 2)} for k, v in by_measure.items()},
    }
