"""Synthetic CCD/CDA sample generator.

Produces realistic HL7 C-CDA XML documents with varied clinical content:
mixed document types (CCD, Discharge Summary, Progress Note), multiple
HEDIS scenarios (some close quality gaps, some don't), and a mix of
structured entries + narrative-only sections so the NLP path gets
exercised too.

Data is deterministic per-seed so the demo is reproducible.
"""
from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

DEMO_SEED = 424242


FIRST_NAMES = [
    "Maria", "John", "Carlos", "Anh", "Priya", "Elena", "Marcus", "Janelle",
    "Hiro", "Sofia", "Darnell", "Luisa", "Yosef", "Amara", "Kwame", "Rosa",
    "Dmitri", "Leilani", "Ibrahim", "Grace",
]
LAST_NAMES = [
    "Garcia", "Nguyen", "Johnson", "Patel", "Martinez", "Lee", "Okafor",
    "Hernandez", "Thompson", "Ramos", "Khan", "Diaz", "Williams", "Singh",
    "Rodriguez", "Chen", "Brown", "Ali", "Lopez", "Kim",
]
FACILITIES = [
    "LA County USC Medical Center",
    "Cedars-Sinai ED",
    "Olive View-UCLA Medical Center",
    "Harbor-UCLA Medical Center",
    "Community BH Clinic — Downtown LA",
    "East LA Family Medicine",
    "South Bay Primary Care",
    "Westside Mental Health Associates",
]
PROVIDERS = [
    ("Dr. Amelia Carter", "Family Medicine"),
    ("Dr. Rohan Shah", "Behavioral Health"),
    ("Dr. Sofia Ramirez", "Internal Medicine"),
    ("Dr. Elena Vasquez", "Emergency Medicine"),
    ("Dr. Kenji Tanaka", "Endocrinology"),
    ("Dr. Aisha Rahman", "Psychiatry"),
]

# Measure scenario templates
SCENARIOS = [
    "FUM_CLOSED",   # ED visit + BH follow-up within 7 days
    "FUM_CLOSED_30",
    "FUA_CLOSED",
    "CBP_CONTROLLED",
    "HBD_CONTROLLED",
    "MRP_CLOSED",
    "NO_EVIDENCE",  # claims-only visit, nothing to find
    "CBP_UNCONTROLLED",
    "HBD_UNCONTROLLED",
]


@dataclass
class Member:
    id: str
    name_first: str
    name_last: str
    dob: str
    gender: str
    race: str
    ethnicity: str

    @property
    def name(self) -> str:
        return f"{self.name_first} {self.name_last}"


def _rng(seed: int | None = None) -> random.Random:
    return random.Random(seed if seed is not None else DEMO_SEED)


def _gen_member(rng: random.Random) -> Member:
    year = rng.randint(1945, 2006)
    month = rng.randint(1, 12)
    day = rng.randint(1, 28)
    return Member(
        id=f"LAC{rng.randint(10_000_000, 99_999_999)}",
        name_first=rng.choice(FIRST_NAMES),
        name_last=rng.choice(LAST_NAMES),
        dob=f"{year:04d}{month:02d}{day:02d}",
        gender=rng.choice(["M", "F"]),
        race=rng.choice(["Hispanic/Latino", "Black or African American", "Asian", "White", "Other"]),
        ethnicity=rng.choice(["Hispanic", "Non-Hispanic"]),
    )


def _hl7_time(dt: datetime) -> str:
    return dt.strftime("%Y%m%d%H%M%S") + "+0000"


def _hl7_date(dt: datetime) -> str:
    return dt.strftime("%Y%m%d")


def generate_document(scenario: str, rng: random.Random, base_date: datetime | None = None) -> tuple[str, dict]:
    """Return (xml, metadata). metadata is for the dashboard list."""
    base_date = base_date or datetime(2026, 3, 1)
    member = _gen_member(rng)
    doc_id = str(uuid.uuid4())

    if scenario in ("FUM_CLOSED", "FUM_CLOSED_30"):
        ed_date = base_date + timedelta(days=rng.randint(-60, 0))
        followup_days = rng.randint(1, 7) if scenario == "FUM_CLOSED" else rng.randint(8, 28)
        followup_date = ed_date + timedelta(days=followup_days)
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="11506-3",
            doc_type_name="Progress Note",
            member=member,
            encounter_date=followup_date,
            facility=rng.choice([f for f in FACILITIES if "BH" in f or "Mental" in f]),
            provider=next(p for p in PROVIDERS if p[1] in ("Behavioral Health", "Psychiatry")),
            problems=[("F32.9", "Major depressive disorder, single episode, unspecified", "ICD-10")],
            encounters=[
                ("99281", "Emergency department visit", _hl7_time(ed_date), "emergency"),
                ("99214", "Outpatient visit, established patient", _hl7_time(followup_date), "outpatient behavioral health follow-up"),
            ],
            narrative_sections={
                "encounters": (
                    f"Patient was seen for behavioral health follow-up on {followup_date.strftime('%m/%d/%Y')} "
                    f"following ED visit on {ed_date.strftime('%m/%d/%Y')} for acute depressive episode. "
                    f"Reports improved mood, adherent to sertraline 50mg daily. PHQ-9 score 8 (previous 18). "
                    f"Plan: continue current regimen, RTC in 4 weeks."
                ),
            },
        )
        meta_scenario = "FUM gap closed"

    elif scenario == "FUA_CLOSED":
        ed_date = base_date + timedelta(days=rng.randint(-45, -7))
        followup_date = ed_date + timedelta(days=rng.randint(2, 14))
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="11506-3",
            doc_type_name="Progress Note",
            member=member,
            encounter_date=followup_date,
            facility=rng.choice(FACILITIES),
            provider=next(p for p in PROVIDERS if p[1] in ("Behavioral Health", "Psychiatry", "Family Medicine")),
            problems=[("F10.20", "Alcohol dependence, uncomplicated", "ICD-10")],
            encounters=[
                ("99281", "Emergency department visit", _hl7_time(ed_date), "emergency"),
                ("99213", "Outpatient follow-up", _hl7_time(followup_date), "outpatient follow-up AOD"),
            ],
            narrative_sections={
                "encounters": (
                    f"Follow-up after ED visit on {ed_date.strftime('%m/%d/%Y')} for alcohol intoxication. "
                    f"Patient engaged with outpatient SUD program. Naltrexone started."
                ),
            },
        )
        meta_scenario = "FUA gap closed"

    elif scenario in ("CBP_CONTROLLED", "CBP_UNCONTROLLED"):
        enc_date = base_date + timedelta(days=rng.randint(-120, 0))
        sys = rng.randint(118, 138) if scenario == "CBP_CONTROLLED" else rng.randint(148, 178)
        dia = rng.randint(70, 88) if scenario == "CBP_CONTROLLED" else rng.randint(92, 108)
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="34133-9",
            doc_type_name="Continuity of Care Document",
            member=member,
            encounter_date=enc_date,
            facility=rng.choice(FACILITIES),
            provider=next(p for p in PROVIDERS if p[1] in ("Family Medicine", "Internal Medicine")),
            problems=[("I10", "Essential (primary) hypertension", "ICD-10")],
            vitals=[("8480-6", "Systolic BP", sys, "mm[Hg]", _hl7_time(enc_date)),
                    ("8462-4", "Diastolic BP", dia, "mm[Hg]", _hl7_time(enc_date))],
            medications=[("197361", "Lisinopril 10 MG Oral Tablet", "RxNorm", "10", "mg", "daily")],
            narrative_sections={
                "vital_signs": f"BP {sys}/{dia} mmHg recorded during routine visit {enc_date.strftime('%m/%d/%Y')}.",
            },
        )
        meta_scenario = "CBP controlled" if scenario == "CBP_CONTROLLED" else "CBP not controlled"

    elif scenario in ("HBD_CONTROLLED", "HBD_UNCONTROLLED"):
        enc_date = base_date + timedelta(days=rng.randint(-150, -10))
        a1c = round(rng.uniform(6.2, 7.9), 1) if scenario == "HBD_CONTROLLED" else round(rng.uniform(8.3, 11.8), 1)
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="34133-9",
            doc_type_name="Continuity of Care Document",
            member=member,
            encounter_date=enc_date,
            facility=rng.choice(FACILITIES),
            provider=next(p for p in PROVIDERS if p[1] in ("Endocrinology", "Internal Medicine", "Family Medicine")),
            problems=[("E11.9", "Type 2 diabetes mellitus without complications", "ICD-10")],
            results=[("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", a1c, "%", _hl7_time(enc_date))],
            medications=[("860975", "Metformin 1000 MG Oral Tablet", "RxNorm", "1000", "mg", "BID")],
            narrative_sections={
                "results": f"HbA1c {a1c}% on {enc_date.strftime('%m/%d/%Y')}. Diabetes { 'well-controlled' if a1c < 8 else 'not at goal' }.",
            },
        )
        meta_scenario = "HBD controlled" if scenario == "HBD_CONTROLLED" else "HBD not controlled"

    elif scenario == "MRP_CLOSED":
        discharge_date = base_date + timedelta(days=rng.randint(-60, -5))
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="18842-5",
            doc_type_name="Discharge Summary",
            member=member,
            encounter_date=discharge_date,
            facility=rng.choice([f for f in FACILITIES if "Medical Center" in f or "ED" in f]),
            provider=next(p for p in PROVIDERS if p[1] in ("Internal Medicine", "Emergency Medicine")),
            problems=[("I50.9", "Heart failure, unspecified", "ICD-10")],
            medications=[
                ("197361", "Lisinopril 10 MG Oral Tablet", "RxNorm", "10", "mg", "daily"),
                ("314077", "Furosemide 40 MG Oral Tablet", "RxNorm", "40", "mg", "BID"),
                ("197781", "Metoprolol 25 MG Oral Tablet", "RxNorm", "25", "mg", "BID"),
            ],
            plan_of_care=[("405178006", "Medication reconciliation", "SNOMED")],
            narrative_sections={
                "plan_of_care": (
                    f"Medication reconciliation completed at discharge on {discharge_date.strftime('%m/%d/%Y')}. "
                    f"Patient educated on all medications, adherence counseling provided. "
                    f"Follow-up scheduled with PCP within 7 days."
                ),
            },
        )
        meta_scenario = "MRP gap closed"

    else:  # NO_EVIDENCE
        enc_date = base_date + timedelta(days=rng.randint(-120, 0))
        xml = _build_ccda(
            doc_id=doc_id,
            doc_type_code="57133-1",
            doc_type_name="Referral Note",
            member=member,
            encounter_date=enc_date,
            facility=rng.choice(FACILITIES),
            provider=rng.choice(PROVIDERS),
            problems=[("M54.5", "Low back pain", "ICD-10")],
            narrative_sections={"assessment_and_plan": "Referral for physical therapy evaluation."},
        )
        meta_scenario = "No HEDIS evidence"

    meta = {
        "document_id": doc_id,
        "member_id": member.id,
        "member_name": member.name,
        "scenario": scenario,
        "scenario_label": meta_scenario,
    }
    return xml, meta


def generate_batch(count: int = 500, seed: int | None = None) -> list[dict]:
    """Generate `count` synthetic CCDAs. Returns list of {xml, metadata}."""
    rng = _rng(seed)
    weights = {
        "FUM_CLOSED": 10,
        "FUM_CLOSED_30": 7,
        "FUA_CLOSED": 6,
        "CBP_CONTROLLED": 14,
        "CBP_UNCONTROLLED": 9,
        "HBD_CONTROLLED": 11,
        "HBD_UNCONTROLLED": 8,
        "MRP_CLOSED": 10,
        "NO_EVIDENCE": 25,
    }
    pool: list[str] = []
    for scn, w in weights.items():
        pool.extend([scn] * w)

    batch = []
    for _ in range(count):
        scn = rng.choice(pool)
        xml, meta = generate_document(scn, rng)
        batch.append({"xml": xml, "metadata": meta})
    return batch


def _build_ccda(
    doc_id: str,
    doc_type_code: str,
    doc_type_name: str,
    member: Member,
    encounter_date: datetime,
    facility: str,
    provider: tuple[str, str],
    problems: list[tuple[str, str, str]] | None = None,
    encounters: list[tuple[str, str, str, str]] | None = None,
    procedures: list[tuple[str, str, str, str]] | None = None,
    results: list[tuple] | None = None,
    vitals: list[tuple] | None = None,
    medications: list[tuple] | None = None,
    plan_of_care: list[tuple[str, str, str]] | None = None,
    narrative_sections: dict[str, str] | None = None,
) -> str:
    problems = problems or []
    encounters = encounters or []
    procedures = procedures or []
    results = results or []
    vitals = vitals or []
    medications = medications or []
    plan_of_care = plan_of_care or []
    narrative_sections = narrative_sections or {}

    first, last = provider[0].replace("Dr. ", "").rsplit(" ", 1)

    sections_xml = []

    if problems:
        sections_xml.append(_render_problems(problems, narrative_sections.get("problems")))
    if encounters:
        sections_xml.append(_render_encounters(encounters, narrative_sections.get("encounters")))
    if procedures:
        sections_xml.append(_render_procedures(procedures, narrative_sections.get("procedures")))
    if vitals:
        sections_xml.append(_render_vitals(vitals, narrative_sections.get("vital_signs")))
    if results:
        sections_xml.append(_render_results(results, narrative_sections.get("results")))
    if medications:
        sections_xml.append(_render_medications(medications, narrative_sections.get("medications")))
    if plan_of_care:
        sections_xml.append(_render_plan(plan_of_care, narrative_sections.get("plan_of_care")))
    # Include any remaining narrative-only sections (no structured entries)
    for k, v in narrative_sections.items():
        if k in ("problems", "encounters", "procedures", "vital_signs", "results", "medications", "plan_of_care"):
            continue
        sections_xml.append(_render_narrative_only(k, v))

    sections_block = "\n".join(sections_xml)

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<ClinicalDocument xmlns="urn:hl7-org:v3">
  <realmCode code="US"/>
  <typeId root="2.16.840.1.113883.1.3" extension="POCD_HD000040"/>
  <templateId root="2.16.840.1.113883.10.20.22.1.1"/>
  <id root="2.16.840.1.113883.19.5" extension="{doc_id}"/>
  <code code="{doc_type_code}" codeSystem="2.16.840.1.113883.6.1" displayName="{doc_type_name}"/>
  <title>{doc_type_name}</title>
  <effectiveTime value="{_hl7_time(encounter_date)}"/>
  <confidentialityCode code="N" codeSystem="2.16.840.1.113883.5.25"/>
  <languageCode code="en-US"/>
  <recordTarget>
    <patientRole>
      <id root="2.16.840.1.113883.19.5" extension="{member.id}"/>
      <patient>
        <name><given>{member.name_first}</given><family>{member.name_last}</family></name>
        <administrativeGenderCode code="{member.gender}" codeSystem="2.16.840.1.113883.5.1"/>
        <birthTime value="{member.dob}"/>
        <raceCode code="2106-3" displayName="{member.race}" codeSystem="2.16.840.1.113883.6.238"/>
        <ethnicGroupCode code="2186-5" displayName="{member.ethnicity}" codeSystem="2.16.840.1.113883.6.238"/>
      </patient>
    </patientRole>
  </recordTarget>
  <author>
    <time value="{_hl7_time(encounter_date)}"/>
    <assignedAuthor>
      <id root="2.16.840.1.113883.4.6" extension="NPI-{hash(provider[0]) % 10_000_000}"/>
      <assignedPerson><name>{first} {last}</name></assignedPerson>
      <representedOrganization><name>{facility}</name></representedOrganization>
    </assignedAuthor>
  </author>
  <custodian>
    <assignedCustodian>
      <representedCustodianOrganization>
        <id root="2.16.840.1.113883.19.5"/>
        <name>LA Care Health Plan</name>
      </representedCustodianOrganization>
    </assignedCustodian>
  </custodian>
  <componentOf>
    <encompassingEncounter>
      <id root="2.16.840.1.113883.19.5" extension="ENC-{hash(doc_id) % 10_000_000}"/>
      <code code="AMB" displayName="Ambulatory" codeSystem="2.16.840.1.113883.5.4"/>
      <effectiveTime value="{_hl7_time(encounter_date)}"/>
      <location>
        <healthCareFacility>
          <location><name>{facility}</name></location>
        </healthCareFacility>
      </location>
    </encompassingEncounter>
  </componentOf>
  <component>
    <structuredBody>
{sections_block}
    </structuredBody>
  </component>
</ClinicalDocument>"""


def _render_problems(problems, narrative):
    entries = "\n".join(
        f"""<entry><act classCode="ACT" moodCode="EVN">
  <code code="CONC" codeSystem="2.16.840.1.113883.5.6"/>
  <statusCode code="active"/>
  <entryRelationship typeCode="SUBJ">
    <observation classCode="OBS" moodCode="EVN">
      <code code="{code}" codeSystem="2.16.840.1.113883.6.90" displayName="{display}"/>
      <value xsi:type="CD" code="{code}" codeSystem="2.16.840.1.113883.6.90" displayName="{display}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
      <statusCode code="completed"/>
    </observation>
  </entryRelationship>
</act></entry>"""
        for (code, display, _system) in problems
    )
    text = narrative or f"Active problems: {', '.join(p[1] for p in problems)}."
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.5.1"/>
        <code code="11450-4" codeSystem="2.16.840.1.113883.6.1" displayName="Problem List"/>
        <title>Problems</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_encounters(encounters, narrative):
    entries = "\n".join(
        f"""<entry><encounter classCode="ENC" moodCode="EVN">
  <code code="{code}" codeSystem="2.16.840.1.113883.6.12" displayName="{display}"/>
  <statusCode code="completed"/>
  <effectiveTime value="{when}"/>
</encounter></entry>"""
        for (code, display, when, _label) in encounters
    )
    text = narrative or "; ".join(f"{e[3]} on {e[2][:8]}" for e in encounters)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.22"/>
        <code code="46240-8" codeSystem="2.16.840.1.113883.6.1" displayName="Encounters"/>
        <title>Encounters</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_procedures(procedures, narrative):
    entries = "\n".join(
        f"""<entry><procedure classCode="PROC" moodCode="EVN">
  <code code="{code}" codeSystem="2.16.840.1.113883.6.12" displayName="{display}"/>
  <statusCode code="completed"/>
  <effectiveTime value="{when}"/>
</procedure></entry>"""
        for (code, display, when, _label) in procedures
    )
    text = narrative or "; ".join(p[1] for p in procedures)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.7.1"/>
        <code code="47519-4" codeSystem="2.16.840.1.113883.6.1" displayName="Procedures"/>
        <title>Procedures</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_vitals(vitals, narrative):
    entries = "\n".join(
        f"""<entry><observation classCode="OBS" moodCode="EVN">
  <code code="{code}" codeSystem="2.16.840.1.113883.6.1" displayName="{display}"/>
  <statusCode code="completed"/>
  <effectiveTime value="{when}"/>
  <value xsi:type="PQ" value="{value}" unit="{unit}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
</observation></entry>"""
        for (code, display, value, unit, when) in vitals
    )
    text = narrative or "; ".join(f"{v[1]} {v[2]} {v[3]}" for v in vitals)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.4.1"/>
        <code code="8716-3" codeSystem="2.16.840.1.113883.6.1" displayName="Vital Signs"/>
        <title>Vital Signs</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_results(results, narrative):
    entries = "\n".join(
        f"""<entry><observation classCode="OBS" moodCode="EVN">
  <code code="{code}" codeSystem="2.16.840.1.113883.6.1" displayName="{display}"/>
  <statusCode code="completed"/>
  <effectiveTime value="{when}"/>
  <value xsi:type="PQ" value="{value}" unit="{unit}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>
</observation></entry>"""
        for (code, display, value, unit, when) in results
    )
    text = narrative or "; ".join(f"{r[1]} = {r[2]}{r[3]}" for r in results)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.3.1"/>
        <code code="30954-2" codeSystem="2.16.840.1.113883.6.1" displayName="Results"/>
        <title>Results</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_medications(meds, narrative):
    entries = "\n".join(
        f"""<entry><substanceAdministration classCode="SBADM" moodCode="EVN">
  <statusCode code="active"/>
  <effectiveTime xsi:type="PIVL_TS" institutionSpecified="false" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <period value="1" unit="d"/>
  </effectiveTime>
  <doseQuantity value="{dose_value}" unit="{dose_unit}"/>
  <consumable><manufacturedProduct><manufacturedMaterial>
    <code code="{code}" codeSystem="2.16.840.1.113883.6.88" displayName="{display}"/>
  </manufacturedMaterial></manufacturedProduct></consumable>
</substanceAdministration></entry>"""
        for (code, display, _system, dose_value, dose_unit, _freq) in meds
    )
    text = narrative or "; ".join(m[1] for m in meds)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.1.1"/>
        <code code="10160-0" codeSystem="2.16.840.1.113883.6.1" displayName="Medications"/>
        <title>Medications</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_plan(items, narrative):
    entries = "\n".join(
        f"""<entry><act classCode="ACT" moodCode="INT">
  <code code="{code}" codeSystem="2.16.840.1.113883.6.96" displayName="{display}"/>
  <statusCode code="active"/>
</act></entry>"""
        for (code, display, _system) in items
    )
    text = narrative or "; ".join(p[1] for p in items)
    return f"""      <component><section>
        <templateId root="2.16.840.1.113883.10.20.22.2.10"/>
        <code code="18776-5" codeSystem="2.16.840.1.113883.6.1" displayName="Plan of Care"/>
        <title>Plan of Care</title>
        <text>{text}</text>
        {entries}
      </section></component>"""


def _render_narrative_only(key: str, narrative: str) -> str:
    loinc = {
        "assessment_and_plan": ("51847-2", "Assessment and Plan"),
        "discharge_instructions": ("69730-0", "Discharge Instructions"),
    }.get(key, ("55107-7", key.replace("_", " ").title()))
    return f"""      <component><section>
        <code code="{loinc[0]}" codeSystem="2.16.840.1.113883.6.1" displayName="{loinc[1]}"/>
        <title>{loinc[1]}</title>
        <text>{narrative}</text>
      </section></component>"""
