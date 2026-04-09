import re
import uuid
import decimal
import datetime
from difflib import SequenceMatcher
from typing import Any, Dict, List, Tuple, Optional

SAMPLE_LIMIT = 5
AUTO_MAP_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.55
IGNORE_SOURCE_COLUMNS = {'created_at', 'updated_at', 'dataset_id'}

FHIR_RESOURCE_CATALOG: Dict[str, Dict[str, Any]] = {
    "Patient": {
        "hints": ["member", "patient", "person", "demographic", "subscriber", "beneficiary"],
        "fields": {
            "id": {"aliases": ["id", "member_id", "patient_id", "person_id"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "identifier[0].value": {"aliases": ["member_id", "subscriber_id", "identifier", "person_number"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "name[0].given[0]": {"aliases": ["first_name", "given_name", "fname", "forename"], "types": ["text", "varchar"]},
            "name[0].family": {"aliases": ["last_name", "family_name", "lname", "surname"], "types": ["text", "varchar"]},
            "birthDate": {"aliases": ["dob", "date_of_birth", "birth_date"], "types": ["date", "timestamp", "text", "varchar"]},
            "gender": {"aliases": ["gender", "sex"], "types": ["text", "varchar"]},
            "telecom[phone].value": {"aliases": ["phone", "phone_number", "mobile", "cell"], "types": ["text", "varchar"]},
            "telecom[email].value": {"aliases": ["email", "email_address"], "types": ["text", "varchar"]},
            "address[0].line[0]": {"aliases": ["address", "address_line1", "street", "street_address"], "types": ["text", "varchar"]},
            "address[0].city": {"aliases": ["city", "town"], "types": ["text", "varchar"]},
            "address[0].state": {"aliases": ["state", "province"], "types": ["text", "varchar"]},
            "address[0].postalCode": {"aliases": ["zip", "zip_code", "postal_code", "postcode"], "types": ["text", "varchar"]},
        },
    },
    "Coverage": {
        "hints": ["eligibility", "coverage", "insurance", "plan", "payer", "benefit"],
        "fields": {
            "id": {"aliases": ["eligibility_id", "coverage_id", "insurance_id", "id"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "beneficiary.reference": {"aliases": ["member_id", "patient_id", "beneficiary_id", "subscriber_id"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "status": {"aliases": ["status", "coverage_status"], "types": ["text", "varchar"]},
            "class[0].value": {"aliases": ["plan_id", "plan_code", "policy_id"], "types": ["text", "varchar"]},
            "class[0].name": {"aliases": ["plan_name", "plan", "product_name"], "types": ["text", "varchar"]},
            "period.start": {"aliases": ["effective_date", "start_date", "coverage_start"], "types": ["date", "timestamp", "text", "varchar"]},
            "period.end": {"aliases": ["termination_date", "end_date", "coverage_end"], "types": ["date", "timestamp", "text", "varchar"]},
            "type.text": {"aliases": ["coverage_type", "type", "line_of_business"], "types": ["text", "varchar"]},
            "payor[0].identifier.value": {"aliases": ["payer_id", "carrier_id", "insurer_id"], "types": ["text", "varchar", "int", "bigint"]},
            "subscriberId": {"aliases": ["subscriber_id", "member_number", "subscriber_number"], "types": ["text", "varchar"]},
            "grouping.group": {"aliases": ["group_number", "group_id", "employer_group"], "types": ["text", "varchar"]},
        },
    },
    "Claim": {
        "hints": ["claim", "billing", "encounter", "diagnosis", "procedure", "adjudication"],
        "fields": {
            "id": {"aliases": ["claim_id", "encounter_id", "bill_id", "id"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "patient.reference": {"aliases": ["member_id", "patient_id", "beneficiary_id"], "types": ["text", "varchar", "uuid", "int", "bigint"]},
            "provider.reference": {"aliases": ["provider_npi", "provider_id", "billing_provider", "servicing_provider"], "types": ["text", "varchar", "int", "bigint"]},
            "provider.display": {"aliases": ["provider_name", "facility_name", "clinic_name"], "types": ["text", "varchar"]},
            "created": {"aliases": ["claim_date", "created_at", "submitted_at", "service_date"], "types": ["date", "timestamp", "text", "varchar"]},
            "billablePeriod.start": {"aliases": ["date_of_service", "service_date", "from_date"], "types": ["date", "timestamp", "text", "varchar"]},
            "billablePeriod.end": {"aliases": ["date_of_service", "through_date", "to_date"], "types": ["date", "timestamp", "text", "varchar"]},
            "diagnosis[0].diagnosisCodeableConcept.coding[0].code": {"aliases": ["icd10_primary", "diagnosis_code", "primary_diagnosis", "dx_code"], "types": ["text", "varchar"]},
            "diagnosis[1].diagnosisCodeableConcept.coding[0].code": {"aliases": ["icd10_secondary", "secondary_diagnosis", "dx2_code"], "types": ["text", "varchar"]},
            "diagnosis[0].diagnosisCodeableConcept.coding[0].display": {"aliases": ["diagnosis_description", "diagnosis_desc", "dx_description"], "types": ["text", "varchar"]},
            "procedure[0].procedureCodeableConcept.coding[0].code": {"aliases": ["procedure_code", "cpt_code", "hcpcs_code"], "types": ["text", "varchar"]},
            "total.value": {"aliases": ["claim_amount", "billed_amount", "amount", "total_amount"], "types": ["numeric", "decimal", "double precision", "real", "int", "bigint"]},
            "payment.amount.value": {"aliases": ["paid_amount", "allowed_amount", "payment_amount"], "types": ["numeric", "decimal", "double precision", "real", "int", "bigint"]},
            "status": {"aliases": ["claim_status", "status"], "types": ["text", "varchar"]},
            "facility.identifier.value": {"aliases": ["place_of_service", "facility_code", "pos"], "types": ["text", "varchar", "int"]},
        },
    },
}

RESOURCE_LINK_HINTS = {
    "Patient": ["member", "patient", "person", "first_name", "last_name", "dob", "gender"],
    "Coverage": ["coverage", "eligibility", "payer", "plan", "effective", "termination", "subscriber"],
    "Claim": ["claim", "diagnosis", "procedure", "provider", "service", "amount", "billing"],
}

ICD10_RE = re.compile(r'^[A-Z]\d{2}(?:\.\w{1,4})?$')
PHONE_RE = re.compile(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}')
EMAIL_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
ZIP_RE = re.compile(r'^\d{5}(?:-\d{4})?$')
DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')
NPI_RE = re.compile(r'^\d{10}$')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def normalize_name(value: str) -> str:
    return re.sub(r'[^a-z0-9]+', '_', str(value or '').strip().lower()).strip('_')


def stringify(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(float(value))
    return str(value)


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_name(a), normalize_name(b)).ratio()


def detect_value_patterns(samples: List[Any]) -> Dict[str, float]:
    vals = [stringify(v).strip() for v in samples if stringify(v).strip()]
    if not vals:
        return {}
    n = len(vals)
    return {
        "date": sum(1 for v in vals if DATE_RE.match(v)) / n,
        "email": sum(1 for v in vals if EMAIL_RE.match(v)) / n,
        "phone": sum(1 for v in vals if PHONE_RE.search(v)) / n,
        "zip": sum(1 for v in vals if ZIP_RE.match(v)) / n,
        "icd10": sum(1 for v in vals if ICD10_RE.match(v.upper())) / n,
        "npi": sum(1 for v in vals if NPI_RE.match(v)) / n,
        "uuid": sum(1 for v in vals if UUID_RE.match(v)) / n,
        "gender": sum(1 for v in vals if v.upper() in {"M", "F", "MALE", "FEMALE", "OTHER", "UNKNOWN"}) / n,
        "numeric": sum(1 for v in vals if _is_numeric_text(v)) / n,
    }


def _is_numeric_text(v: str) -> bool:
    try:
        float(v)
        return True
    except Exception:
        return False


def semantic_resource_inference(table_name: str, columns: List[Dict[str, Any]], sample_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    table_norm = normalize_name(table_name)
    col_names = [normalize_name(c["name"]) for c in columns]

    resource_scores: Dict[str, float] = {}
    resource_reasons: Dict[str, List[str]] = {}

    for resource, meta in FHIR_RESOURCE_CATALOG.items():
        score = 0.0
        reasons: List[str] = []

        for hint in meta["hints"]:
            sim = _similarity(table_norm, hint)
            if hint in table_norm:
                score += 0.22
                reasons.append(f"table name resembles {hint}")
            elif sim > 0.6:
                score += sim * 0.12
                reasons.append(f"table name similar to {hint}")

        matched_cols = 0
        for col in col_names:
            for hint in RESOURCE_LINK_HINTS[resource]:
                if hint in col or _similarity(col, hint) > 0.75:
                    matched_cols += 1
                    break
        if col_names:
            col_score = min(0.6, matched_cols / len(col_names) * 1.8)
            score += col_score
            if matched_cols:
                reasons.append(f"{matched_cols} columns match {resource} semantics")

        sample_patterns = _aggregate_patterns(columns, sample_rows)
        if resource == "Patient" and sample_patterns.get("gender", 0) > 0.3:
            score += 0.08
            reasons.append("sample values contain gender-like codes")
        if resource == "Patient" and sample_patterns.get("phone", 0) > 0.3:
            score += 0.05
            reasons.append("sample values contain phone-like values")
        if resource == "Coverage" and any("payer" in c or "plan" in c for c in col_names):
            score += 0.10
            reasons.append("columns include payer/plan terminology")
        if resource == "Claim" and sample_patterns.get("icd10", 0) > 0.2:
            score += 0.12
            reasons.append("sample values contain diagnosis codes")
        if resource == "Claim" and sample_patterns.get("numeric", 0) > 0.2 and any("amount" in c for c in col_names):
            score += 0.08
            reasons.append("amount-like fields detected")

        resource_scores[resource] = min(score, 0.99)
        resource_reasons[resource] = reasons

    best_resource = max(resource_scores, key=resource_scores.get)
    best_score = resource_scores[best_resource]
    return {
        "table": table_name,
        "inferred_resource": best_resource,
        "confidence": round(best_score, 2),
        "reasoning": resource_reasons[best_resource] or ["best semantic fit from table and column analysis"],
        "candidate_scores": {k: round(v, 2) for k, v in resource_scores.items()},
    }


def _aggregate_patterns(columns: List[Dict[str, Any]], sample_rows: List[Dict[str, Any]]) -> Dict[str, float]:
    totals: Dict[str, float] = {}
    if not columns or not sample_rows:
        return totals
    for col in columns:
        values = [row.get(col["name"]) for row in sample_rows]
        pats = detect_value_patterns(values)
        for k, v in pats.items():
            totals[k] = max(totals.get(k, 0.0), v)
    return totals


def score_column_mapping(resource: str, column: Dict[str, Any], sample_rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    candidates = []
    resource_fields = FHIR_RESOURCE_CATALOG[resource]["fields"]
    col_name = column["name"]
    col_type = str(column.get("type", "")).lower()
    samples = [row.get(col_name) for row in sample_rows]
    patterns = detect_value_patterns(samples)

    for target, meta in resource_fields.items():
        alias_scores = []
        alias_hits = []
        normalized_col = normalize_name(col_name)
        for alias in meta["aliases"]:
            norm_alias = normalize_name(alias)
            sim = _similarity(col_name, alias)
            alias_scores.append(sim)
            if normalized_col == norm_alias:
                alias_hits.append(alias)
                alias_scores.append(1.0)
            elif alias in normalized_col or norm_alias in normalized_col:
                alias_hits.append(alias)
                alias_scores.append(min(1.0, sim + 0.25))

        name_score = max(alias_scores) if alias_scores else 0.0
        type_score = 0.0
        normalized_types = [t.lower() for t in meta["types"]]
        if any(t in col_type for t in normalized_types):
            type_score = 1.0
        elif any(t in col_type for t in ["text", "varchar"]) and any(t in normalized_types for t in ["text", "varchar"]):
            type_score = 0.8
        elif any(t in col_type for t in ["numeric", "decimal", "double", "real", "int", "bigint"]) and any(t in normalized_types for t in ["numeric", "decimal", "double precision", "real", "int", "bigint"]):
            type_score = 0.85
        elif any(t in col_type for t in ["date", "timestamp"]) and any(t in normalized_types for t in ["date", "timestamp"]):
            type_score = 0.9

        pattern_score, pattern_reason = pattern_match_score(target, patterns)
        confidence = round(min(0.99, name_score * 0.70 + type_score * 0.15 + pattern_score * 0.15), 2)

        exact_alias_match = any(normalized_col == normalize_name(alias) for alias in meta["aliases"])
        strong_semantic_match = exact_alias_match or (name_score >= 0.95 and type_score >= 0.8)
        if strong_semantic_match:
            confidence = max(confidence, 0.9)
        elif exact_alias_match and (pattern_score >= 0.5 or type_score >= 0.8):
            confidence = max(confidence, 0.88)

        reasons = []
        if alias_hits:
            reasons.append(f"name matched aliases: {', '.join(alias_hits[:2])}")
        elif name_score > 0.7:
            reasons.append("strong semantic column-name similarity")
        if type_score >= 0.8:
            reasons.append("datatype compatible")
        if pattern_reason:
            reasons.append(pattern_reason)

        candidates.append({
            "source_column": col_name,
            "target_field": f"{resource}.{target}",
            "confidence": confidence,
            "reason": "; ".join(reasons) or "weak semantic match",
            "sample_values": [stringify(v) for v in samples[:3]],
            "data_type": column.get("type"),
        })

    candidates.sort(key=lambda x: x["confidence"], reverse=True)
    return candidates[:5]


def pattern_match_score(target_field: str, patterns: Dict[str, float]) -> Tuple[float, str]:
    tf = target_field.lower()
    if "birthdate" in tf or "period.start" in tf or "period.end" in tf or "created" in tf or "billableperiod" in tf:
        if patterns.get("date", 0) > 0.5:
            return patterns["date"], "sample values look like dates"
    if "email" in tf and patterns.get("email", 0) > 0.5:
        return patterns["email"], "sample values look like email addresses"
    if "phone" in tf and patterns.get("phone", 0) > 0.4:
        return patterns["phone"], "sample values look like phone numbers"
    if "postalcode" in tf and patterns.get("zip", 0) > 0.4:
        return patterns["zip"], "sample values look like postal codes"
    if "diagnosis" in tf and patterns.get("icd10", 0) > 0.3:
        return patterns["icd10"], "sample values look like ICD-10 codes"
    if "provider.reference" in tf and patterns.get("npi", 0) > 0.3:
        return patterns["npi"], "sample values look like provider identifiers"
    if tf.endswith("id") and patterns.get("uuid", 0) > 0.3:
        return patterns["uuid"], "sample values look like UUIDs"
    if "total.value" in tf or "payment.amount.value" in tf:
        if patterns.get("numeric", 0) > 0.5:
            return patterns["numeric"], "sample values look numeric"
    if "gender" in tf and patterns.get("gender", 0) > 0.4:
        return patterns["gender"], "sample values look like gender codes"
    return 0.0, ""


def build_mapping_summary(schema_info: Dict[str, Any]) -> Dict[str, Any]:
    mapping_summary = []
    requires_review = []
    unmapped_fields = []

    for table_name, info in schema_info.items():
        resource_info = semantic_resource_inference(table_name, info["columns_raw"], info["sample_rows"])
        resource = resource_info["inferred_resource"]
        field_mappings = []

        for col in info["columns_raw"]:
            if normalize_name(col["name"]) in IGNORE_SOURCE_COLUMNS:
                mapping = {
                    "source_column": col["name"],
                    "target_field": None,
                    "confidence": 0.0,
                    "status": "ignored",
                    "reason": "operational/source metadata field not mapped to FHIR",
                    "candidates": [],
                    "data_type": col["type"],
                    "sample_values": [stringify(row.get(col["name"])) for row in info["sample_rows"][:3]],
                }
                field_mappings.append(mapping)
                unmapped_fields.append({"table": table_name, "resource": resource, **mapping})
                continue
            candidates = score_column_mapping(resource, col, info["sample_rows"])
            best = candidates[0] if candidates else None
            status = "ignored"
            target_field = None
            confidence = 0.0
            reason = "no confident mapping found"
            if best:
                target_field = best["target_field"]
                confidence = best["confidence"]
                reason = best["reason"]
                if confidence >= AUTO_MAP_THRESHOLD:
                    status = "auto_mapped"
                elif confidence >= REVIEW_THRESHOLD:
                    status = "requires_review"
                else:
                    status = "ignored"

            mapping = {
                "source_column": col["name"],
                "target_field": target_field,
                "confidence": confidence,
                "status": status,
                "reason": reason,
                "candidates": candidates,
                "data_type": col["type"],
                "sample_values": [stringify(row.get(col["name"])) for row in info["sample_rows"][:3]],
            }
            field_mappings.append(mapping)
            if status == "requires_review":
                requires_review.append({"table": table_name, "resource": resource, **mapping})
            elif status == "ignored":
                unmapped_fields.append({"table": table_name, "resource": resource, **mapping})

        mapping_summary.append({
            "table": table_name,
            "resource": resource,
            "resource_confidence": resource_info["confidence"],
            "resource_reasoning": resource_info["reasoning"],
            "resource_candidates": resource_info["candidate_scores"],
            "fields": field_mappings,
            "row_count": info["row_count"],
        })

    return {
        "mapping_summary": mapping_summary,
        "requires_review": requires_review,
        "unmapped_fields": unmapped_fields,
    }


def classify_value(column: str, value: Any) -> Any:
    if value is None:
        return None
    text = stringify(value).strip()
    if not text:
        return text
    if normalize_name(column) in {"gender", "sex"}:
        return map_gender(text)
    if "date" in normalize_name(column) or DATE_RE.match(text):
        return normalize_date(text)
    if EMAIL_RE.match(text):
        return text.lower()
    return text


def map_gender(value: str) -> str:
    v = value.strip().lower()
    if v in {"m", "male"}:
        return "male"
    if v in {"f", "female"}:
        return "female"
    if v in {"other", "nonbinary", "non-binary"}:
        return "other"
    return "unknown"


def normalize_date(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    s = stringify(value)
    if DATE_RE.match(s):
        return s[:10]
    return s


def ensure_resource_id(value: Any) -> str:
    s = stringify(value).strip()
    if UUID_RE.match(s):
        return s
    if not s:
        return str(uuid.uuid4())
    namespace = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
    return str(uuid.uuid5(namespace, s))


def set_fhir_path(resource: Dict[str, Any], path: str, value: Any) -> None:
    parts = path.split('.')
    cur: Any = resource
    for i, part in enumerate(parts):
        match = re.match(r'(.+)\[(\d+)\]$', part)
        last = i == len(parts) - 1
        if match:
            name, idx = match.group(1), int(match.group(2))
            if name not in cur or not isinstance(cur[name], list):
                cur[name] = []
            while len(cur[name]) <= idx:
                cur[name].append({})
            if last:
                cur[name][idx] = value
            else:
                if not isinstance(cur[name][idx], dict):
                    cur[name][idx] = {}
                cur = cur[name][idx]
        else:
            if last:
                cur[part] = value
            else:
                if part not in cur or not isinstance(cur[part], dict):
                    cur[part] = {}
                cur = cur[part]


def build_fhir_resource(resource_type: str, row: Dict[str, Any], field_mappings: List[Dict[str, Any]]) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    resource: Dict[str, Any] = {"resourceType": resource_type}
    trace: List[Dict[str, Any]] = []

    auto_fields = [f for f in field_mappings if f["status"] == "auto_mapped" and f.get("target_field")]
    for mapping in auto_fields:
        source_col = mapping["source_column"]
        source_value = row.get(source_col)
        if source_value is None:
            continue
        target_field = str(mapping["target_field"]).split('.', 1)[1]
        transformed_value = classify_value(source_col, source_value)

        if resource_type == "Patient" and target_field in {"id", "identifier[0].value"}:
            transformed_value = ensure_resource_id(source_value)
        elif resource_type == "Coverage" and target_field == "id":
            transformed_value = ensure_resource_id(source_value)
        elif resource_type == "Claim" and target_field == "id":
            transformed_value = ensure_resource_id(source_value)
        elif resource_type == "Coverage" and target_field == "beneficiary.reference":
            transformed_value = f"Patient/{ensure_resource_id(source_value)}"
        elif resource_type == "Claim" and target_field == "patient.reference":
            transformed_value = f"Patient/{ensure_resource_id(source_value)}"
        elif resource_type == "Claim" and target_field == "provider.reference":
            transformed_value = f"Practitioner/{stringify(source_value)}"
        elif resource_type == "Claim" and target_field in {"total.value", "payment.amount.value"}:
            try:
                transformed_value = float(source_value)
            except Exception:
                transformed_value = 0.0
        # Normalize ICD-10: ensure dot present for codes >= 4 chars e.g. I100 -> I10.0
        if resource_type == "Claim" and "diagnosis" in target_field and "code" in target_field:
            code = stringify(transformed_value).strip().upper()
            if code and len(code) >= 4 and '.' not in code:
                transformed_value = f"{code[:3]}.{code[3:]}"
            else:
                transformed_value = code or stringify(source_value).strip().upper()

        set_fhir_path(resource, target_field, transformed_value)
        trace.append({
            "source_column": source_col,
            "source_value": stringify(source_value),
            "target_field": f"{resource_type}.{target_field}",
            "transformed_value": transformed_value,
            "confidence": mapping["confidence"],
            "reason": mapping["reason"],
        })

    apply_resource_defaults(resource)
    return resource, trace


def apply_resource_defaults(resource: Dict[str, Any]) -> None:
    rt = resource.get("resourceType")
    if rt == "Patient":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("identifier", [{"system": "urn:brightcone:member", "value": resource.get("id", "")}])
        resource.setdefault("name", [{"family": "", "given": [""]}])
        resource.setdefault("gender", "unknown")
    elif rt == "Coverage":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("status", "active")
        resource.setdefault("beneficiary", {"reference": "Patient/UNKNOWN"})
    elif rt == "Claim":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("status", "active")
        resource.setdefault("use", "claim")
        resource.setdefault("type", {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/claim-type", "code": "professional"}]})
        resource.setdefault("priority", {"coding": [{"code": "normal"}]})


def validate_fhir_resource(resource: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    rt = resource.get("resourceType")
    if not rt:
        errors.append("resourceType missing")
        return errors

    if rt == "Patient":
        if not resource.get("id"):
            errors.append("Patient.id missing")
        names = resource.get("name") or []
        if not names or not isinstance(names, list):
            errors.append("Patient.name missing")
        else:
            first = names[0] or {}
            if not first.get("family") and not first.get("given"):
                errors.append("Patient.name requires family or given")
        bd = resource.get("birthDate")
        if bd and not DATE_RE.match(stringify(bd)):
            errors.append("Patient.birthDate invalid")

    elif rt == "Coverage":
        if not resource.get("beneficiary", {}).get("reference"):
            errors.append("Coverage.beneficiary.reference missing")
        status = stringify(resource.get("status"))
        if not status:
            errors.append("Coverage.status missing")

    elif rt == "Claim":
        if not resource.get("patient", {}).get("reference"):
            errors.append("Claim.patient.reference missing")
        if not resource.get("diagnosis"):
            errors.append("Claim.diagnosis missing")
        if resource.get("total") and "value" in resource.get("total", {}):
            try:
                float(resource["total"]["value"])
            except Exception:
                errors.append("Claim.total.value invalid")

    return errors
