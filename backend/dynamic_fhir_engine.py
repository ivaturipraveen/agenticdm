"""
FHIR Transformation Engine — pure, schema-driven, no hardcoded field names.

Responsibilities:
  - build_mapping_summary(): delegates to Claude AI for column→FHIR mapping.
    Falls back to a lightweight structural inference when Claude is unavailable.
  - build_fhir_resource(): deterministic row→FHIR JSON conversion using the
    mapping contract produced above. No field names, aliases or patterns
    are hardcoded here.
  - apply_resource_defaults(): fills in FHIR R4 required fields that had no
    source column (e.g. Coverage.payor, Claim.insurer).
  - validate_fhir_resource(): structural FHIR R4 validation.
"""

import re
import uuid
import decimal
import datetime
from typing import Any, Dict, List, Tuple, Optional

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
SAMPLE_LIMIT = 10
AUTO_MAP_THRESHOLD = 0.85
REVIEW_THRESHOLD = 0.55

# Columns that are purely operational/ETL metadata — never mapped to FHIR.
# This list intentionally stays small: exact internal names only.
OPERATIONAL_COLUMNS = frozenset({
    "created_at", "updated_at", "dataset_id", "deleted_at",
    "modified_at", "inserted_at", "load_ts", "etl_ts", "row_hash",
})

DATE_RE = re.compile(r'^\d{4}-\d{2}-\d{2}')
UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)
_VALID_GENDERS = {"male", "female", "other", "unknown"}


# ---------------------------------------------------------------------------
# Value utilities — generic, no field-name assumptions
# ---------------------------------------------------------------------------

def stringify(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return str(float(value))
    return str(value)


def normalize_date(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    s = stringify(value)
    return s[:10] if DATE_RE.match(s) else s


def map_gender(value: str) -> str:
    v = value.strip().lower()
    if v in {"m", "male"}:
        return "male"
    if v in {"f", "female"}:
        return "female"
    if v in {"other", "nonbinary", "non-binary", "nb"}:
        return "other"
    return "unknown"


def ensure_resource_id(value: Any) -> str:
    """Ensure a value becomes a stable UUID-like FHIR id."""
    s = stringify(value).strip()
    if UUID_RE.match(s):
        return s
    if not s:
        return str(uuid.uuid4())
    namespace = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
    return str(uuid.uuid5(namespace, s))


def _normalize_icd10(code: str) -> str:
    """Insert dot after position 3 only when no dot is already present."""
    code = code.strip().upper()
    if code and '.' not in code and len(code) >= 4:
        return f"{code[:3]}.{code[3:]}"
    return code


def classify_value(target_field: str, source_col: str, value: Any) -> Any:
    """
    Apply semantic transformation based on the FHIR target field path,
    not the source column name — so it works for any naming convention.
    """
    if value is None:
        return None
    text = stringify(value).strip()
    if not text:
        return text

    tf = target_field.lower()

    # IDs → stable UUID
    if tf.endswith(".id") or (tf.endswith("[0].value") and "identifier" in tf):
        return ensure_resource_id(value)

    # References
    if tf.endswith("beneficiary.reference") or tf.endswith("patient.reference"):
        return f"Patient/{ensure_resource_id(value)}"
    if tf.endswith("provider.reference"):
        return f"Practitioner/{text}" if text else "Practitioner/unknown"

    # Date fields
    if any(k in tf for k in ("date", "period.start", "period.end", "created", "billableperiod")):
        return normalize_date(value)

    # Gender
    if "gender" in tf:
        return map_gender(text)

    # ICD-10
    if "diagnosiscodeableconcept" in tf and tf.endswith(".code"):
        return _normalize_icd10(text)

    # Numeric amounts
    if tf.endswith(".value") and any(k in tf for k in ("total", "payment", "amount")):
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0

    # Email → lowercase
    if "email" in tf or "telecom" in tf:
        return text.lower() if "@" in text else text

    return text


# ---------------------------------------------------------------------------
# FHIR path writer
# ---------------------------------------------------------------------------

# Named array indices that Claude may produce for telecom entries.
# Maps the named key → (numeric index, FHIR system URI)
_TELECOM_NAMED_INDICES: Dict[str, Tuple[int, str]] = {
    "phone":  (0, "phone"),
    "email":  (1, "email"),
    "fax":    (2, "fax"),
    "url":    (3, "url"),
    "sms":    (4, "sms"),
    "other":  (5, "other"),
}


def _normalize_fhir_path(path: str, resource: Dict[str, Any]) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Normalize non-standard path segments before writing.

    Handles telecom[phone].value → telecom[0].value  (and injects system="phone")
    Handles telecom[email].value → telecom[1].value  (and injects system="email")

    Returns (normalized_path, side_effect_entry_or_None).
    The side_effect is applied to the telecom array entry to set the system field.
    """
    # Match pattern: word[named_key]  e.g. telecom[phone], telecom[email]
    named_match = re.search(r'(\w+)\[([a-zA-Z_]+)\]', path)
    if named_match:
        arr_name = named_match.group(1)
        named_key = named_match.group(2).lower()
        if arr_name == "telecom" and named_key in _TELECOM_NAMED_INDICES:
            idx, system = _TELECOM_NAMED_INDICES[named_key]
            normalized = path.replace(f"telecom[{named_match.group(2)}]", f"telecom[{idx}]")
            return normalized, {"system": system}
        # Unknown named index — fall back to idx=0 to avoid literal key creation
        idx_fallback = 0
        normalized = re.sub(r'\[([a-zA-Z_]+)\]', f'[{idx_fallback}]', path, count=1)
        return normalized, None
    return path, None


def set_fhir_path(resource: Dict[str, Any], path: str, value: Any) -> None:
    """
    Write a value into a nested FHIR resource dict using dot-notation paths.
    Handles:
      - Numeric array indices:  name[0].given[0]
      - Named telecom indices:  telecom[phone].value → telecom[0] with system injected
    """
    path, side_effect = _normalize_fhir_path(path, resource)
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
                # Apply side effect (e.g. inject system into telecom entry)
                if side_effect and isinstance(cur[name][idx], dict):
                    for k, v in side_effect.items():
                        cur[name][idx].setdefault(k, v)
            else:
                if not isinstance(cur[name][idx], dict):
                    cur[name][idx] = {}
                # Apply side effect at the array entry level
                if side_effect and i == len(parts) - 2:
                    for k, v in side_effect.items():
                        cur[name][idx].setdefault(k, v)
                cur = cur[name][idx]
        else:
            if last:
                cur[part] = value
            else:
                if part not in cur or not isinstance(cur[part], dict):
                    cur[part] = {}
                cur = cur[part]


# ---------------------------------------------------------------------------
# FHIR resource builder — fully driven by mapping contract
# ---------------------------------------------------------------------------

def build_fhir_resource(
    resource_type: str,
    row: Dict[str, Any],
    field_mappings: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """
    Convert one source row to a FHIR resource using the mapping contract.
    No field names are hardcoded — all logic is driven by target_field paths.
    """
    resource: Dict[str, Any] = {"resourceType": resource_type}
    trace: List[Dict[str, Any]] = []

    auto_fields = [f for f in field_mappings if f["status"] == "auto_mapped" and f.get("target_field")]

    for mapping in auto_fields:
        source_col = mapping["source_column"]
        source_value = row.get(source_col)
        if source_value is None:
            continue

        # Strip resource type prefix: "Patient.name[0].given[0]" → "name[0].given[0]"
        raw_target = str(mapping["target_field"])
        target_path = raw_target.split('.', 1)[1] if '.' in raw_target else raw_target

        transformed_value = classify_value(raw_target, source_col, source_value)
        if transformed_value is None:
            continue

        set_fhir_path(resource, target_path, transformed_value)
        trace.append({
            "source_column": source_col,
            "source_value": stringify(source_value),
            "target_field": raw_target,
            "transformed_value": stringify(transformed_value),
            "confidence": mapping["confidence"],
            "reason": mapping["reason"],
        })

    apply_resource_defaults(resource)
    return resource, trace


# ---------------------------------------------------------------------------
# FHIR R4 defaults — fills required fields not covered by source data
# ---------------------------------------------------------------------------

def apply_resource_defaults(resource: Dict[str, Any]) -> None:
    rt = resource.get("resourceType")
    if rt == "Patient":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("identifier", [{"system": "urn:fhir:identifier", "value": resource["id"]}])
        existing_name = resource.get("name")
        if not existing_name:
            resource["name"] = [{"use": "official", "family": "UNKNOWN", "given": ["UNKNOWN"]}]
        else:
            first = existing_name[0] if isinstance(existing_name, list) and existing_name else {}
            if isinstance(first, dict):
                if not first.get("family"):
                    first["family"] = "UNKNOWN"
                if not first.get("given") or not any(first.get("given", [])):
                    first["given"] = ["UNKNOWN"]
        resource.setdefault("gender", "unknown")

        # Ensure telecom entries have system field (FHIR R4 requires it)
        # telecom[0] = phone, telecom[1] = email by convention
        _TELECOM_SYSTEMS = ["phone", "email", "fax", "url", "sms", "other"]
        for i, entry in enumerate(resource.get("telecom", [])):
            if isinstance(entry, dict) and not entry.get("system") and i < len(_TELECOM_SYSTEMS):
                entry["system"] = _TELECOM_SYSTEMS[i]
            if isinstance(entry, dict) and not entry.get("use"):
                entry.setdefault("use", "home")

    elif rt == "Coverage":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("status", "active")
        resource.setdefault("beneficiary", {"reference": "Patient/UNKNOWN"})
        resource.setdefault("type", {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "HIP"}],
            "text": "health insurance plan policy",
        })
        resource.setdefault("subscriber", resource.get("beneficiary", {"reference": "Patient/UNKNOWN"}))
        resource.setdefault("payor", [{"display": "Unknown Payor"}])

    elif rt == "Claim":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("status", "active")
        resource.setdefault("use", "claim")
        resource.setdefault("type", {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/claim-type", "code": "professional"}]
        })
        resource.setdefault("priority", {"coding": [{"code": "normal"}]})
        resource.setdefault("patient", {"reference": "Patient/UNKNOWN"})
        resource.setdefault("provider", {"display": "Unknown Provider"})
        resource.setdefault("insurer", {"display": "Unknown Insurer"})
        resource.setdefault("created", datetime.date.today().isoformat())
        resource.setdefault("billablePeriod", {"start": "1970-01-01", "end": "1970-01-01"})

    elif rt == "Practitioner":
        resource.setdefault("id", str(uuid.uuid4()))

    elif rt == "Organization":
        resource.setdefault("id", str(uuid.uuid4()))
        resource.setdefault("active", True)


# ---------------------------------------------------------------------------
# FHIR R4 structural validator
# ---------------------------------------------------------------------------

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
        if not names:
            errors.append("Patient.name missing")
        else:
            first = names[0] if names else {}
            family = first.get("family", "")
            given = first.get("given", [])
            if not family and not any(g for g in given if g and g != "UNKNOWN"):
                errors.append("Patient.name requires non-empty family or given")
        bd = resource.get("birthDate")
        if bd and not DATE_RE.match(stringify(bd)):
            errors.append("Patient.birthDate must be YYYY-MM-DD")
        gender = stringify(resource.get("gender", "")).lower()
        if gender and gender not in _VALID_GENDERS:
            errors.append(f"Patient.gender '{gender}' invalid; must be one of {sorted(_VALID_GENDERS)}")

    elif rt == "Coverage":
        if not (resource.get("beneficiary") or {}).get("reference"):
            errors.append("Coverage.beneficiary.reference missing")
        if not resource.get("status"):
            errors.append("Coverage.status missing")
        if not resource.get("type"):
            errors.append("Coverage.type missing (FHIR R4 required)")
        if not resource.get("payor"):
            errors.append("Coverage.payor missing (FHIR R4 required)")

    elif rt == "Claim":
        if not (resource.get("patient") or {}).get("reference"):
            errors.append("Claim.patient.reference missing")
        provider = resource.get("provider") or {}
        if not provider.get("reference") and not provider.get("display"):
            errors.append("Claim.provider missing (FHIR R4 required)")
        if not resource.get("billablePeriod"):
            errors.append("Claim.billablePeriod missing (FHIR R4 required)")
        if not resource.get("insurer"):
            errors.append("Claim.insurer missing (FHIR R4 required)")
        total = resource.get("total")
        if total and "value" in total:
            try:
                float(total["value"])
            except (ValueError, TypeError):
                errors.append("Claim.total.value must be numeric")

    return errors


# ---------------------------------------------------------------------------
# Mapping summary builder — Claude-first, structural fallback
# ---------------------------------------------------------------------------

def build_mapping_summary(schema_info: Dict[str, Any], anthropic_api_key: str = "") -> Dict[str, Any]:
    """
    Build FHIR field mapping for all discovered source tables.

    Claude AI path (primary):
      - One API call per table during discovery.
      - Understands any column naming: abbreviations, legacy codes, non-English.
      - Returns structured mapping with confidence scores.

    Structural fallback (when Claude is unavailable):
      - Uses data type patterns and sample value analysis only.
      - No hardcoded field name aliases.
      - Maps columns to FHIR paths based on value shape: date → date fields,
        UUID → id fields, numeric → amount fields, etc.
    """
    from claude_mapper import ai_map_table, normalize_ai_mapping_to_engine_format

    mapping_summary = []
    requires_review: List[Dict] = []
    unmapped_fields: List[Dict] = []

    use_ai = bool(
        anthropic_api_key
        and anthropic_api_key.strip()
        and not anthropic_api_key.startswith("your-")
    )

    for table_name, info in schema_info.items():
        ai_result = None

        if use_ai:
            ai_result = ai_map_table(
                table_name,
                info["columns_raw"],
                info["sample_rows"],
                anthropic_api_key,
            )

        if ai_result:
            normalized = normalize_ai_mapping_to_engine_format(
                ai_result, table_name, info["row_count"]
            )
            table_entry = normalized["table_summary"]

            # Enrich fields with actual data type and sample values from schema
            col_meta = {c["name"]: c for c in info["columns_raw"]}
            for field in table_entry["fields"]:
                col = col_meta.get(field["source_column"], {})
                field["data_type"] = col.get("type")
                field["sample_values"] = [
                    stringify(row.get(field["source_column"]))
                    for row in info["sample_rows"][:3]
                ]

            requires_review.extend(normalized["requires_review"])
            unmapped_fields.extend(normalized["unmapped_fields"])
            mapping_summary.append(table_entry)
        else:
            # Structural fallback — no aliases, value-shape driven
            table_entry = _structural_fallback_map(
                table_name, info, requires_review, unmapped_fields
            )
            mapping_summary.append(table_entry)

    return {
        "mapping_summary": mapping_summary,
        "requires_review": requires_review,
        "unmapped_fields": unmapped_fields,
    }


# ---------------------------------------------------------------------------
# Structural fallback mapper — value-shape driven, zero hardcoded names
# ---------------------------------------------------------------------------

def _structural_fallback_map(
    table_name: str,
    info: Dict[str, Any],
    requires_review: list,
    unmapped_fields: list,
) -> Dict[str, Any]:
    """
    When Claude is unavailable, infer FHIR resource type and field mappings
    purely from data type and sample value shapes. No column name aliases.
    """
    import re as _re

    EMAIL_RE = _re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
    PHONE_RE = _re.compile(r'\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}')
    ZIP_RE = _re.compile(r'^\d{5}(?:-\d{4})?$')
    ICD10_RE = _re.compile(r'^[A-Z]\d{2}(?:\.\w{1,4})?$')
    NPI_RE = _re.compile(r'^\d{10}$')

    def _sample_vals(col_name: str) -> List[str]:
        return [stringify(r.get(col_name)).strip() for r in info["sample_rows"] if stringify(r.get(col_name)).strip()]

    def _detect_shape(col_name: str, col_type: str) -> str:
        samples = _sample_vals(col_name)
        if not samples:
            return "unknown"
        ct = col_type.lower()
        if any(t in ct for t in ("date", "timestamp")):
            return "date"
        if any(t in ct for t in ("numeric", "decimal", "double", "real", "float")):
            return "numeric"
        if any(t in ct for t in ("int", "bigint", "smallint")):
            return "integer"
        if any(DATE_RE.match(v) for v in samples):
            return "date"
        if any(NPI_RE.match(v) for v in samples):
            return "npi"
        if any(ICD10_RE.match(v.upper()) for v in samples):
            return "icd10"
        if any(UUID_RE.match(v) for v in samples):
            return "uuid"
        if any(EMAIL_RE.match(v) for v in samples):
            return "email"
        if any(PHONE_RE.search(v) for v in samples):
            return "phone"
        if any(ZIP_RE.match(v) for v in samples):
            return "zip"
        if any(v.upper() in {"M", "F", "MALE", "FEMALE", "OTHER", "UNKNOWN"} for v in samples):
            return "gender"
        if all(_is_numeric(v) for v in samples):
            return "numeric"
        return "text"

    def _is_numeric(v: str) -> bool:
        try:
            float(v)
            return True
        except (ValueError, TypeError):
            return False

    # Infer resource type from column shapes (not names)
    shapes = {}
    for col in info["columns_raw"]:
        shapes[col["name"]] = _detect_shape(col["name"], col.get("type", ""))

    has_icd10 = any(s == "icd10" for s in shapes.values())
    has_npi = any(s == "npi" for s in shapes.values())
    has_gender = any(s == "gender" for s in shapes.values())
    has_two_dates = sum(1 for s in shapes.values() if s == "date") >= 2
    numeric_count = sum(1 for s in shapes.values() if s == "numeric")

    if has_icd10 or has_npi:
        resource_type = "Claim"
        resource_confidence = 0.80
        resource_reasoning = ["ICD-10 or NPI values detected in sample data"]
    elif has_gender and has_two_dates:
        resource_type = "Patient"
        resource_confidence = 0.75
        resource_reasoning = ["Gender codes and multiple date fields suggest demographic data"]
    elif has_two_dates and numeric_count == 0:
        resource_type = "Coverage"
        resource_confidence = 0.70
        resource_reasoning = ["Multiple date fields with no numeric amounts suggest coverage periods"]
    else:
        resource_type = "Patient"
        resource_confidence = 0.50
        resource_reasoning = ["Default inference — configure the narrative-LLM API key for accurate mapping"]

    # Map columns to FHIR paths by value shape
    SHAPE_TO_FHIR: Dict[str, Dict[str, str]] = {
        "Patient": {
            "date": "Patient.birthDate",
            "gender": "Patient.gender",
            "email": "Patient.telecom[0].value",
            "phone": "Patient.telecom[1].value",
            "zip": "Patient.address[0].postalCode",
            "uuid": "Patient.id",
            "text": "Patient.id",
        },
        "Coverage": {
            "date": "Coverage.period.start",
            "uuid": "Coverage.id",
            "text": "Coverage.id",
        },
        "Claim": {
            "date": "Claim.billablePeriod.start",
            "icd10": "Claim.diagnosis[0].diagnosisCodeableConcept.coding[0].code",
            "npi": "Claim.provider.reference",
            "numeric": "Claim.total.value",
            "uuid": "Claim.id",
            "text": "Claim.id",
        },
    }

    shape_map = SHAPE_TO_FHIR.get(resource_type, {})
    used_targets: Dict[str, int] = {}  # target → usage count for deduplication
    field_mappings = []

    for col in info["columns_raw"]:
        col_name = col["name"]
        if col_name.lower() in OPERATIONAL_COLUMNS:
            entry = {
                "source_column": col_name,
                "target_field": None,
                "confidence": 0.0,
                "status": "ignored",
                "reason": "operational metadata column",
                "candidates": [],
                "data_type": col.get("type"),
                "sample_values": _sample_vals(col_name)[:3],
            }
            field_mappings.append(entry)
            unmapped_fields.append({"table": table_name, "resource": resource_type, **entry})
            continue

        shape = shapes.get(col_name, "unknown")
        raw_target = shape_map.get(shape)

        # Handle duplicate targets (e.g. two date columns)
        if raw_target:
            count = used_targets.get(raw_target, 0)
            if count > 0:
                # Shift arrays: period.start → period.end, diagnosis[0] → diagnosis[1], etc.
                raw_target = raw_target.replace("[0]", f"[{count}]").replace(".start", ".end" if count == 1 else f"[{count}]")
            used_targets[raw_target] = count + 1

        confidence = 0.75 if raw_target else 0.0
        status = "auto_mapped" if confidence >= AUTO_MAP_THRESHOLD else ("requires_review" if confidence >= REVIEW_THRESHOLD else "ignored")

        entry = {
            "source_column": col_name,
            "target_field": raw_target,
            "confidence": confidence,
            "status": status,
            "reason": f"inferred from value shape: {shape}" if raw_target else "no structural match found",
            "candidates": [],
            "data_type": col.get("type"),
            "sample_values": _sample_vals(col_name)[:3],
        }
        field_mappings.append(entry)

        if status == "requires_review":
            requires_review.append({"table": table_name, "resource": resource_type, **entry})
        elif status == "ignored":
            unmapped_fields.append({"table": table_name, "resource": resource_type, **entry})

    return {
        "table": table_name,
        "resource": resource_type,
        "resource_confidence": resource_confidence,
        "resource_reasoning": resource_reasoning,
        "resource_candidates": {},
        "fields": field_mappings,
        "row_count": info["row_count"],
        "mapped_by": "structural_fallback",
    }
