"""Batch pipeline orchestrator for CCDA processing.

Reads the run's documents from the database, runs each through the six
agents (ingest → extract → normalize → NLP → HEDIS → dashboard rollup),
and writes all intermediate + final state back to the database. Every
agent emits per-document `step_events` so the UI can render a drill-down
timeline of "exactly what happened to this document".
"""
from __future__ import annotations

import asyncio
from time import perf_counter
from typing import Any

from .ccda_parser import parse_ccda
from .hedis_engine import evaluate_document
from .nlp_extractor import extract_from_narrative
from . import repository as repo
from platform_db import log_activity


AGENT_NAMES = ["ingest", "extraction", "normalization", "nlp", "hedis", "dashboard"]


def _short(s: str, n: int = 120) -> str:
    if not s:
        return ""
    s = str(s).replace("\n", " ").strip()
    return s[:n] + "…" if len(s) > n else s


class PipelineCancelled(Exception):
    """Raised when an operator cancels the run mid-flight."""


def _check_cancelled(run_id: str) -> None:
    """Bail out cleanly when the run has been externally halted."""
    row = repo.get_run(run_id)
    if row and row.get("status") == "halted":
        raise PipelineCancelled(f"Run {run_id} halted by operator")


async def run_pipeline(run_id: str, use_ai: bool = True) -> dict[str, Any]:
    """Run the full CCDA pipeline for `run_id`. Documents must already be
    inserted into lacare_documents with raw_xml populated."""
    try:
        for a in AGENT_NAMES:
            repo.upsert_agent(run_id, a, "idle", "", 0, 0)
        repo.set_run_status(run_id, "running", stage="ingest")
        log_activity("pipeline", message=f"Pipeline started for run {run_id[:8]}")

        docs = repo.fetch_documents_for_run(run_id)
        total = len(docs)
        repo.set_run_counts(run_id, total=total, processed=0)

        await _ingest(run_id, docs);              _check_cancelled(run_id)
        parsed_docs = await _extract(run_id, docs); _check_cancelled(run_id)
        await _normalize(run_id, parsed_docs);    _check_cancelled(run_id)
        await _nlp(run_id, parsed_docs, use_ai=use_ai); _check_cancelled(run_id)
        await _hedis(run_id, parsed_docs);        _check_cancelled(run_id)
        await _rollup(run_id, parsed_docs)

        repo.set_run_status(run_id, "complete", stage="complete")
        repo.write_log(run_id, "success", f"Run complete — processed {total} CCDA documents")
        log_activity("pipeline", message=f"Pipeline complete — {total} docs, run {run_id[:8]}")
    except (PipelineCancelled, asyncio.CancelledError) as exc:
        repo.write_log(run_id, "warning", f"Pipeline cancelled: {exc}")
        repo.set_run_status(run_id, "halted", stage="halted", notes=str(exc))
        log_activity("pipeline", message=f"Pipeline HALTED — run {run_id[:8]}")
        # Do not re-raise CancelledError; the run state is now clean.
    except Exception as exc:
        repo.write_log(run_id, "error", f"Pipeline failed: {exc}")
        repo.set_run_status(run_id, "failed", stage="failed", notes=str(exc))
        log_activity("pipeline", message=f"Pipeline FAILED: {exc}")
        raise
    return repo.get_run(run_id) or {}


# --------------------------------------------------------------------------- #
# Stages
# --------------------------------------------------------------------------- #

async def _ingest(run_id: str, docs: list[dict]):
    repo.upsert_agent(run_id, "ingest", "running", "Reading CCDA documents from database", 0, 0)
    repo.write_log(run_id, "info", f"Ingest agent accepting {len(docs)} CCDA documents")
    t0 = perf_counter()
    events = []
    for idx, doc in enumerate(docs, 1):
        raw_xml = doc.get("raw_xml") or ""
        xml_chars = len(raw_xml)
        # Record a head snippet of the raw XML so the UI can render the real "before".
        xml_head = raw_xml[:1200]
        events.append({
            "run_id": run_id,
            "document_id": doc.get("document_id") or "",
            "agent": "ingest",
            "step_label": "Validated C-CDA XML envelope",
            "input_summary": f"{xml_chars} chars of raw XML ({doc.get('document_type') or 'Clinical Document'})",
            "output_summary": f"Queued for extraction — sections declared: {len(doc.get('sections') or [])}",
            "details": {
                "xml_bytes": xml_chars,
                "document_type": doc.get("document_type"),
                "declared_sections": doc.get("sections") or [],
                "scenario": doc.get("scenario"),
                "raw_xml_head": xml_head,
            },
            "duration_ms": 0,
        })
        if idx % max(1, len(docs) // 20) == 0:
            await asyncio.sleep(0.01)
            repo.upsert_agent(run_id, "ingest", "running",
                              f"Validated {idx}/{len(docs)} documents",
                              idx, int((perf_counter() - t0) * 1000))
    repo.record_steps_batch(events)
    repo.upsert_agent(run_id, "ingest", "complete",
                      f"Queued {len(docs)} documents for extraction",
                      len(docs), int((perf_counter() - t0) * 1000))
    repo.write_log(run_id, "success", f"Ingest complete — {len(docs)} documents loaded from DB")


async def _extract(run_id: str, docs: list[dict]) -> list[dict]:
    repo.upsert_agent(run_id, "extraction", "running",
                      "Parsing C-CDA XML (urn:hl7-org:v3) with template-id aware parser", 0, 0)
    repo.write_log(run_id, "info", "Extraction agent scanning document structure, mapping LOINC sections")
    repo.set_run_status(run_id, "running", stage="extraction")
    t0 = perf_counter()
    parsed: list[dict] = []
    total_sections = 0
    events: list[dict] = []
    step = max(1, len(docs) // 10)
    for idx, doc in enumerate(docs, 1):
        raw_xml = doc.get("raw_xml") or ""
        parsed_json = parse_ccda(raw_xml) if raw_xml else (doc.get("parsed_json") or {})
        doc["parsed_json"] = parsed_json
        sections_map = parsed_json.get("sections") or {}
        section_entry_counts = {k: len(v) for k, v in sections_map.items()}
        section_total = sum(section_entry_counts.values())
        total_sections += section_total
        parsed.append(doc)

        # Sample the first 3 entries so the UI can show "we pulled code X from section Y"
        example_entries: list[dict] = []
        for sec_name, entries in list(sections_map.items())[:4]:
            for e in entries[:2]:
                code_obj = e.get("code") or {}
                example_entries.append({
                    "section": sec_name,
                    "display": e.get("display") or code_obj.get("display") or "",
                    "code": code_obj.get("code") or "",
                    "code_system": code_obj.get("code_system_name") or code_obj.get("code_system") or "",
                    "value": e.get("value") or "",
                })

        narrative_map = parsed_json.get("narrative") or {}
        narrative_preview = {
            k: (v or "")[:280] for k, v in list(narrative_map.items())[:4] if (v or "").strip()
        }
        events.append({
            "run_id": run_id,
            "document_id": doc.get("document_id") or "",
            "agent": "extraction",
            "step_label": "Parsed LOINC sections + structured entries",
            "input_summary": f"{len(raw_xml)} chars raw XML",
            "output_summary": f"{len(sections_map)} sections, {section_total} structured entries",
            "details": {
                "sections": section_entry_counts,
                "example_entries": example_entries,
                "document_type": parsed_json.get("document_type"),
                "narrative_chars": sum(len(v or "") for v in narrative_map.values()),
                "raw_xml_head": raw_xml[:1200],
                "narrative_preview": narrative_preview,
            },
        })
        if idx % step == 0:
            await asyncio.sleep(0.02)
            repo.upsert_agent(run_id, "extraction", "running",
                              f"Extracted {idx}/{len(docs)} documents — {total_sections} clinical entries",
                              idx, int((perf_counter() - t0) * 1000))
            repo.set_run_counts(run_id, processed=idx)
    repo.record_steps_batch(events)
    repo.upsert_agent(run_id, "extraction", "complete",
                      f"Extracted {len(parsed)} docs, {total_sections} structured clinical entries",
                      len(parsed), int((perf_counter() - t0) * 1000))
    repo.set_run_counts(run_id, processed=len(parsed))
    repo.write_log(run_id, "success",
                   f"Extraction complete — {total_sections} clinical entries from {len(parsed)} documents")
    return parsed


async def _normalize(run_id: str, parsed: list[dict]):
    repo.upsert_agent(run_id, "normalization", "running",
                      "Normalizing codes → SNOMED / LOINC / ICD-10 / RxNorm", 0, 0)
    repo.write_log(run_id, "info", "Normalization agent mapping local codes to standard value sets")
    repo.set_run_status(run_id, "running", stage="normalization")
    t0 = perf_counter()
    mapped_total = 0
    events: list[dict] = []
    step = max(1, len(parsed) // 8)
    for idx, doc in enumerate(parsed, 1):
        pj = doc.get("parsed_json") or {}
        per_system: dict[str, int] = {}
        doc_mapped = 0
        unmapped = 0
        for _section, entries in (pj.get("sections") or {}).items():
            for entry in entries:
                code = (entry.get("code") or {})
                sys = (code.get("code_system_name") or code.get("code_system") or "").upper()
                if code.get("code"):
                    doc_mapped += 1
                    if sys:
                        key = "SNOMED" if "SNOMED" in sys else \
                              "LOINC" if "LOINC" in sys else \
                              "ICD-10" if "ICD" in sys else \
                              "RxNorm" if "RXNORM" in sys else \
                              "CPT" if "CPT" in sys else "OTHER"
                        per_system[key] = per_system.get(key, 0) + 1
                else:
                    unmapped += 1
        mapped_total += doc_mapped
        events.append({
            "run_id": run_id,
            "document_id": doc.get("document_id") or "",
            "agent": "normalization",
            "step_label": "Mapped codes to standard value sets",
            "input_summary": f"{doc_mapped + unmapped} entries from extraction",
            "output_summary": f"{doc_mapped} mapped · {unmapped} narrative-only",
            "details": {"by_code_system": per_system, "unmapped": unmapped},
        })
        if idx % step == 0:
            await asyncio.sleep(0.02)
            repo.upsert_agent(run_id, "normalization", "running",
                              f"Mapped {mapped_total} codes ({idx}/{len(parsed)} docs)",
                              idx, int((perf_counter() - t0) * 1000))
    repo.record_steps_batch(events)
    repo.upsert_agent(run_id, "normalization", "complete",
                      f"Normalized {mapped_total} coded entries to standard value sets",
                      len(parsed), int((perf_counter() - t0) * 1000))
    repo.write_log(run_id, "success", f"Normalization complete — {mapped_total} codes mapped")


async def _nlp(run_id: str, parsed: list[dict], use_ai: bool = True):
    label = "clinical LLM" if use_ai else "heuristic fallback"
    repo.upsert_agent(run_id, "nlp", "running",
                      f"Extracting clinical facts from narrative text ({label})", 0, 0)
    repo.write_log(run_id, "info", f"NLP agent running {label} on narrative blocks")
    repo.set_run_status(run_id, "running", stage="nlp")
    t0 = perf_counter()
    narrative_count = 0
    augmented = 0
    events: list[dict] = []
    step = max(1, len(parsed) // 6)
    for idx, doc in enumerate(parsed, 1):
        pj = doc.get("parsed_json") or {}
        narrative = pj.get("narrative", {}) or {}
        nlp_facts: dict[str, dict] = {}
        doc_chars = 0
        extracted_summary = {"encounter_dates": 0, "vitals": 0, "labs": 0, "medications": 0, "diagnoses": 0, "procedures": 0}
        # Per-block audit trail: the actual text sent and JSON we got back.
        # This is what lets the UI show "input → output" for each LLM call.
        blocks: list[dict] = []
        for key, text in narrative.items():
            if not text or len(text) < 40:
                continue
            narrative_count += 1
            doc_chars += len(text)
            t_call = perf_counter()
            extracted = await asyncio.to_thread(extract_from_narrative, text, use_ai)
            call_ms = int((perf_counter() - t_call) * 1000)
            block_summary = {k: len(extracted.get(k) or []) for k in extracted_summary}
            for k, v in block_summary.items():
                extracted_summary[k] += v
            nlp_facts[key] = extracted
            blocks.append({
                "section": key,
                "input_chars": len(text),
                "input_text": text[:900],
                "output": extracted,
                "fact_counts": block_summary,
                "source": extracted.get("source") or "heuristic",
                "duration_ms": call_ms,
                "llm_error": extracted.get("llm_error") or "",
            })
            repo.write_log(
                run_id, "info",
                f"NLP block ({key}) · {len(text)} chars · {sum(block_summary.values())} facts "
                f"· source={extracted.get('source')} · {call_ms}ms",
            )
        did_augment = any(extracted_summary.values())
        if did_augment:
            augmented += 1
        if nlp_facts:
            doc["nlp_json"] = nlp_facts
            if doc.get("id"):
                repo.set_document_nlp(doc["id"], nlp_facts)
        events.append({
            "run_id": run_id,
            "document_id": doc.get("document_id") or "",
            "agent": "nlp",
            "step_label": f"NLP on narrative ({label})" if doc_chars else "Narrative too short — skipped",
            "input_summary": f"{doc_chars} chars narrative across {len(blocks)} block(s)",
            "output_summary": (
                f"extracted {sum(extracted_summary.values())} facts from {len(blocks)} block(s)"
                if did_augment else "no additional facts beyond structured entries"
            ),
            "details": {
                "facts_extracted": extracted_summary,
                "engine": label,
                "blocks": blocks,
                "use_ai_requested": use_ai,
            },
            "status": "complete" if doc_chars else "skipped",
        })
        if idx % step == 0:
            await asyncio.sleep(0.03)
            repo.upsert_agent(run_id, "nlp", "running",
                              f"Processed {narrative_count} narrative blocks — {augmented} augmented",
                              idx, int((perf_counter() - t0) * 1000))
    repo.record_steps_batch(events)
    repo.upsert_agent(run_id, "nlp", "complete",
                      f"NLP enriched {augmented} documents from narrative text",
                      len(parsed), int((perf_counter() - t0) * 1000))
    repo.write_log(run_id, "success",
                   f"NLP complete — {augmented} docs augmented from {narrative_count} narrative blocks ({label})")


async def _hedis(run_id: str, parsed: list[dict]):
    repo.upsert_agent(run_id, "hedis", "running", "Matching findings against HEDIS value sets", 0, 0)
    repo.write_log(run_id, "info", "HEDIS engine evaluating FUM, FUA, CBP, HBD, MRP")
    repo.set_run_status(run_id, "running", stage="hedis")
    t0 = perf_counter()
    all_hits: list[dict] = []
    events: list[dict] = []
    step = max(1, len(parsed) // 8)
    for idx, doc in enumerate(parsed, 1):
        pj = doc.get("parsed_json") or {}
        hits = evaluate_document(pj)
        for h in hits:
            h["document_scenario"] = doc.get("scenario", "")
            h["source_document_id"] = doc.get("document_id") or h.get("source_document_id")
        all_hits.extend(hits)
        hit_codes = [h.get("measure") for h in hits if h.get("satisfied")]
        top = [{
            "measure": h.get("measure"),
            "measure_name": h.get("measure_name"),
            "confidence": round(float(h.get("confidence") or 0), 2),
            "summary": _short(h.get("summary") or "", 140),
            "section": h.get("source_section"),
        } for h in hits[:6]]
        events.append({
            "run_id": run_id,
            "document_id": doc.get("document_id") or "",
            "agent": "hedis",
            "step_label": "Evaluated vs. HEDIS value sets",
            "input_summary": f"{sum(len(v) for v in (pj.get('sections') or {}).values())} entries, scenario={doc.get('scenario') or 'unknown'}",
            "output_summary": (
                f"{len(hit_codes)} hits: {', '.join(sorted(set(hit_codes)))}"
                if hit_codes else "no HEDIS evidence found"
            ),
            "details": {"hits": top, "measures_matched": sorted(set(hit_codes))},
        })
        if idx % step == 0:
            await asyncio.sleep(0.01)
            repo.upsert_agent(run_id, "hedis", "running",
                              f"{len(all_hits)} evidence hits found ({idx}/{len(parsed)} docs scanned)",
                              idx, int((perf_counter() - t0) * 1000))
    repo.record_steps_batch(events)
    if all_hits:
        repo.insert_hits(run_id, all_hits)
    repo.upsert_agent(run_id, "hedis", "complete",
                      f"Found {len(all_hits)} HEDIS evidence hits across {len(parsed)} documents",
                      len(parsed), int((perf_counter() - t0) * 1000))
    repo.write_log(run_id, "success", f"HEDIS matching complete — {len(all_hits)} hits persisted to DB")


async def _rollup(run_id: str, parsed: list[dict]):
    repo.upsert_agent(run_id, "dashboard", "running",
                      "Aggregating evidence, computing gap-closure impact", 0, 0)
    repo.set_run_status(run_id, "running", stage="dashboard")
    t0 = perf_counter()
    await asyncio.sleep(0.2)
    hits = repo.list_hits(run_id)
    satisfied = [h for h in hits if h.get("satisfied")]
    gap_members = {(h.get("patient_id"), h.get("measure")) for h in satisfied}
    from .hedis_engine import estimate_revenue_impact
    revenue = estimate_revenue_impact(satisfied)
    repo.upsert_agent(run_id, "dashboard", "complete",
                      f"Rollup ready — {len(gap_members)} gaps closed, ${revenue['total_usd']:.0f} impact",
                      len(parsed), int((perf_counter() - t0) * 1000))
    repo.write_log(run_id, "success",
                   f"Dashboard ready — {len(gap_members)} gaps closed, est. ${revenue['total_usd']:.0f} quality bonus recovery",
                   meta={"revenue": revenue})
