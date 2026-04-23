"""Narrative-text NLP extractor.

When a CDA section has useful information only in the <text> narrative
block (and not in structured entries), this module sends the narrative
to the configured clinical LLM (via the official SDK) and asks it to extract
clinical facts in a strict JSON schema. If no API key is configured,
we fall back to a heuristic regex extractor that's good enough for the
demo and keeps the pipeline deterministic.
"""
from __future__ import annotations

import json
import os
import re
from datetime import datetime
from typing import Any

from config import get_settings

_SYSTEM_PROMPT = """You are a clinical NLP extractor. Given a narrative text block
from a CCD/CDA section, extract clinical facts. Return STRICT JSON, no prose,
matching this schema:
{
  "encounter_dates": ["YYYY-MM-DD"],
  "diagnoses": [{"text": "...", "icd10": "..."}],
  "procedures": [{"text": "...", "cpt": "..."}],
  "medications": [{"text": "...", "rxnorm": "", "dose": "...", "frequency": "..."}],
  "labs": [{"text": "...", "loinc": "...", "value": "...", "unit": "..."}],
  "vitals": [{"text": "...", "sys": 0, "dia": 0}]
}
Only include fields that are clearly supported by the text. Use empty arrays when nothing is found."""


def extract_from_narrative(text: str, use_ai: bool | None = None) -> dict[str, Any]:
    """Extract clinical facts from narrative text.

    When a narrative-LLM API key is configured (via .env or environment), the
    default behaviour is to call the clinical LLM on the real narrative text.
    When the key is absent or the call fails, we fall back to a deterministic
    regex extractor so the pipeline never deadlocks.
    """
    if not text or not text.strip():
        return _empty()
    settings = get_settings()
    api_key = settings.anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or ""
    has_key = bool(api_key)
    if use_ai is None:
        use_ai = has_key
    if use_ai and has_key:
        try:
            return _llm_extract(text, api_key)
        except Exception as exc:
            # Stash the reason on the fallback so operators can see it in the UI
            fallback = _heuristic_extract(text)
            fallback["llm_error"] = str(exc)[:200]
            fallback["source"] = "heuristic-after-llm-error"
            return fallback
    return _heuristic_extract(text)


def _empty() -> dict[str, Any]:
    return {
        "encounter_dates": [],
        "diagnoses": [],
        "procedures": [],
        "medications": [],
        "labs": [],
        "vitals": [],
        "source": "empty",
    }


def _llm_extract(text: str, api_key: str) -> dict[str, Any]:
    from anthropic import Anthropic
    client = Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-3-5-sonnet-20240620",
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": text}],
    )
    body = message.content[0].text if message.content else "{}"
    body = body.strip().strip("`")
    # sometimes the model wraps in ```json ... ```
    body = re.sub(r"^json\s*", "", body, flags=re.IGNORECASE)
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return _heuristic_extract(text)
    parsed.setdefault("encounter_dates", [])
    parsed.setdefault("diagnoses", [])
    parsed.setdefault("procedures", [])
    parsed.setdefault("medications", [])
    parsed.setdefault("labs", [])
    parsed.setdefault("vitals", [])
    parsed["source"] = "clinical-llm"
    return parsed


_DATE_RE = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b")
_BP_RE = re.compile(r"\bBP\s*(\d{2,3})\s*/\s*(\d{2,3})\b", re.IGNORECASE)
_A1C_RE = re.compile(r"HbA1c\s*(\d+\.?\d*)\s*%", re.IGNORECASE)
_MED_RE = re.compile(
    r"\b([A-Z][a-z]+(?:in|ol|ine|ate|ium|pril|sartan|statin))\s+(\d+)\s*mg(?:\s+(\w+))?",
)


def _heuristic_extract(text: str) -> dict[str, Any]:
    encounter_dates: list[str] = []
    for m, d, y in _DATE_RE.findall(text):
        try:
            encounter_dates.append(datetime(int(y), int(m), int(d)).strftime("%Y-%m-%d"))
        except ValueError:
            continue

    vitals = []
    for sys, dia in _BP_RE.findall(text):
        vitals.append({"text": f"BP {sys}/{dia}", "sys": int(sys), "dia": int(dia)})

    labs = []
    for val in _A1C_RE.findall(text):
        try:
            labs.append({"text": f"HbA1c {val}%", "loinc": "4548-4", "value": float(val), "unit": "%"})
        except ValueError:
            continue

    medications = []
    for name, dose, freq in _MED_RE.findall(text):
        medications.append({"text": f"{name} {dose}mg {freq}".strip(), "rxnorm": "", "dose": f"{dose}mg", "frequency": freq or ""})

    diagnoses: list[dict[str, Any]] = []
    for keyword, icd in (
        ("depress", "F32.9"),
        ("anxiety", "F41.9"),
        ("alcohol", "F10.20"),
        ("hypertens", "I10"),
        ("diabet", "E11.9"),
        ("heart failure", "I50.9"),
    ):
        if keyword in text.lower():
            diagnoses.append({"text": keyword, "icd10": icd})

    return {
        "encounter_dates": encounter_dates,
        "diagnoses": diagnoses,
        "procedures": [],
        "medications": medications,
        "labs": labs,
        "vitals": vitals,
        "source": "heuristic",
    }
