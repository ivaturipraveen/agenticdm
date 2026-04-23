"""
Claude-powered FHIR schema mapper.

Makes a single structured API call per table to Claude to infer:
  - Which FHIR R4 resource type this table maps to
  - Which source column maps to which FHIR field path
  - Confidence and reasoning for each mapping

Falls back to fuzzy keyword scoring if:
  - ANTHROPIC_API_KEY is not set
  - API call fails for any reason

This is called ONCE per pipeline run during discovery — not per record.
All row-by-row transformation remains deterministic.
"""

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Process-wide circuit breaker: once we see an auth error (invalid API key) we
# stop attempting further Claude calls for the rest of the process lifetime.
# Prevents burning 5-15s of dead time per pipeline run when the key is bad.
_AUTH_FAILED: bool = False


def _is_auth_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "401" in msg
        or "invalid x-api-key" in msg
        or "authentication_error" in msg
        or "invalid api key" in msg
    )


def reset_auth_breaker() -> None:
    """Clear the auth circuit breaker (e.g. after rotating the key)."""
    global _AUTH_FAILED
    _AUTH_FAILED = False

# FHIR R4 field catalog — passed to Claude as context so it knows
# valid target paths. Claude does NOT hardcode guesses; it reasons
# against actual column names and sample values.
FHIR_FIELD_CATALOG: Dict[str, List[str]] = {
    "Patient": [
        "Patient.id",
        "Patient.identifier[0].value",
        "Patient.name[0].given[0]",
        "Patient.name[0].family",
        "Patient.birthDate",
        "Patient.gender",
        "Patient.telecom[0].value",
        "Patient.telecom[1].value",
        "Patient.address[0].line[0]",
        "Patient.address[0].city",
        "Patient.address[0].state",
        "Patient.address[0].postalCode",
        "Patient.address[0].country",
        "Patient.maritalStatus.text",
        "Patient.communication[0].language.text",
    ],
    "Coverage": [
        "Coverage.id",
        "Coverage.beneficiary.reference",
        "Coverage.subscriber.reference",
        "Coverage.subscriberId",
        "Coverage.status",
        "Coverage.type.text",
        "Coverage.type.coding[0].code",
        "Coverage.class[0].value",
        "Coverage.class[0].name",
        "Coverage.period.start",
        "Coverage.period.end",
        "Coverage.payor[0].display",
        "Coverage.payor[0].identifier.value",
        "Coverage.grouping.group",
        "Coverage.grouping.groupDisplay",
        "Coverage.order",
        "Coverage.network",
    ],
    "Claim": [
        "Claim.id",
        "Claim.patient.reference",
        "Claim.provider.reference",
        "Claim.provider.display",
        "Claim.insurer.display",
        "Claim.insurer.identifier.value",
        "Claim.status",
        "Claim.use",
        "Claim.created",
        "Claim.billablePeriod.start",
        "Claim.billablePeriod.end",
        "Claim.diagnosis[0].diagnosisCodeableConcept.coding[0].code",
        "Claim.diagnosis[0].diagnosisCodeableConcept.coding[0].system",
        "Claim.diagnosis[0].diagnosisCodeableConcept.text",
        "Claim.diagnosis[1].diagnosisCodeableConcept.coding[0].code",
        "Claim.procedure[0].procedureCodeableConcept.coding[0].code",
        "Claim.procedure[0].procedureCodeableConcept.coding[0].system",
        "Claim.total.value",
        "Claim.total.currency",
        "Claim.payment.amount.value",
        "Claim.payment.amount.currency",
        "Claim.facility.identifier.value",
        "Claim.facility.display",
        "Claim.type.coding[0].code",
        "Claim.priority.coding[0].code",
        "Claim.careTeam[0].provider.reference",
    ],
    "Practitioner": [
        "Practitioner.id",
        "Practitioner.identifier[0].value",
        "Practitioner.identifier[0].system",
        "Practitioner.name[0].family",
        "Practitioner.name[0].given[0]",
        "Practitioner.telecom[0].value",
        "Practitioner.address[0].line[0]",
        "Practitioner.address[0].city",
        "Practitioner.address[0].state",
        "Practitioner.address[0].postalCode",
        "Practitioner.qualification[0].code.text",
    ],
    "Organization": [
        "Organization.id",
        "Organization.name",
        "Organization.identifier[0].value",
        "Organization.type[0].text",
        "Organization.telecom[0].value",
        "Organization.address[0].line[0]",
        "Organization.address[0].city",
        "Organization.address[0].state",
        "Organization.address[0].postalCode",
    ],
}

# Operational columns that should never be mapped to FHIR fields
IGNORE_COLUMNS = {"created_at", "updated_at", "dataset_id", "deleted_at",
                  "modified_at", "inserted_at", "load_ts", "etl_ts"}


def _build_prompt(table_name: str, columns: List[Dict[str, Any]],
                  sample_rows: List[Dict[str, Any]]) -> str:
    """Build the Claude prompt for schema mapping."""

    # Prepare column descriptions with sample values
    col_descriptions = []
    for col in columns:
        name = col["name"]
        dtype = col.get("type", "unknown")
        samples = [str(row.get(name, "")) for row in sample_rows if row.get(name) is not None]
        samples = [s for s in samples if s.strip()][:3]
        sample_str = f" | samples: {samples}" if samples else ""
        col_descriptions.append(f"  - {name} ({dtype}){sample_str}")

    all_resource_types = list(FHIR_FIELD_CATALOG.keys())
    catalog_str = json.dumps(FHIR_FIELD_CATALOG, indent=2)

    return f"""You are a healthcare data engineer specializing in FHIR R4 transformations.

I have a PostgreSQL table named "{table_name}" with these columns and sample values:
{chr(10).join(col_descriptions)}

Your task:
1. Identify which FHIR R4 resource type this table represents. Choose from: {all_resource_types}
2. Map each source column to the most appropriate FHIR R4 field path from the catalog below.
3. Assign a confidence score (0.0–1.0) for each mapping.
4. Columns that are purely operational metadata (audit timestamps, ETL fields, partition keys) should be marked as "ignore".

FHIR R4 Field Catalog (only map to paths listed here):
{catalog_str}

Rules:
- Use semantic understanding — column names may be abbreviations, internal codes, or non-English.
- "member_id", "mbr_id", "pt_id", "subscriber_id" all likely map to Patient.id or an identifier field.
- Columns containing ICD-10-like values (letter + digits, e.g. A123, Z987) → Claim diagnosis fields.
- NPI-like values (10 digits) → provider reference fields.
- Phone columns → Patient.telecom[0].value  (index 0 = phone)
- Email columns → Patient.telecom[1].value  (index 1 = email)
- ALWAYS use numeric array indices in paths: telecom[0], name[0], diagnosis[0] etc. NEVER use named indices like telecom[phone].
- A confidence >= 0.85 means auto-map. Between 0.55–0.84 means requires human review.
- If no good FHIR match exists, set target_field to null and confidence to 0.0.

Respond ONLY with valid JSON in exactly this format:
{{
  "resource_type": "<FHIR resource type>",
  "resource_confidence": <0.0-1.0>,
  "resource_reasoning": "<one sentence why>",
  "mappings": [
    {{
      "source_column": "<column name>",
      "target_field": "<FHIR.field.path or null>",
      "confidence": <0.0-1.0>,
      "status": "<auto_mapped|requires_review|ignored>",
      "reason": "<brief explanation>"
    }}
  ]
}}"""


def _call_claude(prompt: str, api_key: str) -> Dict[str, Any]:
    """Call Claude API synchronously and return parsed JSON response."""
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )

    raw = message.content[0].text.strip()

    # Strip markdown code fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()

    return json.loads(raw)


def ai_map_table(
    table_name: str,
    columns: List[Dict[str, Any]],
    sample_rows: List[Dict[str, Any]],
    api_key: str,
) -> Optional[Dict[str, Any]]:
    """
    Use Claude to map a source table to FHIR fields.

    Returns a dict with keys:
      resource_type, resource_confidence, resource_reasoning, mappings

    Returns None if the call fails (caller should fall back to fuzzy matching).
    """
    global _AUTH_FAILED
    if _AUTH_FAILED:
        # Earlier call in this process already hit a 401 — skip straight to fallback.
        return None
    try:
        # Filter out operational columns before sending to Claude
        mapped_columns = [c for c in columns if c["name"].lower() not in IGNORE_COLUMNS]
        if not mapped_columns:
            return None

        prompt = _build_prompt(table_name, mapped_columns, sample_rows)
        result = _call_claude(prompt, api_key)

        # Validate required keys
        if "resource_type" not in result or "mappings" not in result:
            logger.warning("[claude_mapper] Response missing required keys for table '%s'", table_name)
            return None

        # Add back operational columns as ignored
        op_cols = [c for c in columns if c["name"].lower() in IGNORE_COLUMNS]
        for col in op_cols:
            result["mappings"].append({
                "source_column": col["name"],
                "target_field": None,
                "confidence": 0.0,
                "status": "ignored",
                "reason": "operational/metadata column — not mapped to FHIR",
            })

        logger.info(
            "[claude_mapper] Table '%s' → %s (conf=%.2f) | %d auto, %d review, %d ignored",
            table_name,
            result["resource_type"],
            result.get("resource_confidence", 0),
            sum(1 for m in result["mappings"] if m["status"] == "auto_mapped"),
            sum(1 for m in result["mappings"] if m["status"] == "requires_review"),
            sum(1 for m in result["mappings"] if m["status"] == "ignored"),
        )
        return result

    except Exception as e:
        if _is_auth_error(e):
            _AUTH_FAILED = True
            logger.warning(
                "[claude_mapper] Auth error for table '%s' (ANTHROPIC_API_KEY invalid). "
                "Disabling Claude calls for remainder of process; using fuzzy matching: %s",
                table_name, e,
            )
        else:
            logger.warning("[claude_mapper] Failed for table '%s': %s — falling back to fuzzy matching", table_name, e)
        return None


def normalize_ai_mapping_to_engine_format(
    ai_result: Dict[str, Any],
    table_name: str,
    row_count: int,
) -> Dict[str, Any]:
    """
    Convert Claude's output into the same format that build_mapping_summary()
    produces, so the rest of the pipeline (transformation, QA, UI) is unchanged.
    """
    resource_type = ai_result["resource_type"]
    resource_confidence = ai_result.get("resource_confidence", 0.9)
    resource_reasoning = [ai_result.get("resource_reasoning", "Inferred by AI mapper")]

    fields = []
    requires_review = []
    unmapped_fields = []

    for m in ai_result["mappings"]:
        field_entry = {
            "source_column": m["source_column"],
            "target_field": m.get("target_field"),
            "confidence": m.get("confidence", 0.0),
            "status": m.get("status", "ignored"),
            "reason": m.get("reason", ""),
            "candidates": [],  # Claude gives best match directly
            "data_type": None,  # filled in by caller
            "sample_values": [],  # filled in by caller
        }
        fields.append(field_entry)

        if field_entry["status"] == "requires_review":
            requires_review.append({
                "table": table_name,
                "resource": resource_type,
                **field_entry,
            })
        elif field_entry["status"] == "ignored":
            unmapped_fields.append({
                "table": table_name,
                "resource": resource_type,
                **field_entry,
            })

    table_summary = {
        "table": table_name,
        "resource": resource_type,
        "resource_confidence": resource_confidence,
        "resource_reasoning": resource_reasoning,
        "resource_candidates": {},
        "fields": fields,
        "row_count": row_count,
        "mapped_by": "ai_mapper",  # provenance flag
    }

    return {
        "table_summary": table_summary,
        "requires_review": requires_review,
        "unmapped_fields": unmapped_fields,
    }
