"""CCD/CDA XML parser for HL7 C-CDA documents.

Handles the urn:hl7-org:v3 namespace, extracts the document header
(patient demographics, author, encounter) and all LOINC-coded sections
from the body. Produces a normalized dict that downstream components
(HEDIS engine, NLP extractor) can reason about.

Designed to be resilient: missing sections, malformed entries and
non-standard codings are captured as warnings rather than exceptions.
"""
from __future__ import annotations

import re
from typing import Any
from xml.etree import ElementTree as ET

HL7_NS = "urn:hl7-org:v3"
NS = {"h": HL7_NS}


# LOINC section codes we care about
SECTION_CODES = {
    "48765-2": "allergies",
    "10160-0": "medications",
    "11450-4": "problems",
    "47519-4": "procedures",
    "30954-2": "results",
    "8716-3": "vital_signs",
    "46240-8": "encounters",
    "11369-6": "immunizations",
    "18776-5": "plan_of_care",
    "42348-3": "advance_directives",
    "51847-2": "assessment_and_plan",
    "69730-0": "discharge_instructions",
    "10183-2": "discharge_instructions",
}

DOCUMENT_TYPE_CODES = {
    "34133-9": "CCD",
    "18842-5": "Discharge Summary",
    "57133-1": "Referral Note",
    "11506-3": "Progress Note",
    "34117-2": "History and Physical",
    "11488-4": "Consultation Note",
}


def _text(el: ET.Element | None) -> str:
    if el is None:
        return ""
    # Strip inline tags (like <content>, <paragraph>, <br/>) and join text
    raw = "".join(el.itertext())
    return re.sub(r"\s+", " ", raw).strip()


def _code(el: ET.Element | None) -> dict[str, str]:
    if el is None:
        return {}
    return {
        "code": el.get("code", ""),
        "display": el.get("displayName", ""),
        "system": el.get("codeSystem", ""),
        "system_name": el.get("codeSystemName", ""),
    }


def _value(el: ET.Element | None) -> dict[str, Any]:
    if el is None:
        return {}
    result: dict[str, Any] = {"type": el.get("{http://www.w3.org/2001/XMLSchema-instance}type", "")}
    if el.get("value") is not None:
        result["value"] = el.get("value")
    if el.get("unit") is not None:
        result["unit"] = el.get("unit")
    if el.get("code") is not None:
        result.update(_code(el))
    txt = _text(el)
    if txt:
        result["text"] = txt
    return result


def _effective_time(el: ET.Element | None) -> dict[str, str]:
    if el is None:
        return {}
    out: dict[str, str] = {}
    if el.get("value"):
        out["value"] = _fmt_date(el.get("value", ""))
    low = el.find("h:low", NS)
    high = el.find("h:high", NS)
    if low is not None and low.get("value"):
        out["low"] = _fmt_date(low.get("value", ""))
    if high is not None and high.get("value"):
        out["high"] = _fmt_date(high.get("value", ""))
    return out


def _fmt_date(raw: str) -> str:
    """HL7 TS → ISO-ish. '20260301093000+0000' → '2026-03-01 09:30'."""
    if not raw:
        return ""
    digits = re.sub(r"[^0-9]", "", raw)[:14]
    if len(digits) >= 8:
        y, m, d = digits[0:4], digits[4:6], digits[6:8]
        if len(digits) >= 12:
            return f"{y}-{m}-{d} {digits[8:10]}:{digits[10:12]}"
        return f"{y}-{m}-{d}"
    return raw


def parse_ccda(xml_text: str) -> dict[str, Any]:
    """Parse a C-CDA document into a structured dict.

    Returns shape:
      {
        "document_type": "Discharge Summary",
        "document_id": "...",
        "warnings": [...],
        "header": { patient, author, encounter, custodian },
        "sections": { "problems": [...], "medications": [...], ... },
        "narrative": { section_key: "human readable text", ... }
      }
    """
    warnings: list[str] = []
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        return {
            "document_type": "Unknown",
            "warnings": [f"malformed XML: {exc}"],
            "header": {},
            "sections": {},
            "narrative": {},
        }

    header = _parse_header(root, warnings)
    doc_type_code_el = root.find("h:code", NS)
    doc_code = doc_type_code_el.get("code", "") if doc_type_code_el is not None else ""
    doc_type = DOCUMENT_TYPE_CODES.get(doc_code, doc_type_code_el.get("displayName", "Clinical Document") if doc_type_code_el is not None else "Clinical Document")

    doc_id_el = root.find("h:id", NS)
    doc_id = doc_id_el.get("extension") or doc_id_el.get("root") if doc_id_el is not None else ""

    sections: dict[str, list[dict[str, Any]]] = {}
    narrative: dict[str, str] = {}

    # body/component/structuredBody/component/section
    body = root.find("h:component/h:structuredBody", NS)
    if body is None:
        warnings.append("no <structuredBody> found")
    else:
        for comp in body.findall("h:component", NS):
            section = comp.find("h:section", NS)
            if section is None:
                continue
            code_el = section.find("h:code", NS)
            loinc = code_el.get("code", "") if code_el is not None else ""
            key = SECTION_CODES.get(loinc)
            if key is None:
                # Unknown section — still capture narrative for NLP fallback
                title_el = section.find("h:title", NS)
                key = _text(title_el).lower().replace(" ", "_") or f"section_{loinc}"
            text_el = section.find("h:text", NS)
            narrative_text = _text(text_el)
            if narrative_text:
                narrative[key] = narrative_text
            entries: list[dict[str, Any]] = []
            for entry in section.findall("h:entry", NS):
                parsed_entry = _parse_entry(entry, key)
                if parsed_entry:
                    entries.append(parsed_entry)
            sections[key] = entries

    return {
        "document_id": doc_id,
        "document_type": doc_type,
        "warnings": warnings,
        "header": header,
        "sections": sections,
        "narrative": narrative,
    }


def _parse_header(root: ET.Element, warnings: list[str]) -> dict[str, Any]:
    header: dict[str, Any] = {"patient": {}, "author": {}, "encounter": {}, "custodian": {}}
    patient_role = root.find("h:recordTarget/h:patientRole", NS)
    if patient_role is not None:
        pid_el = patient_role.find("h:id", NS)
        header["patient"]["id"] = (pid_el.get("extension") if pid_el is not None else "") or ""
        patient = patient_role.find("h:patient", NS)
        if patient is not None:
            name_el = patient.find("h:name", NS)
            if name_el is not None:
                given = _text(name_el.find("h:given", NS))
                family = _text(name_el.find("h:family", NS))
                header["patient"]["name"] = f"{given} {family}".strip()
            gender_el = patient.find("h:administrativeGenderCode", NS)
            header["patient"]["gender"] = gender_el.get("code", "") if gender_el is not None else ""
            dob_el = patient.find("h:birthTime", NS)
            if dob_el is not None:
                header["patient"]["dob"] = _fmt_date(dob_el.get("value", ""))
            race_el = patient.find("h:raceCode", NS)
            if race_el is not None:
                header["patient"]["race"] = race_el.get("displayName", race_el.get("code", ""))
            eth_el = patient.find("h:ethnicGroupCode", NS)
            if eth_el is not None:
                header["patient"]["ethnicity"] = eth_el.get("displayName", eth_el.get("code", ""))
    else:
        warnings.append("no patient recordTarget")

    author = root.find("h:author", NS)
    if author is not None:
        time_el = author.find("h:time", NS)
        if time_el is not None:
            header["author"]["time"] = _fmt_date(time_el.get("value", ""))
        person = author.find("h:assignedAuthor/h:assignedPerson/h:name", NS)
        if person is not None:
            header["author"]["name"] = _text(person)
        org = author.find("h:assignedAuthor/h:representedOrganization/h:name", NS)
        if org is not None:
            header["author"]["organization"] = _text(org)

    enc = root.find("h:componentOf/h:encompassingEncounter", NS)
    if enc is not None:
        header["encounter"]["effective_time"] = _effective_time(enc.find("h:effectiveTime", NS))
        code_el = enc.find("h:code", NS)
        if code_el is not None:
            header["encounter"]["type"] = code_el.get("displayName", code_el.get("code", ""))
        facility_el = enc.find("h:location/h:healthCareFacility/h:location/h:name", NS)
        if facility_el is not None:
            header["encounter"]["facility"] = _text(facility_el)

    custodian_org = root.find("h:custodian/h:assignedCustodian/h:representedCustodianOrganization/h:name", NS)
    if custodian_org is not None:
        header["custodian"]["name"] = _text(custodian_org)

    return header


def _parse_entry(entry: ET.Element, section_key: str) -> dict[str, Any] | None:
    """Parse a structured <entry> into a dict. Section-aware."""
    # Observations, substanceAdministrations, procedures, encounters, acts...
    for child in entry:
        tag = child.tag.split("}", 1)[-1]
        if tag == "observation":
            return _parse_observation(child, section_key)
        if tag == "substanceAdministration":
            return _parse_medication(child)
        if tag == "procedure":
            return _parse_procedure(child)
        if tag == "encounter":
            return _parse_encounter(child)
        if tag == "act":
            obs = child.find("h:entryRelationship/h:observation", NS)
            if obs is not None:
                return _parse_observation(obs, section_key)
            return _parse_act(child)
    return None


def _parse_observation(obs: ET.Element, section_key: str) -> dict[str, Any]:
    code_el = obs.find("h:code", NS)
    value_el = obs.find("h:value", NS)
    interp_el = obs.find("h:interpretationCode", NS)
    time_el = obs.find("h:effectiveTime", NS)
    status_el = obs.find("h:statusCode", NS)
    translations = [_code(t) for t in obs.findall("h:code/h:translation", NS)]

    out = {
        "type": "observation",
        "section": section_key,
        "code": _code(code_el),
        "value": _value(value_el),
        "effective_time": _effective_time(time_el),
        "status": status_el.get("code", "") if status_el is not None else "",
    }
    if translations:
        out["translations"] = translations
    if interp_el is not None:
        out["interpretation"] = interp_el.get("code", "")
    return out


def _parse_medication(sa: ET.Element) -> dict[str, Any]:
    mat = sa.find("h:consumable/h:manufacturedProduct/h:manufacturedMaterial/h:code", NS)
    dose_el = sa.find("h:doseQuantity", NS)
    freq_el = sa.find("h:effectiveTime", NS)
    status_el = sa.find("h:statusCode", NS)
    return {
        "type": "medication",
        "section": "medications",
        "code": _code(mat),
        "dose": _value(dose_el),
        "frequency": _effective_time(freq_el),
        "status": status_el.get("code", "") if status_el is not None else "",
    }


def _parse_procedure(pr: ET.Element) -> dict[str, Any]:
    code_el = pr.find("h:code", NS)
    time_el = pr.find("h:effectiveTime", NS)
    status_el = pr.find("h:statusCode", NS)
    return {
        "type": "procedure",
        "section": "procedures",
        "code": _code(code_el),
        "effective_time": _effective_time(time_el),
        "status": status_el.get("code", "") if status_el is not None else "",
    }


def _parse_encounter(enc: ET.Element) -> dict[str, Any]:
    code_el = enc.find("h:code", NS)
    time_el = enc.find("h:effectiveTime", NS)
    status_el = enc.find("h:statusCode", NS)
    loc_el = enc.find("h:participant/h:participantRole/h:playingEntity/h:name", NS)
    return {
        "type": "encounter",
        "section": "encounters",
        "code": _code(code_el),
        "effective_time": _effective_time(time_el),
        "status": status_el.get("code", "") if status_el is not None else "",
        "location": _text(loc_el),
    }


def _parse_act(act: ET.Element) -> dict[str, Any]:
    code_el = act.find("h:code", NS)
    time_el = act.find("h:effectiveTime", NS)
    return {
        "type": "act",
        "code": _code(code_el),
        "effective_time": _effective_time(time_el),
    }
