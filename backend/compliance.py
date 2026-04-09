"""Compliance and accuracy metrics engine.
Evaluates migrated data against HIPAA, FHIR R4, and CMS rules.
Supports both source-style rows and generated FHIR resources.
"""
from typing import List, Dict, Any
import re

# Accepts: X99, X99.X, X99.XX, X99.XXX — both with and without decimal
ICD10_RE = re.compile(r'^[A-Z]\d{2}(?:\.[A-Za-z0-9]{1,4})?$')
NPI_RE   = re.compile(r'^\d{10}$')


def check_icd10(code: str) -> bool:
    c = str(code or '').strip().upper()
    return bool(ICD10_RE.match(c)) and len(c) >= 3


def check_npi(npi: str) -> bool:
    return bool(NPI_RE.match(str(npi or '').strip()))


def check_member_id_uuid(mid: str) -> bool:
    uuid_re = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.IGNORECASE)
    return bool(uuid_re.match(str(mid or '')))


def check_date_iso(d: Any) -> bool:
    if not d:
        return False
    return bool(re.match(r'^\d{4}-\d{2}-\d{2}', str(d)))


def check_gender(g: str) -> bool:
    return str(g or '').upper() in ('M', 'F', 'MALE', 'FEMALE', 'OTHER', 'UNKNOWN')


def _patient_name_present(m: Dict[str, Any]) -> bool:
    names = m.get('name') or []
    if names and isinstance(names, list):
        first = names[0] or {}
        return bool(first.get('family') or first.get('given'))
    return bool(m.get('first_name') and m.get('last_name'))


def _patient_birthdate(m: Dict[str, Any]) -> Any:
    return m.get('birthDate') or m.get('date_of_birth')


def _patient_gender(m: Dict[str, Any]) -> Any:
    return m.get('gender')


def _patient_id(m: Dict[str, Any]) -> Any:
    return m.get('id') or m.get('member_id')


def _claim_icd10(c: Dict[str, Any]) -> str:
    diag = c.get('diagnosis') or []
    if diag and isinstance(diag, list):
        first = diag[0] or {}
        dcc = first.get('diagnosisCodeableConcept') or {}
        coding = dcc.get('coding') or []
        if coding and isinstance(coding, list):
            return str((coding[0] or {}).get('code', ''))
    return str(c.get('icd10_primary', ''))


def _claim_npi(c: Dict[str, Any]) -> str:
    provider_ref = str((c.get('provider') or {}).get('reference', ''))
    if provider_ref.startswith('Practitioner/'):
        return provider_ref.split('/', 1)[1]
    return str(c.get('provider_npi', ''))


def _claim_has_patient(c: Dict[str, Any]) -> bool:
    patient_ref = str((c.get('patient') or {}).get('reference', ''))
    return bool(patient_ref) or bool(c.get('member_id'))


def _claim_date(c: Dict[str, Any]) -> Any:
    bp = c.get('billablePeriod') or {}
    return bp.get('start') or c.get('date_of_service')


def _claim_amount(c: Dict[str, Any]) -> Any:
    total = c.get('total') or {}
    if isinstance(total, dict) and 'value' in total:
        return total.get('value')
    return c.get('claim_amount')


def compute_compliance(
    members: List[Dict[str, Any]],
    eligibility: List[Dict[str, Any]],
    claims: List[Dict[str, Any]],
) -> Dict[str, Any]:
    total_claims = len(claims) or 1
    total_members = len(members) or 1

    icd_pass = sum(1 for c in claims if check_icd10(_claim_icd10(c)))
    icd_score = round(icd_pass / total_claims * 100, 1)

    npi_pass = sum(1 for c in claims if check_npi(_claim_npi(c)))
    npi_score = round(npi_pass / total_claims * 100, 1)

    claim_complete = sum(1 for c in claims if _claim_has_patient(c) and check_icd10(_claim_icd10(c)) and _claim_amount(c) not in (None, ''))
    member_complete = sum(1 for m in members if _patient_id(m) and _patient_name_present(m) and _patient_birthdate(m) and _patient_gender(m))
    fhir_score = round(((claim_complete / total_claims) + (member_complete / total_members)) / 2 * 100, 1)

    hipaa_pass = sum(1 for m in members if _patient_name_present(m) and _patient_birthdate(m))
    hipaa_score = round(hipaa_pass / total_members * 100, 1)

    date_pass = sum(1 for c in claims if check_date_iso(_claim_date(c)))
    date_score = round(date_pass / total_claims * 100, 1)

    gender_pass = sum(1 for m in members if check_gender(str(_patient_gender(m))))
    gender_score = round(gender_pass / total_members * 100, 1)

    uuid_pass = sum(1 for m in members if check_member_id_uuid(str(_patient_id(m))))
    uuid_score = round(uuid_pass / total_members * 100, 1)

    amount_pass = 0
    for c in claims:
        amt = _claim_amount(c)
        try:
            if amt is not None and float(amt) > 0:
                amount_pass += 1
        except Exception:
            pass
    amount_score = round(amount_pass / total_claims * 100, 1)

    overall = round(
        icd_score * 0.20 + npi_score * 0.20 + fhir_score * 0.20 + hipaa_score * 0.15 +
        date_score * 0.10 + gender_score * 0.05 + uuid_score * 0.05 + amount_score * 0.05, 1
    )

    rules = [
        {"id": "HIPAA-NPI",    "name": "NPI Validity",            "standard": "HIPAA 45 CFR 162",      "score": npi_score,    "passed": npi_pass,    "total": total_claims,  "threshold": 100},
        {"id": "FHIR-ICD10",   "name": "ICD-10 Format",           "standard": "FHIR R4 CodeSystem",    "score": icd_score,    "passed": icd_pass,    "total": total_claims,  "threshold": 95 },
        {"id": "FHIR-COMPLETE","name": "FHIR Field Completeness",  "standard": "FHIR R4 Must Support",  "score": fhir_score,   "passed": claim_complete,"total": total_claims,"threshold": 90 },
        {"id": "HIPAA-PHI",    "name": "PHI Field Coverage",       "standard": "HIPAA Privacy Rule",    "score": hipaa_score,  "passed": hipaa_pass,  "total": total_members, "threshold": 100},
        {"id": "CMS-DATE",     "name": "Date Format (ISO 8601)",   "standard": "CMS Claims Data",       "score": date_score,   "passed": date_pass,   "total": total_claims,  "threshold": 100},
        {"id": "HL7-GENDER",   "name": "Gender Coding (HL7)",      "standard": "HL7 FHIR Administrative","score": gender_score, "passed": gender_pass, "total": total_members, "threshold": 95 },
        {"id": "FHIR-UUID",    "name": "Patient UUID Format",      "standard": "FHIR R4 Resource.id",   "score": uuid_score,   "passed": uuid_pass,   "total": total_members, "threshold": 100},
        {"id": "CMS-AMOUNT",   "name": "Claim Amount Validity",    "standard": "CMS Claim Submission",  "score": amount_score, "passed": amount_pass, "total": total_claims,  "threshold": 100},
    ]

    return {
        "overall_score": overall,
        "icd10_compliance": icd_score,
        "npi_validity": npi_score,
        "fhir_completeness": fhir_score,
        "hipaa_score": hipaa_score,
        "date_compliance": date_score,
        "gender_compliance": gender_score,
        "uuid_compliance": uuid_score,
        "amount_validity": amount_score,
        "rules": rules,
        "summary": {
            "passed_rules": sum(1 for r in rules if r["score"] >= r["threshold"]),
            "total_rules": len(rules),
            "critical_failures": [r["id"] for r in rules if r["score"] < 80],
        }
    }
