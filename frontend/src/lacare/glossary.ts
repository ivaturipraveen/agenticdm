/**
 * Plain-English glossary so a non-clinical viewer (the client demo!) can
 * read every acronym on screen without flipping to Google. Every tab pulls
 * from this single source of truth.
 *
 * These definitions are based on NCQA's HEDIS MY 2025 technical specs and
 * the LA Care - Agentic CCDA Use Case.docx requirement document.
 */

export interface MeasureInfo {
  code: string
  name: string
  /** One-sentence summary for tooltips and hero cards. */
  short: string
  /** Multi-sentence explanation for dedicated info panels. */
  long: string
  /** The HEDIS "numerator event" — the clinical action that closes the gap. */
  numerator: string
  /** The HEDIS "denominator" — the population who qualifies for the measure. */
  denominator: string
  /** The time window the numerator event must fall in. */
  window: string
  /** Why claims data alone usually misses this — the supplemental-data story. */
  whyCcda: string
}

export const MEASURE_GLOSSARY: Record<string, MeasureInfo> = {
  FUM: {
    code: 'FUM',
    name: 'Follow-Up After ED Visit for Mental Illness',
    short: 'Behavioral-health follow-up within 7/30 days of a mental-illness ED visit.',
    long: 'Tracks whether members aged 6+ who were seen in an Emergency Department for a principal diagnosis of mental illness received a follow-up visit with a behavioral-health practitioner.',
    numerator: 'Any BH follow-up visit (office, tele, home, IOP, partial hospitalization).',
    denominator: 'Members 6+ with an ED visit that had a primary MH diagnosis.',
    window: '7-day and 30-day rates reported separately.',
    whyCcda: 'Outpatient BH follow-ups are often documented in CDA Progress Notes long before the claim posts — supplemental CCDA closes the gap in real time.',
  },
  FUA: {
    code: 'FUA',
    name: 'Follow-Up After ED Visit for Substance Use',
    short: 'Any AOD follow-up within 7/30 days of a substance-use ED visit.',
    long: 'Tracks whether members aged 13+ who were treated in an ED for alcohol or other drug (AOD) abuse or dependence received a follow-up visit.',
    numerator: 'Outpatient visit, IOP, partial-hospitalization, or tele-health encounter for AOD.',
    denominator: 'Members 13+ with an ED visit whose primary diagnosis was AOD abuse/dependence.',
    window: '7-day and 30-day rates reported separately.',
    whyCcda: 'Community-based AOD follow-ups (MAT clinics, peer support) frequently have CCDA Progress Notes but lag in claims.',
  },
  CBP: {
    code: 'CBP',
    name: 'Controlling High Blood Pressure',
    short: 'Most-recent BP < 140/90 mmHg for members with diagnosed HTN.',
    long: 'Members 18–85 with a diagnosis of hypertension whose most recent BP reading during the measurement year was adequately controlled (< 140/90 mmHg).',
    numerator: 'Most recent BP reading in the measurement year < 140/90 mmHg.',
    denominator: 'Members 18–85 with an HTN diagnosis who had at least one outpatient visit.',
    window: 'Most recent reading in the measurement year.',
    whyCcda: 'BP readings live in Vital Signs sections of CCDA — they are rarely in the claim stream. This measure is impossible without supplemental clinical data.',
  },
  HBD: {
    code: 'HBD',
    name: 'Hemoglobin A1c Control for Diabetes',
    short: 'Most-recent HbA1c ≤ 9.0% for members with diabetes.',
    long: 'Members 18–75 with diabetes (Type 1 or 2) whose most recent HbA1c level during the measurement year is ≤ 9.0% (poor control = > 9.0%).',
    numerator: 'Most-recent HbA1c result ≤ 9.0% (reported as "HbA1c Control (<8.0%)" and "Poor Control (>9.0%)").',
    denominator: 'Members 18–75 with a diabetes diagnosis.',
    window: 'Most-recent lab result in the measurement year.',
    whyCcda: 'Lab results live in the Results section of CCDA (LOINC 4548-4); they are administrative-data-only in 30% of plans.',
  },
  MRP: {
    code: 'MRP',
    name: 'Medication Reconciliation Post-Discharge',
    short: 'Medication reconciliation within 30 days of any inpatient discharge.',
    long: 'Members 18+ discharged from inpatient whose discharge medications were reconciled against the current medication list by a clinician within 30 days of discharge.',
    numerator: 'Documented medication reconciliation (CPT II 1111F, or narrative evidence).',
    denominator: 'Members 18+ with an inpatient discharge.',
    window: '30 days post-discharge.',
    whyCcda: 'The reconciliation note often lives in the Discharge Summary or Progress Note narrative — not in the claim.',
  },
}

export interface DocTypeInfo {
  name: string
  /** LOINC code for this document type. */
  loinc: string
  purpose: string
  typicalSections: string[]
}

export const DOC_TYPE_GLOSSARY: Record<string, DocTypeInfo> = {
  'Progress Note': {
    name: 'Progress Note',
    loinc: '11506-3',
    purpose: 'Ongoing clinical encounter note — visit summary, assessments, plan of care.',
    typicalSections: ['Problems', 'Assessments', 'Plan of Care', 'Encounters'],
  },
  'Discharge Summary': {
    name: 'Discharge Summary',
    loinc: '18842-5',
    purpose: 'Closes an inpatient admission — diagnoses on discharge, medications, follow-up plan. Critical for MRP.',
    typicalSections: ['Hospital Discharge Diagnosis', 'Discharge Medications', 'Hospital Course', 'Reason for Visit'],
  },
  'Referral Note': {
    name: 'Referral Note',
    loinc: '57133-1',
    purpose: 'Outpatient consult/referral record. Commonly carries BH follow-up evidence for FUM/FUA.',
    typicalSections: ['Problems', 'Reason for Referral', 'Plan of Care', 'Encounters'],
  },
  'Continuity of Care': {
    name: 'Continuity of Care Document (CCD)',
    loinc: '34133-9',
    purpose: 'Full longitudinal snapshot of a member — the gold-standard supplemental-data artifact.',
    typicalSections: ['Problems', 'Medications', 'Allergies', 'Results', 'Vital Signs', 'Encounters', 'Procedures'],
  },
}

// ---------------------------------------------------------------------------
// Acronym dictionary
// Every abbreviation on screen should resolve to a plain-English expansion
// when the user hovers the ? icon next to it. This is consumed by the
// <Acronym /> component to keep copy honest + the demo screen-friendly.
// ---------------------------------------------------------------------------

export interface AcronymEntry {
  /** Expanded form (e.g. "Healthcare Effectiveness Data and Information Set"). */
  full: string
  /** 1–2 sentence plain-English explanation for the hover tooltip. */
  description: string
}

export const ACRONYMS: Record<string, AcronymEntry> = {
  HEDIS: {
    full: 'Healthcare Effectiveness Data and Information Set',
    description: 'The national quality-measurement system published by NCQA. It is how health plans (like LA Care) are scored and reimbursed on member outcomes.',
  },
  NCQA: {
    full: 'National Committee for Quality Assurance',
    description: 'The non-profit body that defines HEDIS quality measures and accredits health plans in the United States.',
  },
  CDA: {
    full: 'Clinical Document Architecture',
    description: 'An HL7 v3 XML standard for clinical documents. CDA is the format used by EHRs to exchange visit notes, discharge summaries, labs, etc.',
  },
  CCDA: {
    full: 'Consolidated Clinical Document Architecture',
    description: 'A U.S. Meaningful-Use-certified profile of CDA. The CCDA is the document this pipeline ingests — it contains structured sections AND free-text narrative.',
  },
  'C-CDA': {
    full: 'Consolidated Clinical Document Architecture',
    description: 'Same as CCDA — a standardised HL7 XML document that carries both coded data (ICD, LOINC, RxNorm) and narrative clinical notes.',
  },
  HL7: {
    full: 'Health Level Seven International',
    description: 'The standards body that publishes the clinical-exchange specifications used by CDA, CCDA, and FHIR.',
  },
  FHIR: {
    full: 'Fast Healthcare Interoperability Resources',
    description: 'HL7\'s modern JSON/REST-based interoperability standard. The Agentic DM module maps CCDA content to FHIR resources.',
  },
  LOINC: {
    full: 'Logical Observation Identifiers Names and Codes',
    description: 'The vocabulary for lab tests, clinical measurements, and document types. For example HbA1c = LOINC 4548-4.',
  },
  'ICD-10': {
    full: 'International Classification of Diseases, 10th revision',
    description: 'The diagnosis code system. Example: F32.9 = Major depressive disorder, single episode, unspecified.',
  },
  ICD9: {
    full: 'International Classification of Diseases, 9th revision',
    description: 'The legacy U.S. diagnosis code set, retired in 2015 but still present in historical records. The Normalization agent auto-maps ICD-9 to ICD-10.',
  },
  SNOMED: {
    full: 'SNOMED Clinical Terms',
    description: 'The most comprehensive clinical-terminology vocabulary in use today. Used for diagnoses, procedures, findings, and anatomy.',
  },
  RxNorm: {
    full: 'RxNorm',
    description: 'The National Library of Medicine\'s normalised drug vocabulary. Every medication in the CCDA is mapped to an RxNorm concept ID.',
  },
  CPT: {
    full: 'Current Procedural Terminology',
    description: 'Procedure codes maintained by the AMA, used heavily in billing. CPT II codes (e.g. 1111F) are quality-reporting codes used by HEDIS.',
  },
  NPI: {
    full: 'National Provider Identifier',
    description: 'The 10-digit identifier assigned to every U.S. healthcare provider. Used to identify the authoring clinician on a CCDA.',
  },
  NLP: {
    full: 'Natural Language Processing',
    description: 'Extracting structured facts from free-text. The pipeline runs NLP over the CDA narrative sections because not every data point is coded.',
  },
  LLM: {
    full: 'Large Language Model',
    description: 'A general-purpose AI language model. The clinical LLM agent prompts the model with a narrative block and asks for a strict JSON schema of clinical facts.',
  },
  EHR: {
    full: 'Electronic Health Record',
    description: 'The clinical software system the provider documents in (Epic, Cerner, Athena, etc.). CCDAs are the export format out of EHRs.',
  },
  HIE: {
    full: 'Health Information Exchange',
    description: 'A regional hub that aggregates CCDAs from multiple EHRs and forwards them to payers. LA Care receives supplemental data via HIEs.',
  },
  EDI: {
    full: 'Electronic Data Interchange',
    description: 'The X12-based claim / eligibility exchange format (837, 270/271, etc.). Claims data travels over EDI; clinical data travels over CCDA.',
  },
  BH: {
    full: 'Behavioral Health',
    description: 'Mental-health and substance-use care. Relevant for FUM (mental illness) and FUA (substance use) follow-up measures.',
  },
  AOD: {
    full: 'Alcohol and Other Drug',
    description: 'The standard abbreviation used by HEDIS for substance-use conditions. The FUA measure tracks follow-up after an ED visit for AOD abuse/dependence.',
  },
  MH: {
    full: 'Mental Health',
    description: 'Used interchangeably with BH in HEDIS specs. The FUM denominator is members with a primary MH diagnosis on their ED visit.',
  },
  ED: {
    full: 'Emergency Department',
    description: 'Hospital emergency room visits. FUM and FUA both measure follow-up care after an ED visit.',
  },
  IOP: {
    full: 'Intensive Outpatient Program',
    description: 'A structured step-down level of care (typically BH/SUD). IOP visits count as valid numerator events for FUM / FUA.',
  },
  MAT: {
    full: 'Medication-Assisted Treatment',
    description: 'Evidence-based treatment for opioid / alcohol use disorders (buprenorphine, naltrexone, methadone). Valid FUA numerator care.',
  },
  HTN: {
    full: 'Hypertension',
    description: 'High blood pressure. The CBP measure evaluates whether members with HTN have achieved controlled BP (< 140/90 mmHg).',
  },
  BP: {
    full: 'Blood Pressure',
    description: 'Measured systolic/diastolic in mmHg. Lives in the Vital Signs section of the CCDA.',
  },
  DM: {
    full: 'Diabetes Mellitus',
    description: 'Chronic disorder of glucose regulation. The HBD measure evaluates the most-recent HbA1c for members with DM.',
  },
  HbA1c: {
    full: 'Hemoglobin A1c (Glycated Hemoglobin)',
    description: 'A 3-month average of blood glucose. LOINC 4548-4. Values > 9% denote poor control.',
  },
  PHQ9: {
    full: 'Patient Health Questionnaire-9',
    description: 'A standardised 9-question depression severity instrument. Scores of 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe.',
  },
  'PHQ-9': {
    full: 'Patient Health Questionnaire-9',
    description: 'A standardised 9-question depression severity instrument. Scores of 0-4 minimal, 5-9 mild, 10-14 moderate, 15-19 moderately severe, 20-27 severe.',
  },
  FUM: {
    full: 'Follow-Up After ED Visit for Mental Illness',
    description: 'HEDIS measure. See the Sample Library → "What does this mean?" tab for the full numerator / denominator spec.',
  },
  FUA: {
    full: 'Follow-Up After ED Visit for Substance Use',
    description: 'HEDIS measure. Any AOD follow-up visit within 7 / 30 days of an ED visit for alcohol-or-other-drug abuse or dependence.',
  },
  CBP: {
    full: 'Controlling High Blood Pressure',
    description: 'HEDIS measure. Most-recent BP < 140/90 mmHg for members 18–85 with a hypertension diagnosis.',
  },
  HBD: {
    full: 'Hemoglobin A1c Control for Patients with Diabetes',
    description: 'HEDIS measure. Most-recent HbA1c ≤ 9.0% for members 18–75 with diabetes.',
  },
  MRP: {
    full: 'Medication Reconciliation Post-Discharge',
    description: 'HEDIS measure. Documented medication reconciliation within 30 days of an inpatient discharge.',
  },
  CCD: {
    full: 'Continuity of Care Document',
    description: 'A CCDA document type that provides a full longitudinal snapshot of a member (LOINC 34133-9). The gold-standard supplemental-data artifact.',
  },
  PBKDF2: {
    full: 'Password-Based Key Derivation Function 2',
    description: 'The one-way hashing algorithm used to store user passwords in the platform auth table. Keys are never stored or logged in plain text.',
  },
}

/** Friendly label for the synthetic "scenario" column on samples. */
export const SCENARIO_LABEL: Record<string, string> = {
  FUM_CLOSED:       'FUM gap closed (ED → BH follow-up within 7 days)',
  FUM_CLOSED_30:    'FUM gap closed in 30-day window',
  FUA_CLOSED:       'FUA gap closed (ED → AOD follow-up)',
  CBP_CONTROLLED:   'CBP — BP reading controlled (< 140/90)',
  CBP_UNCONTROLLED: 'CBP — BP reading uncontrolled (numerator NOT met)',
  HBD_CONTROLLED:   'HBD — HbA1c ≤ 9.0% (numerator met)',
  HBD_UNCONTROLLED: 'HBD — HbA1c > 9.0% (numerator NOT met)',
  MRP_CLOSED:       'MRP — med reconciliation documented post-discharge',
  NO_EVIDENCE:      'Control sample — no HEDIS evidence present',
}
