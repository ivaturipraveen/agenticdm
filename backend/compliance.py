"""Compliance and accuracy metrics engine.
Evaluates migrated data against HIPAA, FHIR R4, and CMS rules.
"""
from typing import List, Dict, Any
import re

ICD10_RE = re.compile(r'^[A-Z]\d{2}\.\w{1,4}$')
NPI_RE   = re.compile(r'^\d{10}$')


def check_icd10(code: str) -> bool:
    return bool(ICD10_RE.match(str(code or '').strip()))


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


def compute_compliance(
    members: List[Dict[str, Any]],
    eligibility: List[Dict[str, Any]],
    claims: List[Dict[str, Any]],
) -> Dict[str, Any]:
    total_claims = len(claims) or 1
    total_members = len(members) or 1

    icd_pass = sum(1 for c in claims if check_icd10(str(c.get('icd10_primary', ''))))
    icd_score = round(icd_pass / total_claims * 100, 1)

    npi_pass = sum(1 for c in claims if check_npi(str(c.get('provider_npi', ''))))
    npi_score = round(npi_pass / total_claims * 100, 1)

    fhir_fields_claims = ['claim_id', 'member_id', 'provider_npi', 'icd10_primary', 'claim_amount', 'date_of_service']
    fhir_fields_members = ['member_id', 'first_name', 'last_name', 'date_of_birth', 'gender']
    claim_complete = sum(1 for c in claims if all(c.get(f) for f in fhir_fields_claims))
    member_complete = sum(1 for m in members if all(m.get(f) for f in fhir_fields_members))
    fhir_score = round(((claim_complete / total_claims) + (member_complete / total_members)) / 2 * 100, 1)

    hipaa_fields = ['first_name', 'last_name', 'date_of_birth']
    hipaa_pass = sum(1 for m in members if all(m.get(f) for f in hipaa_fields))
    hipaa_score = round(hipaa_pass / total_members * 100, 1)

    date_pass = sum(1 for c in claims if check_date_iso(c.get('date_of_service')))
    date_score = round(date_pass / total_claims * 100, 1)

    gender_pass = sum(1 for m in members if check_gender(str(m.get('gender', ''))))
    gender_score = round(gender_pass / total_members * 100, 1)

    uuid_pass = sum(1 for m in members if check_member_id_uuid(str(m.get('member_id', ''))))
    uuid_score = round(uuid_pass / total_members * 100, 1)

    amount_pass = sum(1 for c in claims if c.get('claim_amount') is not None and float(c.get('claim_amount', 0)) > 0)
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
