import { useEffect, useState } from 'react'
import { MEASURE_GLOSSARY, ACRONYMS } from './glossary'
import { Acronym } from './HelpTip'

/**
 * Full-screen 5-page tutorial that introduces the LA Care module to a
 * non-technical client. Opens from the header "Tutorial" button, and
 * auto-opens once on a new browser (remembered via localStorage).
 */
interface Props {
  open: boolean
  onClose: () => void
}

type StepKey = 'why' | 'format' | 'agents' | 'measures' | 'walkthrough'

const STEPS: { key: StepKey; title: string; subtitle: string }[] = [
  { key: 'why',         title: 'Why this matters', subtitle: 'Claims miss up to 40% of HEDIS gap-closures. CCDA closes that gap.' },
  { key: 'format',      title: 'What a CCDA is', subtitle: 'HL7 XML with structured data AND free-text narrative blocks.' },
  { key: 'agents',      title: 'The six agents', subtitle: 'How the pipeline turns XML into dashboard-ready evidence.' },
  { key: 'measures',    title: 'HEDIS measures', subtitle: 'The five quality measures this system evaluates.' },
  { key: 'walkthrough', title: 'Your first run',  subtitle: '3-click path: pick a sample → preview → run.' },
]

export default function TutorialModal({ open, onClose }: Props) {
  const [step, setStep] = useState<StepKey>('why')

  useEffect(() => {
    if (!open) return
    setStep('why')
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [open, onClose])

  if (!open) return null
  const idx = STEPS.findIndex(s => s.key === step)
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)].key)
  const prev = () => setStep(STEPS[Math.max(idx - 1, 0)].key)

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="w-full max-w-5xl max-h-[92vh] rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-rose-50 via-white to-rose-50">
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-rose-600">LA Care · Agentic CCDA · Product Tour</div>
            <h2 className="text-lg font-semibold text-slate-900 mt-0.5">{STEPS[idx].title}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{STEPS[idx].subtitle}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-2xl leading-none px-2">×</button>
        </div>

        {/* Step indicator */}
        <div className="px-6 py-2.5 border-b border-slate-100 flex items-center gap-1 bg-white">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              onClick={() => setStep(s.key)}
              className={`flex-1 h-1.5 rounded-full transition-colors ${
                i === idx ? 'bg-rose-600' : i < idx ? 'bg-rose-300' : 'bg-slate-200'
              }`}
              title={s.title}
            />
          ))}
          <span className="text-[10px] font-mono text-slate-400 w-12 text-right">{idx + 1}/{STEPS.length}</span>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-8 text-[13px] leading-relaxed text-slate-700">
          {step === 'why' && <WhyStep />}
          {step === 'format' && <FormatStep />}
          {step === 'agents' && <AgentsStep />}
          {step === 'measures' && <MeasuresStep />}
          {step === 'walkthrough' && <WalkthroughStep onClose={onClose} />}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Press <kbd className="px-1.5 py-0.5 rounded border border-slate-300 bg-white font-mono text-[10px]">Esc</kbd> to close. You can re-open this anytime from the "Tutorial" button in the header.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={prev}
              disabled={idx === 0}
              className="px-3 py-1.5 rounded-md border border-slate-200 text-xs font-medium text-slate-600 hover:bg-white disabled:opacity-40"
            >
              ← Back
            </button>
            {idx < STEPS.length - 1 ? (
              <button
                onClick={next}
                className="px-4 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
              >
                Next →
              </button>
            ) : (
              <button
                onClick={onClose}
                className="px-4 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold hover:bg-rose-500"
              >
                Got it — start using the app
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Individual tutorial pages
// ------------------------------------------------------------------ //

function WhyStep() {
  return (
    <div className="grid md:grid-cols-2 gap-6 items-start">
      <div className="space-y-4">
        <h3 className="text-base font-semibold text-slate-900">The HEDIS supplemental-data gap</h3>
        <p>
          Health plans like <strong>LA Care</strong> earn quality-bonus revenue when their
          members meet <Acronym>HEDIS</Acronym> quality measures — controlled blood pressure,
          diabetes in check, mental-health follow-up after an <Acronym>ED</Acronym> visit, and so on.
        </p>
        <p>
          But <Acronym>EDI</Acronym>-based claims miss a lot of real clinical activity. An
          outpatient behavioural-health visit may show up as a <em>generic office-visit</em> claim
          with no mental-health diagnosis. A blood-pressure reading of <strong>128/82</strong>
          never makes it onto a claim at all. A medication reconciliation after discharge is
          rarely billed.
        </p>
        <p>
          The result: plans lose 10–40% of their potential gap-closures, which translates
          directly to stars-rating losses worth millions per quality measure per year.
        </p>
      </div>
      <div className="rounded-2xl bg-rose-50 border border-rose-100 p-5 text-[12px] space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-widest text-rose-700">The CCDA advantage</div>
        <p className="text-slate-800">
          The <Acronym>CCDA</Acronym> document coming out of the provider's <Acronym>EHR</Acronym>
          contains the <strong>actual clinical record</strong>:
        </p>
        <ul className="list-disc ml-5 space-y-1 text-slate-700">
          <li>Structured problems coded in <Acronym>ICD-10</Acronym> and <Acronym>SNOMED</Acronym>.</li>
          <li>Medications coded in <Acronym>RxNorm</Acronym>, labs in <Acronym>LOINC</Acronym>.</li>
          <li>Vital signs (<Acronym>BP</Acronym>, BMI, weight, heart rate).</li>
          <li>Free-text narrative clinicians actually write — the part NLP unlocks.</li>
        </ul>
        <p className="text-slate-800">
          This pipeline ingests those CCDAs and runs six autonomous agents to surface
          every HEDIS-valid piece of evidence — closing gaps that claims alone miss.
        </p>
      </div>
    </div>
  )
}

function FormatStep() {
  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-slate-900">
        What a <Acronym>CCDA</Acronym> document looks like
      </h3>
      <p>
        A CCDA is an <Acronym>HL7</Acronym> v3 XML document that wraps both
        coded clinical data (in entries) and free-text narrative (inside a
        <code className="px-1 rounded bg-slate-100 font-mono text-[11px]"> &lt;text&gt;</code> block).
        Every document declares its type via a <Acronym>LOINC</Acronym> code
        (Progress Note = 11506-3, Discharge Summary = 18842-5, etc.) and
        contains templated sections for Problems, Medications, Results,
        Vital Signs, Encounters, and so on.
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="rounded-lg bg-slate-950 text-slate-300 p-3 font-mono text-[10px] leading-relaxed overflow-auto max-h-56">
          <div className="text-slate-500 mb-1">// Every problem entry carries a code</div>
          <pre>{`<act classCode="ACT" moodCode="EVN">
  <code code="CONC" codeSystem="2.16.840.1.113883.5.6"/>
  <statusCode code="active"/>
  <entryRelationship>
    <observation classCode="OBS" moodCode="EVN">
      <code code="64572001"
            codeSystem="2.16.840.1.113883.6.96"
            displayName="Condition"/>
      <value xsi:type="CD"
             code="F32.9"
             codeSystem="2.16.840.1.113883.6.90"
             displayName="Major depressive
             disorder, unspecified"/>
    </observation>
  </entryRelationship>
</act>`}</pre>
        </div>
        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[12px]">
          <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Same fact, once extracted</div>
          <div className="space-y-1">
            <Row k="Section" v="Problems" />
            <Row k="Display" v="Major depressive disorder, unspecified" />
            <Row k="ICD-10" v="F32.9" />
            <Row k="SNOMED" v="64572001" />
            <Row k="Status" v="Active" />
          </div>
          <div className="mt-3 text-[11px] text-slate-500">
            The Extraction agent parses the raw XML; the Normalization agent
            aligns legacy codes (e.g. <Acronym>ICD9</Acronym> → <Acronym>ICD-10</Acronym>).
          </div>
        </div>
      </div>

      <div className="px-4 py-3 rounded-lg bg-violet-50 border border-violet-100 text-[12px]">
        <div className="text-[10px] font-bold uppercase tracking-widest text-violet-700 mb-1">Why NLP matters</div>
        Not every clinical fact is coded. A progress-note narrative like
        <em className="text-slate-800"> "BH follow-up 4d after ED visit for acute depression"</em>
        contains dates and a <Acronym>BH</Acronym> follow-up — critical for <Acronym>FUM</Acronym> — that a code-only
        parser misses entirely. That is what the <Acronym>LLM</Acronym>-backed NLP agent solves.
      </div>
    </div>
  )
}

function AgentsStep() {
  const agents = [
    { n: 1, name: 'Ingest',        tag: 'Discovery',     purpose: 'Validates CCDA XML, stores raw_xml in Postgres, and queues every document for the downstream agents. Handles malformed sections and missing parts without crashing.' },
    { n: 2, name: 'Extraction',    tag: 'Parser',        purpose: 'Parses the urn:hl7-org:v3 XML tree. Pulls LOINC-coded sections (Problems / Meds / Labs / Vitals / Encounters) into structured rows.' },
    { n: 3, name: 'Normalization', tag: 'Value-sets',    purpose: 'Maps ICD-9 → ICD-10, local → SNOMED, local → LOINC, proprietary → RxNorm. Aligns everything with the NCQA HEDIS value sets.' },
    { n: 4, name: 'Narrative NLP', tag: 'Clinical LLM',  purpose: 'Sends free-text narrative blocks to the clinical LLM with a strict JSON schema, and stitches the extracted facts back onto the member record.' },
    { n: 5, name: 'HEDIS',         tag: 'Rules engine',  purpose: 'Runs the 5 supported measures (FUM / FUA / CBP / HBD / MRP) against the normalised + NLP-enriched data, emitting satisfied "hits" with confidence and evidence trails.' },
    { n: 6, name: 'Dashboard',     tag: 'Rollup',        purpose: 'Aggregates every hit into the run dashboard — by measure, by doc type, by confidence — and estimates quality-bonus revenue recovery.' },
  ]
  return (
    <div className="space-y-3">
      <p className="text-[12px] text-slate-600">
        Every run executes these six agents in order. The output of each one
        is written to the database <em>and</em> to the per-document step
        timeline (visible on the Documents tab → click any row).
      </p>
      {agents.map((a) => (
        <div key={a.n} className="flex items-start gap-4 px-4 py-3 rounded-xl border border-slate-200 bg-white hover:border-rose-200 transition-colors">
          <div className="shrink-0 h-9 w-9 rounded-full bg-rose-600 text-white flex items-center justify-center font-bold">{a.n}</div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="font-semibold text-slate-900">{a.name}</div>
              <span className="text-[9px] font-bold tracking-widest uppercase text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">{a.tag}</span>
            </div>
            <p className="text-[12px] text-slate-600 mt-0.5">{a.purpose}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

function MeasuresStep() {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      {Object.values(MEASURE_GLOSSARY).map((m) => (
        <div key={m.code} className="rounded-xl border border-slate-200 bg-white p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-rose-600 text-white text-[11px] font-bold">{m.code}</span>
            <span className="text-sm font-semibold text-slate-900">{m.name}</span>
          </div>
          <p className="text-[12px] text-slate-700 leading-snug">{m.long}</p>
          <div className="pt-1 text-[11px] space-y-0.5">
            <div><span className="text-slate-500 font-semibold">Numerator:</span> <span className="text-slate-700">{m.numerator}</span></div>
            <div><span className="text-slate-500 font-semibold">Denominator:</span> <span className="text-slate-700">{m.denominator}</span></div>
            <div><span className="text-slate-500 font-semibold">Window:</span> <span className="text-slate-700">{m.window}</span></div>
            <div className="pt-1 text-slate-500 italic">{m.whyCcda}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function WalkthroughStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-5">
      <h3 className="text-base font-semibold text-slate-900">3-click walkthrough</h3>
      <ol className="space-y-4">
        <Step n={1} title="Open the Sample Library">
          Click the <strong>Sample Library</strong> tab. You'll see 30 curated C-CDA
          documents already in the database (10 HEDIS scenarios × 3 variants each).
          Chip-filter by scenario or search by member name.
        </Step>
        <Step n={2} title="Preview a sample">
          Click any card. The right pane has three tabs — <strong>Structured preview</strong>,
          <strong> Raw C-CDA XML</strong>, and <strong>What does this mean?</strong> — so you
          can see exactly what the pipeline will consume. Tick the checkbox on one or
          more cards, then press <strong>Run pipeline →</strong>.
        </Step>
        <Step n={3} title="Watch the agents work">
          The sticky red status-bar at the top shows live stage / progress / elapsed
          time and has a <strong>Cancel run</strong> button. Jump to the
          <strong> Documents</strong> tab → click any row → the right pane shows the
          full agent trail for that document, including <em>every narrative block sent
          to the clinical LLM</em> and the JSON that came back.
        </Step>
        <Step n={4} title="See the business outcome">
          Open the <strong>HEDIS Evidence</strong> tab — every satisfied measure is a
          gap-closure that claims data alone did not detect. The <strong>Overview</strong>
          tab rolls up the revenue impact and measure mix.
        </Step>
      </ol>
      <div className="px-4 py-3 rounded-xl bg-emerald-50 border border-emerald-100">
        <div className="text-[11px] font-bold uppercase tracking-widest text-emerald-700 mb-0.5">Tip for the client demo</div>
        <p className="text-[12px] text-slate-700">
          The <em>Raw CDA vs Extracted Data</em> tab is the money shot. Left side:
          intimidating XML the clinical staff never reads. Right side: clean
          structured facts. Click through each scenario to show the range of
          coverage.
        </p>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-500"
        >
          Take me to the app
        </button>
      </div>
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: any }) {
  return (
    <li className="flex gap-4">
      <div className="shrink-0 h-8 w-8 rounded-full bg-slate-900 text-white flex items-center justify-center font-bold text-sm">{n}</div>
      <div>
        <div className="font-semibold text-slate-900">{title}</div>
        <p className="text-[12px] text-slate-600 leading-relaxed">{children}</p>
      </div>
    </li>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-800 font-medium">{v}</span>
    </div>
  )
}

// ------------------------------------------------------------------ //
// Auto-open the tutorial for first-time visitors
// ------------------------------------------------------------------ //

const FIRST_RUN_KEY = 'lacare.tutorial.seen.v1'

export function useFirstRunTutorial(): [boolean, (v: boolean) => void] {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      const seen = window.localStorage.getItem(FIRST_RUN_KEY)
      if (!seen) setOpen(true)
    } catch {
      // localStorage may be blocked (private mode) — just skip
    }
  }, [])
  const setOpenAndRemember = (v: boolean) => {
    setOpen(v)
    if (!v) {
      try { window.localStorage.setItem(FIRST_RUN_KEY, String(Date.now())) } catch { /* ignore */ }
    }
  }
  return [open, setOpenAndRemember]
}

// Silence "declared but never read" on the full-acronym dict we may want later.
void ACRONYMS
