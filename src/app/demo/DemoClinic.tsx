import React from "react";
import ScorecardView from "../clinic/ScorecardView";
import type { DemoPatient, DemoSnapshot } from "../../lib/clinic/demo";

const REASONS: Record<string, string> = {
  overdue_a1c: "A1c is overdue",
  overdue_bp: "Blood pressure is overdue",
  uncontrolled_bp: "Blood pressure is over 140 or 90",
  uncontrolled_a1c: "A1c is over 9",
  missed_medication: "Missed medication check-in",
  missed_appointment: "Missed appointment",
  home_out_of_range: "Home reading is out of range",
  no_home_reading_30d: "No home reading in 30 days",
  cancer_followup_open: "Abnormal cancer result, follow-up still open",
  cancer_followup_overdue: "Abnormal cancer result, follow-up overdue",
  wellness_family: "Missed check-in, family step is open",
  wellness_care_team: "Missed check-in escalated to the care team",
  cognitive_due: "Cognitive screen is due",
  caregiver_strain: "Caregiver strain is high",
  falls_risk_cms139: "Falls risk with a cognitive concern",
  cost_barrier: "Cost barrier",
  transport_barrier: "Transport barrier",
  cms165: "CMS165 blood pressure gap",
  hedis_cbp: "HEDIS CBP gap",
  cms122: "CMS122 A1c over 9",
  hedis_gsd: "HEDIS GSD gap",
  cms2: "CMS2 depression screening gap",
  cms159: "CMS159 remission gap",
  gpra_a1c: "IHS GPRA A1c gap",
  gpra_bp: "IHS GPRA blood pressure gap",
  gpra_depression: "IHS GPRA depression screening gap",
  cms130: "CMS130 colorectal screening gap",
  cms125: "CMS125 breast screening gap",
  cms124: "CMS124 cervical screening gap",
  cms139: "CMS139 falls screening gap",
};

const TASK_TAGS = [
  "cancer_followup_open",
  "cancer_followup_overdue",
  "wellness_family",
  "wellness_care_team",
  "cognitive_due",
  "caregiver_strain",
  "falls_risk_cms139",
  "cost_barrier",
  "transport_barrier",
];

function reason(code: string): string {
  return REASONS[code] || code;
}

function clock(value: string | null): string {
  if (!value) return "none";
  if (value.length === 10) return value;
  return `${value.slice(0, 16).replace("T", " ")} UTC`;
}

function readingLine(reading: DemoPatient["readings"][number]): string {
  if (reading.kind === "bp") return `${reading.recorded_on} blood pressure ${reading.systolic}/${reading.diastolic}`;
  return `${reading.recorded_on} glucose ${reading.glucose}`;
}

const JUMPS = [
  ["walkthrough", "Walkthrough"],
  ["worklist", "Worklist"],
  ["alerts", "Alerts"],
  ["readings", "Home readings"],
  ["gaps", "Care gaps"],
  ["scorecard", "Scorecard"],
  ["tracking", "RPM and CCM"],
  ["tasks", "Tasks"],
  ["outreach", "Outreach"],
  ["patients", "All patients"],
] as const;

export default function DemoClinic({ snapshot }: { snapshot: DemoSnapshot }) {
  const byId = new Map(snapshot.patients.map((patient) => [patient.external_id, patient]));
  const story = snapshot.patients.filter((patient) => patient.note);
  const tracked = snapshot.patients.filter((patient) => patient.tracking.reading_days > 0 || patient.minutes > 0);
  const taskRows = snapshot.scorecard.worklist
    .map((item) => ({
      ...item,
      tags: item.measures.filter((code) => TASK_TAGS.includes(code)),
      patient: byId.get(item.external_id) || null,
    }))
    .filter((item) => item.tags.length > 0);

  return (
    <main data-demo="clinic" className="min-h-screen bg-sov-bg text-ink">
      <div id="demo-banner" role="status" className="sticky top-0 z-30 border-b border-[#042f2a]/20 bg-sov-gold px-3 py-2 text-center text-sm font-semibold text-[#042f2a]">
        <p>{snapshot.banner}</p>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-3 py-5 sm:px-4">
        <header>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic demo</p>
          <h1 className="mt-2 text-2xl font-bold break-words sm:text-3xl">{snapshot.clinic_name}</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Provider view of a fictional rural FQHC. No sign-in. This page does not read or write a live clinic record.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{snapshot.sample_day_label}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">
            The scorecard shows an estimated rate, the gap to the clinic target, and the patients who would close that gap. Built-in targets are examples. P4P and RPM dollar amounts are examples, not a cited fee schedule, and 99470 is unconfirmed. CCM and APCM time is tracked only, with no dollar estimate. Nothing here is a validated measure or a claim.
          </p>
          <p className="mt-3 text-sm">
            Viewing as {snapshot.staff[0]?.name}, {snapshot.staff[0]?.role}. Phone {snapshot.staff[0]?.phone}.
          </p>
          <ul className="mt-2 text-sm text-ink-soft">
            {snapshot.staff.slice(1).map((person) => (
              <li key={person.role}>{person.name}, {person.role}, {person.phone}</li>
            ))}
          </ul>
        </header>

        <section aria-labelledby="demo-actions-title" className="rounded-2xl border border-sov-border bg-sov-card/70 p-3">
          <h2 id="demo-actions-title" className="text-lg font-semibold">Actions stay off</h2>
          <p id="demo-disabled" className="mt-2 text-sm leading-relaxed">{snapshot.disabled_message}</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {["Text the care team", "Send a wellness check", "Email the caregiver", "Ask the model"].map((label) => (
              <button key={label} type="button" disabled aria-describedby="demo-disabled" className="btn-secondary min-h-11 w-full sm:w-auto">
                {label}
              </button>
            ))}
          </div>
        </section>

        <nav aria-label="Demo sections" className="flex flex-wrap gap-2">
          {JUMPS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="inline-flex min-h-11 items-center rounded-full border border-sov-border px-3 text-sm no-underline text-ink">
              {label}
            </a>
          ))}
        </nav>

        <section id="walkthrough" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Walkthrough records</h2>
          <p className="mt-2 text-sm text-ink-soft">Open a record to see home readings, check-ins, and the task detail. These nine are the sales path. The full panel is below.</p>
          <div className="mt-3 flex flex-col gap-3">
            {story.map((patient) => (
              <PatientCard key={patient.external_id} patient={patient} anchor />
            ))}
          </div>
        </section>

        <section id="worklist" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Provider worklist</h2>
          <p className="mt-2 text-sm text-ink-soft">Ranked by the clinic worklist rules for {snapshot.worklist.as_of}. {snapshot.worklist.items.length} patients have a reason.</p>
          <ol className="mt-3 flex flex-col gap-2">
            {snapshot.worklist.items.map((item) => {
              const patient = byId.get(item.external_id);
              return (
                <li key={item.external_id} className="rounded-xl border border-sov-border p-3 text-sm">
                  <a href={`#${item.external_id}`} className="font-semibold break-words">
                    {item.rank}. {patient?.name || item.external_id} ({item.external_id})
                  </a>
                  <p className="mt-1 break-words">{item.reasons.map(reason).join(". ")}.</p>
                  <p className="text-ink-soft">BP {item.bp || "none"}. A1c {item.a1c ?? "none"}. Last outreach {item.last_outcome || "none"}.</p>
                </li>
              );
            })}
          </ol>
        </section>

        <section id="alerts" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Home reading alerts</h2>
          <p className="mt-2 text-sm text-ink-soft">{snapshot.alerts.length} alerts from the clinic blood pressure and glucose lines. The latest two per patient are kept in this sample.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {snapshot.alerts.map((alert) => (
              <li key={`${alert.external_id}-${alert.metric}-${alert.created_on}-${alert.value_text}`} className="rounded-xl border border-sov-border p-3 text-sm break-words">
                <a href={`#${alert.external_id}`} className="font-semibold">{alert.name}</a>
                <span> ({alert.external_id})</span>
                <p>{alert.created_on}: {alert.metric} {alert.value_text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="readings" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Home readings</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Blood pressure and glucose readings sit on the patient record. Day counts below use every reading date in {snapshot.month}, not only the lines shown here.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {story.filter((patient) => patient.readings.length > 0).map((patient) => (
              <article key={patient.external_id} className="rounded-xl border border-sov-border p-3 text-sm">
                <h3 className="font-semibold break-words">
                  <a href={`#${patient.external_id}`}>{patient.name}</a> ({patient.external_id})
                </h3>
                <p>{patient.tracking.reading_days} reading days in {patient.tracking.month}. Reference line {patient.tracking.reading_day_reference} days.</p>
                <ul className="mt-2">
                  {patient.readings.slice(-8).map((reading, index) => (
                    <li key={`${reading.kind}-${reading.recorded_on}-${index}`}>{readingLine(reading)}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section id="gaps" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Care gaps before a visit</h2>
          <p className="mt-2 text-sm text-ink-soft">Visits in the pre-visit window around {snapshot.gaps.as_of}.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {snapshot.gaps.items.map((item) => {
              const patient = byId.get(item.external_id);
              return (
                <li key={item.external_id} className="rounded-xl border border-sov-border p-3 text-sm break-words">
                  <a href={`#${item.external_id}`} className="font-semibold">{patient?.name || item.external_id}</a>
                  <span> ({item.external_id})</span>
                  <p>Next visit {item.next_visit_date || "none"}.</p>
                  <p>{item.gaps.length > 0 ? item.gaps.map(reason).join(". ") + "." : "No gap flags on this record."}</p>
                </li>
              );
            })}
          </ul>
          {snapshot.gaps.items.length === 0 && <p className="mt-2 text-sm text-ink-soft">No visits in the window.</p>}
        </section>

        <section id="scorecard" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Scorecard</h2>
          <p className="mt-2 text-sm text-ink-soft">CMS165, CMS122, CMS2, CMS159, CMS130, CMS125, CMS124, and CMS139 are in this list with the other estimates. Numbers come from the clinic scorecard function.</p>
          <div className="mt-3">
            <ScorecardView card={snapshot.scorecard as unknown as Record<string, unknown>} />
          </div>
        </section>

        <section id="tracking" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">RPM days and CCM minutes</h2>
          <p className="mt-2 text-sm break-words text-ink-soft">{snapshot.scorecard.care_management.label}</p>
          <p className="mt-2 text-sm">Example RPM total ${snapshot.scorecard.care_management.rpm_dollars} for {snapshot.scorecard.care_management.month}.</p>
          <div className="mt-3 flex flex-col gap-2">
            {snapshot.scorecard.care_management.rpm.map((line) => (
              <article key={line.code} className="rounded-xl border border-sov-border p-3 text-sm">
                <h3 className="font-semibold">{line.code}</h3>
                <p>{line.units} units. Example ${line.dollars_each} each, ${line.dollars} together.</p>
                <p className="break-words text-ink-soft">{line.rule}</p>
              </article>
            ))}
          </div>
          <article className="mt-3 rounded-xl border border-sov-border p-3 text-sm">
            <h3 className="font-semibold">CCM and APCM minutes</h3>
            <p>{snapshot.scorecard.care_management.ccm_apcm.minutes} minutes logged. {snapshot.scorecard.care_management.ccm_apcm.patients_at_20} patients at 20 minutes.</p>
            <p className="break-words text-ink-soft">{snapshot.scorecard.care_management.ccm_apcm.label}</p>
          </article>
          <details className="mt-3 rounded-xl border border-sov-border p-3">
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">Reading days and care minutes by patient ({tracked.length})</summary>
            <ul className="mt-2 text-sm">
              {tracked.map((patient) => (
                <li key={patient.external_id} className="mt-1 break-words">
                  <a href={`#${patient.external_id}`}>{patient.name}</a> ({patient.external_id}): {patient.tracking.reading_days} reading days, {patient.tracking.minutes} care minutes. {patient.tracking.label}
                </li>
              ))}
            </ul>
          </details>
        </section>

        <section id="tasks" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Follow-up tasks</h2>
          <p className="mt-2 text-sm text-ink-soft">Cancer abnormal results, missed live-alone check-ins, cognitive screens, caregiver strain, and related flags from the scorecard.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {taskRows.map((item) => (
              <li key={item.external_id} className="rounded-xl border border-sov-border p-3 text-sm break-words">
                <a href={`#${item.external_id}`} className="font-semibold">{item.patient?.name || item.external_id}</a>
                <span> ({item.external_id})</span>
                <p className="mt-1">{item.tags.map(reason).join(". ")}.</p>
                {item.patient?.wellness_label && <p className="mt-1">{item.patient.wellness_label}</p>}
                {item.patient?.cancer.filter((event) => event.state !== "closed").map((event) => (
                  <p key={`${event.kind}-${event.screened_on}`} className="mt-1">
                    {event.kind} {event.method} result {event.result} on {event.screened_on}. Follow-up {event.state}. {event.follow_up_on ? `Closed ${event.follow_up_on}.` : "No follow-up date."}
                  </p>
                ))}
                {item.patient?.cognitive_due && <p className="mt-1">No cognitive screen in the last year.</p>}
                {item.patient && item.patient.strain_score != null && item.patient.strain_score >= 7 && (
                  <p className="mt-1">Caregiver strain score {item.patient.strain_score}.{item.patient.caregiver ? ` Caregiver ${item.patient.caregiver}.` : ""}</p>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section id="outreach" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">Outreach log</h2>
          <p className="mt-2 text-sm text-ink-soft">{snapshot.outreach.length} sample outreach rows. Nothing here places a call or sends a message.</p>
          <ul className="mt-3 flex flex-col gap-2">
            {snapshot.outreach.map((item, index) => (
              <li key={`${item.external_id}-${item.created_on}-${item.outcome}-${index}`} className="rounded-xl border border-sov-border p-3 text-sm break-words">
                <a href={`#${item.external_id}`} className="font-semibold">{item.name}</a>
                <span> ({item.external_id})</span>
                <p>{item.created_on}: {item.staff_role} marked {item.outcome.replace(/_/g, " ")}.</p>
              </li>
            ))}
          </ul>
        </section>

        <section id="patients" className="scroll-mt-16">
          <h2 className="text-xl font-semibold">All fictional patients ({snapshot.patient_count})</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {snapshot.patients.map((patient) => (
              <li key={patient.external_id}>
                {patient.note ? (
                  <a href={`#${patient.external_id}`} className="text-sm break-words">
                    {patient.name}, {patient.external_id}, age {patient.age ?? "unknown"}{patient.conditions.length > 0 ? `, ${patient.conditions.join(", ")}` : ""}{patient.lives_alone ? ", lives alone" : ""}
                  </a>
                ) : (
                  <PatientCard patient={patient} anchor />
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

function PatientCard({ patient, anchor }: { patient: DemoPatient; anchor: boolean }) {
  return (
    <details id={anchor ? patient.external_id : undefined} open={patient.external_id === "SYN-1001"} className="scroll-mt-16 rounded-xl border border-sov-border p-3">
      <summary className="min-h-11 cursor-pointer text-sm break-words">
        <span className="font-semibold">{patient.name}</span>
        <span className="ml-2 font-mono text-xs">{patient.external_id}</span>
        <span className="mt-1 block text-ink-soft">
          Age {patient.age ?? "unknown"}. {patient.sex || "sex not recorded"}. {patient.phone}.
          {patient.conditions.length > 0 ? ` ${patient.conditions.join(", ")}.` : " No chronic condition flag."}
          {patient.lives_alone ? " Lives alone." : ""}
        </span>
        {patient.note && <span className="mt-1 block">{patient.note}</span>}
      </summary>
      <div className="mt-3 flex flex-col gap-2 text-sm">
        <p>RPM days {patient.tracking.reading_days} of {patient.tracking.reading_day_reference}. CCM minutes {patient.tracking.minutes} of {patient.tracking.minutes_reference}. {patient.tracking.label}</p>
        {patient.family_phone && <p>Family phone {patient.family_phone}.</p>}
        {patient.caregiver && <p>Caregiver on the circle: {patient.caregiver}.</p>}
        {patient.wellness_label && (
          <p>
            {patient.wellness_label} Last OK {clock(patient.wellness_last_ok)}. Family notified {clock(patient.wellness_family_notified_at)}. Care team notified {clock(patient.wellness_team_notified_at)}.
          </p>
        )}
        {patient.cost_barrier && <p>Cost barrier is marked.</p>}
        {patient.transport_barrier && <p>Transport barrier is marked.</p>}
        {patient.next_visit_date && <p>Next visit {patient.next_visit_date}.</p>}
        {patient.checkins.length > 0 && (
          <ul>
            {patient.checkins.map((item) => (
              <li key={`${item.kind}-${item.occurred_on}`}>{item.occurred_on}: {item.status} {item.kind} check-in.</li>
            ))}
          </ul>
        )}
        {patient.cancer.map((event) => (
          <p key={`${event.kind}-${event.method}-${event.screened_on}`}>
            {event.kind} {event.method} on {event.screened_on}, result {event.result}, follow-up {event.state}.
          </p>
        ))}
        {patient.cognitive_due && <p>Cognitive screen is due. No score in the last year.</p>}
        {patient.cognitive.map((item) => (
          <p key={item.recorded_on}>Cognitive score {item.score} on {item.recorded_on}.</p>
        ))}
        {patient.falls.map((item) => (
          <p key={item.recorded_on}>Falls screen on {item.recorded_on}. At risk: {item.at_risk ? "yes" : "no"}.</p>
        ))}
        {patient.strain.map((item) => (
          <p key={item.recorded_on}>Caregiver strain score {item.score} on {item.recorded_on}.</p>
        ))}
        {patient.concerns.map((item) => (
          <p key={item.created_on}>Concern from {item.author_role} on {item.created_on}: {item.body}</p>
        ))}
        {patient.alerts.length > 0 && (
          <ul>
            {patient.alerts.map((alert) => (
              <li key={`${alert.metric}-${alert.created_on}`}>Alert {alert.created_on}: {alert.metric} {alert.value_text}.</li>
            ))}
          </ul>
        )}
        {patient.readings.length > 0 && (
          <details>
            <summary className="min-h-11 cursor-pointer">Home readings ({patient.readings.length})</summary>
            <ul>
              {patient.readings.slice(-12).map((reading, index) => (
                <li key={`${reading.kind}-${reading.recorded_on}-${index}`}>{readingLine(reading)}</li>
              ))}
            </ul>
          </details>
        )}
        {patient.outreach.length > 0 && (
          <ul>
            {patient.outreach.map((item) => (
              <li key={`${item.created_on}-${item.outcome}`}>{item.created_on}: {item.staff_role} marked {item.outcome.replace(/_/g, " ")}.</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
