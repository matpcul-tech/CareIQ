/**
 * Sales demo clinic. In-memory sample rows only.
 * Do not import the hosted clinic database client. Do not send SMS, email, or a model call.
 */

import {
  clinicGaps,
  clinicMeasures,
  clinicScorecard,
  clinicTracking,
  clinicWorklist,
} from "./actions";
import type { Actor } from "./logic";
import { daysBetween, DEFAULT_THRESHOLDS, readingOutOfRange } from "./logic";
import { buildScorecard } from "./scorecard";
import {
  cognitiveDue,
  DEFAULT_CARE_SETTINGS,
  followUpState,
  latestStrain,
  wellnessDecision,
  type CancerEvent,
} from "./safety";
import { MemoryClinicStore, type PatientRecord } from "./store";

export const DEMO_BANNER = "Demo clinic. All patients and data are fictional.";
export const DEMO_CLINIC_NAME = "Demo Rural Health Center (Sample Data)";
export const DEMO_AS_OF = "2026-10-31";
export const DEMO_NOW = "2026-10-31T12:00:00Z";
export const DEMO_MONTH = "2026-10";
export const DEMO_DISABLED_MESSAGE =
  "Disabled in demo. No SMS, email, or AI call is sent, and no clinic record is written.";

const STORY_IDS = [
  "SYN-1001",
  "SYN-1002",
  "SYN-1003",
  "SYN-1004",
  "SYN-1005",
  "SYN-1006",
  "SYN-1007",
  "SYN-1008",
  "SYN-1009",
] as const;

export const DEMO_STORY_IDS = STORY_IDS;

type RpmKind = "full" | "partial" | "new" | "none";
type Sex = "female" | "male";
type OutreachOutcome = "contacted" | "scheduled" | "closed" | "no_answer" | "declined";

interface ScreenDraft {
  instrument: "phq2" | "phq9";
  score: number;
  followUp: boolean;
  on: string;
}

interface CancerDraft {
  kind: "colorectal" | "breast" | "cervical";
  method: string;
  result: "normal" | "abnormal";
  on: string;
  followUpOn: string | null;
}

interface Draft {
  n: number;
  name: string;
  age: number;
  sex: Sex;
  htn: boolean;
  dm: boolean;
  sys: number | null;
  dia: number | null;
  bpOn: string | null;
  a1c: number | null;
  a1cOn: string | null;
  screens: ScreenDraft[];
  cancer: CancerDraft[];
  cognitive: Array<{ score: number; on: string }>;
  falls: Array<{ atRisk: boolean; on: string }>;
  strain: Array<{ score: number; on: string }>;
  livesAlone: boolean;
  wellness: "none" | "ok" | "escalated";
  caregiver: string | null;
  missedMed: boolean;
  missedAppt: boolean;
  completedMed: boolean;
  cost: boolean;
  transport: boolean;
  nextVisitOn: string | null;
  rpm: RpmKind;
  minutes: number;
  outreach: OutreachOutcome[];
  concern: string | null;
  note: string | null;
  glucoseAlert: boolean;
}

export interface DemoReading {
  kind: "bp" | "glucose";
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
  recorded_on: string;
}

export interface DemoPatient {
  external_id: string;
  name: string;
  phone: string;
  family_phone: string | null;
  caregiver: string | null;
  age: number | null;
  sex: Sex | null;
  has_diabetes: boolean;
  has_hypertension: boolean;
  conditions: string[];
  lives_alone: boolean;
  note: string | null;
  next_visit_date: string | null;
  missed_medication: boolean;
  missed_appointment: boolean;
  cost_barrier: boolean;
  transport_barrier: boolean;
  wellness_label: string | null;
  wellness_last_ok: string | null;
  wellness_family_notified_at: string | null;
  wellness_team_notified_at: string | null;
  cancer: Array<{
    kind: string;
    method: string;
    result: string;
    screened_on: string;
    follow_up_on: string | null;
    state: "closed" | "open" | "overdue";
  }>;
  cognitive: Array<{ score: number; recorded_on: string }>;
  cognitive_due: boolean;
  falls: Array<{ at_risk: boolean; recorded_on: string }>;
  strain: Array<{ score: number; recorded_on: string }>;
  strain_score: number | null;
  alerts: Array<{ metric: string; value_text: string; created_on: string }>;
  readings: DemoReading[];
  tracking: {
    month: string;
    reading_days: number;
    reading_day_reference: number;
    minutes: number;
    minutes_reference: number;
    label: string;
  };
  outreach: Array<{ staff_role: string; outcome: string; created_on: string }>;
  checkins: Array<{ kind: string; status: string; occurred_on: string }>;
  concerns: Array<{ author_role: string; body: string; created_on: string }>;
  minutes: number;
}

export interface DemoSnapshot {
  banner: string;
  clinic_name: string;
  as_of: string;
  month: string;
  sample_day_label: string;
  disabled_message: string;
  patient_count: number;
  staff: Array<{ role: string; name: string; phone: string }>;
  patients: DemoPatient[];
  worklist: {
    items: Array<{
      external_id: string;
      rank: number;
      reasons: string[];
      a1c: number | null;
      bp: string | null;
      days_overdue: number;
      last_outcome: string | null;
    }>;
    as_of: string;
  };
  gaps: {
    items: Array<{ external_id: string; next_visit_date: string | null; gaps: string[] }>;
    as_of: string;
  };
  measures: {
    cms165: { numerator: number; denominator: number; rate: number | null; label: string };
    cms122: { numerator: number; denominator: number; rate: number | null; label: string };
    excluded_missing_age: number;
    label: string;
  };
  scorecard: ReturnType<typeof buildScorecard>;
  alerts: Array<{ external_id: string; name: string; metric: string; value_text: string; created_on: string }>;
  outreach: Array<{ external_id: string; name: string; staff_role: string; outcome: string; created_on: string }>;
}

const STAFF = [
  { role: "provider" as const, name: "Fictional Dr. Sample Quinn", phone: "555-010-0190" },
  { role: "ma" as const, name: "Fictional MA Robin Sample", phone: "555-010-0191" },
  { role: "chw" as const, name: "Fictional CHW Jordan Sample", phone: "555-010-0192" },
];

const BULK_AGES = [
  8, 14, 27, 34, 41, 46, 53, 58, 63, 68,
  72, 76, 81, 84, 19, 23, 38, 49, 55, 61,
  66, 70, 74, 79, 32, 44, 51, 57, 64, 69,
  73, 82, 29, 36, 47, 60, 65, 77, 56,
];

const BULK_NAMES = [
  "Jo Marsh", "Kit Owen", "Lee Park", "Mo Quinn", "Nia Reed", "Ollie Snow", "Pat True", "Quinn Vale", "Remy Wood", "Sam York",
  "Tess Ash", "Uma Birch", "Val Clay", "Wes Dunn", "Xan Elm", "Yael Frost", "Zed Glen", "Ari Holt", "Bea Isle", "Cal Joss",
  "Dia Kell", "Edd Low", "Faye Moss", "Gil Nash", "Hana Orr", "Ian Pike", "Joss Rue", "Kai Salt", "Lux Tarn", "Ned Upton",
  "Ora Voss", "Pip Webb", "Rae Yarrow", "Sol Ashby", "Tia Brant", "Una Croft", "Vic Dale", "Wynn Edge", "Yuri Fenn",
];

function addDays(iso: string, days: number): string {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function ago(days: number): string {
  return addDays(DEMO_AS_OF, -days);
}

function ahead(days: number): string {
  return addDays(DEMO_AS_OF, days);
}

export function demoExternalId(n: number): string {
  return `SYN-${1000 + n}`;
}

export function demoPhone(n: number): string {
  return `555-010-${1000 + n}`;
}

function controlledBp(i: number): { sys: number; dia: number } {
  return { sys: 118 + (i % 6) * 2, dia: 72 + (i % 4) };
}

function uncontrolledBp(i: number): { sys: number; dia: number } {
  return { sys: 146 + (i % 5) * 3, dia: 92 + (i % 3) };
}

function rpmDates(kind: RpmKind): string[] {
  if (kind === "none") return [];
  if (kind === "new") {
    const dates: string[] = [];
    for (let n = 0; n <= 17; n += 1) dates.push(ago(n));
    return dates.sort();
  }
  if (kind === "partial") return [1, 5, 9, 13, 17, 21, 25, 29, 45].map(ago).sort();
  const dates: string[] = [];
  for (let n = 0; n <= 30; n += 2) dates.push(ago(n));
  for (const n of [34, 40, 48, 56]) dates.push(ago(n));
  return dates.sort();
}

function emptyExtras(): Pick<Draft, "cognitive" | "falls" | "strain" | "screens" | "cancer" | "outreach"> {
  return { cognitive: [], falls: [], strain: [], screens: [], cancer: [], outreach: [] };
}

function storyDrafts(): Draft[] {
  const base = {
    caregiver: null,
    missedMed: false,
    missedAppt: false,
    completedMed: false,
    cost: false,
    transport: false,
    nextVisitOn: null as string | null,
    concern: null as string | null,
    glucoseAlert: false,
    livesAlone: false,
    wellness: "none" as const,
    a1c: null as number | null,
    a1cOn: null as string | null,
  };
  const ada: Draft = {
    ...base,
    ...emptyExtras(),
    n: 1,
    name: "Ada North",
    age: 62,
    sex: "female",
    htn: true,
    dm: true,
    sys: 162,
    dia: 98,
    bpOn: null,
    a1c: 10.6,
    a1cOn: ago(20),
    screens: [{ instrument: "phq2", score: 1, followUp: false, on: ago(18) }],
    cancer: [{ kind: "colorectal", method: "fit", result: "abnormal", on: ago(18), followUpOn: null }],
    missedMed: true,
    missedAppt: true,
    cost: true,
    nextVisitOn: ahead(10),
    rpm: "full",
    minutes: 28,
    outreach: ["no_answer", "contacted"],
    concern: "Home cuff reading felt high this week.",
    note: "Sample story. Home blood pressure is over 140/90, A1c is over 9, a medication check-in was missed, and an appointment was missed.",
    glucoseAlert: true,
  };
  const bo: Draft = {
    ...base,
    ...emptyExtras(),
    n: 2,
    name: "Bo West",
    age: 79,
    sex: "male",
    htn: true,
    dm: false,
    sys: 128,
    dia: 76,
    bpOn: null,
    screens: [{ instrument: "phq2", score: 0, followUp: false, on: ago(12) }],
    cognitive: [{ score: 2, on: ago(40) }],
    falls: [{ atRisk: true, on: ago(40) }],
    livesAlone: true,
    wellness: "escalated",
    rpm: "partial",
    minutes: 14,
    outreach: ["contacted"],
    concern: "No OK reply on the daily check-in.",
    note: "Sample story. Lives alone. The daily check-in was missed. Family was notified, then the care team. Cognitive score is in the concern range and a falls screen is marked at risk.",
  };
  const cam: Draft = {
    ...base,
    ...emptyExtras(),
    n: 3,
    name: "Cam East",
    age: 83,
    sex: "female",
    htn: true,
    dm: false,
    sys: 136,
    dia: 82,
    bpOn: null,
    screens: [{ instrument: "phq2", score: 2, followUp: false, on: ago(30) }],
    strain: [{ score: 9, on: ago(6) }],
    caregiver: "Fictional Kim East",
    rpm: "partial",
    minutes: 12,
    outreach: ["scheduled"],
    note: "Sample story. Caregiver strain score is high. Cognitive screen is due. Falls screen is due.",
  };
  const dee: Draft = {
    ...base,
    ...emptyExtras(),
    n: 4,
    name: "Dee South",
    age: 60,
    sex: "female",
    htn: false,
    dm: false,
    sys: 122,
    dia: 76,
    bpOn: ago(15),
    screens: [{ instrument: "phq9", score: 6, followUp: false, on: ago(8) }],
    cancer: [
      { kind: "breast", method: "mammogram", result: "abnormal", on: ago(50), followUpOn: null },
      { kind: "colorectal", method: "colonoscopy", result: "normal", on: ago(200), followUpOn: null },
    ],
    missedAppt: true,
    transport: true,
    nextVisitOn: ahead(7),
    rpm: "none",
    minutes: 0,
    outreach: ["no_answer"],
    note: "Sample story. Mammogram result is abnormal and follow-up is overdue. Cervical screening is due. Transport barrier is marked.",
  };
  const eli: Draft = {
    ...base,
    ...emptyExtras(),
    n: 5,
    name: "Eli Brook",
    age: 50,
    sex: "male",
    htn: true,
    dm: false,
    sys: 126,
    dia: 78,
    bpOn: null,
    screens: [{ instrument: "phq9", score: 16, followUp: true, on: ago(20) }],
    missedAppt: true,
    nextVisitOn: ahead(14),
    rpm: "full",
    minutes: 46,
    outreach: ["declined", "scheduled"],
    note: "Sample story. Colorectal screening is due. Depression screen was positive and a follow-up is recorded.",
  };
  const fran: Draft = {
    ...base,
    ...emptyExtras(),
    n: 6,
    name: "Fran Hill",
    age: 57,
    sex: "female",
    htn: true,
    dm: true,
    sys: 124,
    dia: 74,
    bpOn: null,
    a1c: 7.1,
    a1cOn: ago(22),
    screens: [
      { instrument: "phq9", score: 18, followUp: true, on: "2025-10-01" },
      { instrument: "phq9", score: 14, followUp: false, on: ago(30) },
    ],
    cancer: [
      { kind: "cervical", method: "pap_hpv", result: "normal", on: ago(400), followUpOn: null },
      { kind: "colorectal", method: "fit", result: "normal", on: ago(100), followUpOn: null },
    ],
    rpm: "full",
    minutes: 24,
    outreach: ["contacted"],
    note: "Sample story. An older PHQ-9 over 9 has no remission score in the 12 month window. The latest screen is still positive without a follow-up.",
  };
  const gale: Draft = {
    ...base,
    ...emptyExtras(),
    n: 7,
    name: "Gale Pond",
    age: 68,
    sex: "female",
    htn: true,
    dm: true,
    sys: 122,
    dia: 74,
    bpOn: null,
    a1c: 6.8,
    a1cOn: ago(16),
    screens: [{ instrument: "phq2", score: 0, followUp: false, on: ago(10) }],
    cancer: [
      { kind: "breast", method: "mammogram", result: "normal", on: ago(150), followUpOn: null },
      { kind: "cervical", method: "pap", result: "normal", on: ago(200), followUpOn: null },
      { kind: "colorectal", method: "fit", result: "normal", on: ago(80), followUpOn: null },
    ],
    cognitive: [{ score: 5, on: ago(60) }],
    falls: [{ atRisk: false, on: ago(60) }],
    livesAlone: true,
    wellness: "ok",
    completedMed: true,
    rpm: "full",
    minutes: 40,
    outreach: ["scheduled"],
    note: "Sample story. Blood pressure and A1c are in range, screenings are current, and the daily check-in is inside the window.",
  };
  const hal: Draft = {
    ...base,
    ...emptyExtras(),
    n: 8,
    name: "Hal Reed",
    age: 48,
    sex: "male",
    htn: true,
    dm: true,
    sys: 148,
    dia: 94,
    bpOn: null,
    a1c: 8.6,
    a1cOn: ago(28),
    screens: [{ instrument: "phq2", score: 5, followUp: false, on: ago(9) }],
    missedMed: true,
    rpm: "partial",
    minutes: 12,
    outreach: ["no_answer"],
    glucoseAlert: true,
    concern: "Missed the evening metformin twice.",
    note: "Sample story. Care minutes are in the 10 to 19 range. Home glucose is over the clinic line. A medication check-in was missed.",
  };
  const ivy: Draft = {
    ...base,
    ...emptyExtras(),
    n: 9,
    name: "Ivy Lane",
    age: 64,
    sex: "female",
    htn: true,
    dm: false,
    sys: 120,
    dia: 70,
    bpOn: null,
    screens: [
      { instrument: "phq9", score: 16, followUp: true, on: "2025-09-01" },
      { instrument: "phq9", score: 3, followUp: false, on: "2026-08-01" },
    ],
    cancer: [
      { kind: "cervical", method: "pap", result: "normal", on: ago(120), followUpOn: null },
      { kind: "colorectal", method: "fit", result: "normal", on: ago(90), followUpOn: null },
    ],
    rpm: "full",
    minutes: 22,
    outreach: ["closed"],
    note: "Sample story. A later PHQ-9 is under 5, so the 12 month remission estimate is met.",
  };
  return [ada, bo, cam, dee, eli, fran, gale, hal, ivy];
}

function bulkScreen(age: number, i: number): ScreenDraft[] {
  if (age < 12) return [];
  const on = ago(21);
  const kind = i % 6;
  if (kind === 1) return [{ instrument: "phq2", score: 1, followUp: false, on }];
  if (kind === 2) return [{ instrument: "phq2", score: 4, followUp: false, on }];
  if (kind === 3) return [{ instrument: "phq9", score: 12, followUp: true, on }];
  if (kind === 4) return [{ instrument: "phq9", score: 11, followUp: false, on }];
  if (kind === 5) return [{ instrument: "phq2", score: 0, followUp: false, on }];
  return [];
}

function bulkCancer(age: number, sex: Sex, i: number): CancerDraft[] {
  const events: CancerDraft[] = [];
  if (age >= 45 && age <= 75) {
    if (i % 3 === 1) events.push({ kind: "colorectal", method: "fit", result: "normal", on: ago(160), followUpOn: null });
    if (i % 3 === 2) events.push({ kind: "colorectal", method: "colonoscopy", result: "normal", on: ago(800), followUpOn: null });
  }
  if (sex === "female" && age >= 52 && age <= 74 && i % 2 === 0) {
    events.push({ kind: "breast", method: "mammogram", result: "normal", on: ago(200), followUpOn: null });
  }
  if (sex === "female" && age >= 21 && age <= 64 && i % 3 !== 1) {
    const hpv = age >= 30 && i % 3 === 2;
    events.push({
      kind: "cervical",
      method: hpv ? "pap_hpv" : "pap",
      result: "normal",
      on: ago(hpv ? 500 : 180),
      followUpOn: null,
    });
  }
  return events;
}

function bulkDrafts(): Draft[] {
  return BULK_AGES.map((age, i) => {
    const sex: Sex = i % 2 === 0 ? "female" : "male";
    let htn = age >= 18 && i % 3 !== 2;
    let dm = age >= 18 && i % 4 === 0;
    if (age < 18) {
      htn = false;
      dm = false;
    }
    const recentBp = i % 7 !== 0;
    const controlled = i % 4 !== 0;
    const bp = htn || dm ? (controlled ? controlledBp(i) : uncontrolledBp(i)) : { sys: null, dia: null };
    const chronic = htn || dm;
    let rpm: RpmKind = "none";
    if (chronic && recentBp) {
      if (i % 5 === 0) rpm = "partial";
      else if (i % 5 === 1) rpm = "new";
      else rpm = "full";
    }
    let minutes = 0;
    if (rpm === "full") minutes = i % 2 === 0 ? 24 : 46;
    if (rpm === "partial") minutes = 12;
    if (rpm === "new") minutes = 22;
    const a1cCycle = [6.8, 7.1, 7.5, 8.5, 9.8, 10.5];
    const livesAlone = age >= 70 && i % 2 === 0;
    const outreach: OutreachOutcome[] = i % 5 === 0 ? ["no_answer", "contacted"] : i % 5 === 1 ? ["scheduled"] : [];
    return {
      n: 10 + i,
      name: BULK_NAMES[i],
      age,
      sex,
      htn,
      dm,
      sys: bp.sys,
      dia: bp.dia,
      bpOn: bp.sys == null ? null : recentBp ? ago(12) : ago(400),
      a1c: dm ? a1cCycle[i % a1cCycle.length] : null,
      a1cOn: dm ? (i % 11 === 0 ? ago(400) : ago(25)) : null,
      screens: bulkScreen(age, i),
      cancer: bulkCancer(age, sex, i),
      cognitive: age >= 65 && i % 4 !== 0 ? [{ score: 4, on: ago(80) }] : [],
      falls: age >= 65 && i % 2 === 0 ? [{ atRisk: false, on: ago(80) }] : [],
      strain: i === 3 ? [{ score: 3, on: ago(15) }] : [],
      livesAlone,
      wellness: livesAlone ? "ok" : "none",
      caregiver: null,
      missedMed: age >= 18 && i % 10 === 0,
      missedAppt: age >= 18 && i % 12 === 0,
      completedMed: false,
      cost: false,
      transport: false,
      nextVisitOn: i % 4 === 0 ? ahead(12) : null,
      rpm,
      minutes,
      outreach,
      concern: i % 9 === 0 ? "Sample message. The home cuff was hard to use this week." : null,
      note: null,
      glucoseAlert: dm && !controlled,
    };
  });
}

function allDrafts(): Draft[] {
  return [...storyDrafts(), ...bulkDrafts()];
}

interface BuiltReading extends DemoReading {
  out: { metric: string; value: string } | null;
}

function readingsFor(draft: Draft): BuiltReading[] {
  const dates = rpmDates(draft.rpm);
  if (dates.length === 0 || draft.sys == null || draft.dia == null) return [];
  const rows: BuiltReading[] = [];
  dates.forEach((date, index) => {
    const last = index === dates.length - 1;
    const sys = draft.sys! + (last ? 0 : (index * 3) % 7 - 3);
    const dia = draft.dia! + (last ? 0 : (index % 5) - 2);
    const bp: DemoReading = { kind: "bp", systolic: sys, diastolic: dia, glucose: null, recorded_on: date };
    const bpFlag = readingOutOfRange(bp, DEFAULT_THRESHOLDS);
    rows.push({ ...bp, out: bpFlag.out && bpFlag.metric && bpFlag.value ? { metric: bpFlag.metric, value: bpFlag.value } : null });
    if (draft.dm) {
      const glucose = draft.glucoseAlert && last ? 214 : 120 + (index % 6) * 5;
      const sugar: DemoReading = { kind: "glucose", systolic: null, diastolic: null, glucose, recorded_on: date };
      const sugarFlag = readingOutOfRange(sugar, DEFAULT_THRESHOLDS);
      rows.push({
        ...sugar,
        out: sugarFlag.out && sugarFlag.metric && sugarFlag.value ? { metric: sugarFlag.metric, value: sugarFlag.value } : null,
      });
    }
  });
  return rows;
}

function wellnessPatch(draft: Draft, phone: string): Partial<PatientRecord> {
  if (draft.wellness === "none") {
    return {
      lives_alone: draft.livesAlone,
      wellness_opt_in: false,
      cost_barrier: draft.cost,
      transport_barrier: draft.transport,
    };
  }
  if (draft.wellness === "escalated") {
    return {
      lives_alone: true,
      wellness_opt_in: true,
      wellness_phone: phone,
      wellness_family_phone: `555-010-${2000 + draft.n}`,
      wellness_last_ok: "2026-10-28T08:00:00Z",
      wellness_family_notified_at: "2026-10-29T10:00:00Z",
      wellness_family_delivery: "sent",
      wellness_team_notified_at: "2026-10-30T14:00:00Z",
      cost_barrier: draft.cost,
      transport_barrier: draft.transport,
    };
  }
  return {
    lives_alone: true,
    wellness_opt_in: true,
    wellness_phone: phone,
    wellness_family_phone: `555-010-${2100 + draft.n}`,
    wellness_last_ok: `${DEMO_AS_OF}T08:00:00Z`,
    cost_barrier: draft.cost,
    transport_barrier: draft.transport,
  };
}

function wellnessLabel(patient: PatientRecord): string | null {
  const decision = wellnessDecision(
    {
      opted_in: patient.wellness_opt_in,
      lives_alone: patient.lives_alone,
      last_ok_at: patient.wellness_last_ok,
      family_notified_at: patient.wellness_family_notified_at,
      family_delivery: patient.wellness_family_delivery,
      team_notified_at: patient.wellness_team_notified_at,
    },
    DEMO_NOW,
    DEFAULT_CARE_SETTINGS.wellness_window_hours,
  );
  if (decision === "ineligible") return null;
  if (decision === "ok") return "Checked in inside the daily window.";
  if (decision === "waiting_on_family") return "Family was notified. The sample is still inside the wait window.";
  if (decision === "escalate_family") return "Missed the daily check-in. Family has not been notified in this sample.";
  if (patient.wellness_family_notified_at && patient.wellness_team_notified_at) {
    return "Missed the daily check-in. Family was notified, then the care team.";
  }
  return "Missed the daily check-in. Care team escalation is open.";
}

function toCancer(draft: CancerDraft): CancerEvent {
  return {
    kind: draft.kind,
    method: draft.method,
    result: draft.result,
    screened_on: draft.on,
    follow_up_on: draft.followUpOn,
  };
}

export async function buildDemoSnapshot(): Promise<DemoSnapshot> {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic(DEMO_CLINIC_NAME);
  const staffRows = [];
  for (const person of STAFF) {
    staffRows.push(await store.addStaff(clinic.id, person.role, person.name, person.phone));
  }
  const provider = staffRows[0];
  const actor: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const drafts = allDrafts();
  const saved = await store.upsertPatients(clinic.id, drafts.map((draft) => ({
    external_id: demoExternalId(draft.n),
    age: draft.age,
    has_diabetes: draft.dm,
    has_hypertension: draft.htn,
    last_a1c: draft.a1c,
    last_a1c_date: draft.a1cOn,
    bp_systolic: draft.sys,
    bp_diastolic: draft.dia,
    last_bp_date: draft.bpOn,
    next_visit_date: draft.nextVisitOn,
    patient_id: null,
    sex: draft.sex,
  })));
  const byExternal = new Map(saved.map((row) => [row.external_id, row]));
  for (const person of staffRows) {
    for (const patient of saved) {
      await store.addMember({
        clinic_patient_id: patient.id,
        role: person.role,
        display_name: person.display_name,
        staff_id: person.id,
      });
    }
  }

  for (const draft of drafts) {
    const externalId = demoExternalId(draft.n);
    const patient = byExternal.get(externalId);
    if (!patient) throw new Error(`missing ${externalId}`);
    const phone = demoPhone(draft.n);
    const readings = readingsFor(draft);
    const flagged: Array<{ metric: string; value: string; on: string }> = [];
    let latestBp: BuiltReading | null = null;
    for (const reading of readings) {
      await store.addReading({
        clinic_patient_id: patient.id,
        kind: reading.kind,
        systolic: reading.systolic,
        diastolic: reading.diastolic,
        glucose: reading.glucose,
        recorded_on: reading.recorded_on,
      });
      if (reading.kind === "bp") latestBp = reading;
      if (reading.out) flagged.push({ metric: reading.out.metric, value: reading.out.value, on: reading.recorded_on });
    }
    for (const alert of flagged.slice(-2)) {
      await store.addAlert({
        clinic_patient_id: patient.id,
        metric: alert.metric,
        value_text: alert.value,
        created_on: alert.on,
      });
    }
    const patch = wellnessPatch(draft, phone);
    if (latestBp) {
      patch.bp_systolic = latestBp.systolic;
      patch.bp_diastolic = latestBp.diastolic;
      patch.last_bp_date = latestBp.recorded_on;
    }
    await store.updatePatient(patient.id, patch);
    if (draft.caregiver) {
      await store.addMember({
        clinic_patient_id: patient.id,
        role: "caregiver",
        display_name: draft.caregiver,
        staff_id: null,
      });
    }
    for (const screen of draft.screens) {
      await store.addScreen({
        clinic_patient_id: patient.id,
        instrument: screen.instrument,
        score: screen.score,
        follow_up: screen.followUp,
        recorded_on: screen.on,
      });
    }
    for (const event of draft.cancer) {
      await store.addSafety({
        clinic_patient_id: patient.id,
        kind: "cancer",
        recorded_on: event.on,
        payload: {
          kind: event.kind,
          method: event.method,
          result: event.result,
          screened_on: event.on,
          follow_up_on: event.followUpOn,
        },
      });
    }
    for (const item of draft.cognitive) {
      await store.addSafety({
        clinic_patient_id: patient.id,
        kind: "cognitive",
        recorded_on: item.on,
        payload: { score: item.score },
      });
    }
    for (const item of draft.falls) {
      await store.addSafety({
        clinic_patient_id: patient.id,
        kind: "falls",
        recorded_on: item.on,
        payload: { at_risk: item.atRisk },
      });
    }
    for (const item of draft.strain) {
      await store.addSafety({
        clinic_patient_id: patient.id,
        kind: "strain",
        recorded_on: item.on,
        payload: { score: item.score },
      });
    }
    if (draft.missedMed) {
      await store.addCheckin({
        clinic_patient_id: patient.id,
        kind: "medication",
        status: "missed",
        occurred_on: ago(4),
      });
    }
    if (draft.missedAppt) {
      await store.addCheckin({
        clinic_patient_id: patient.id,
        kind: "appointment",
        status: "missed",
        occurred_on: ago(6),
      });
    }
    if (draft.completedMed) {
      await store.addCheckin({
        clinic_patient_id: patient.id,
        kind: "medication",
        status: "completed",
        occurred_on: ago(2),
      });
    }
    for (const outcomeIndex of draft.outreach.keys()) {
      await store.addOutreach({
        clinic_id: clinic.id,
        clinic_patient_id: patient.id,
        staff_role: STAFF[outcomeIndex % STAFF.length].role,
        outcome: draft.outreach[outcomeIndex],
        created_on: ago(2 + outcomeIndex * 3),
      });
    }
    if (draft.minutes > 0) await store.addMinutes(patient.id, DEMO_MONTH, draft.minutes);
    if (draft.concern) {
      await store.addMessage({
        clinic_patient_id: patient.id,
        author_role: "caregiver",
        body: draft.concern,
        created_on: ago(3),
      });
    }
  }

  const [work, measured, card, gapResult] = await Promise.all([
    clinicWorklist(store, actor, DEMO_AS_OF),
    clinicMeasures(store, actor, DEMO_AS_OF),
    clinicScorecard(store, actor, DEMO_AS_OF),
    clinicGaps(store, actor, DEMO_AS_OF),
  ]);
  if (!work.ok) throw new Error(work.error);
  if (!measured.ok) throw new Error(measured.error);
  if (!card.ok) throw new Error(card.error);
  if (!gapResult.ok) throw new Error(gapResult.error);

  const patients: DemoPatient[] = [];
  for (const draft of drafts) {
    const externalId = demoExternalId(draft.n);
    const row = byExternal.get(externalId);
    if (!row) throw new Error(`missing ${externalId}`);
    const fresh = await store.getPatient(row.id);
    if (!fresh) throw new Error(`missing ${externalId}`);
    const trackingResult = await clinicTracking(store, actor, fresh.id, DEMO_MONTH);
    if (!trackingResult.ok) throw new Error(trackingResult.error);
    const readings = (await store.listReadings(fresh.id)).map((reading) => ({
      kind: reading.kind,
      systolic: reading.systolic,
      diastolic: reading.diastolic,
      glucose: reading.glucose,
      recorded_on: reading.recorded_on,
    }));
    const safety = await store.listSafety(fresh.id);
    const cancer = safety.filter((event) => event.kind === "cancer").map((event) => {
      const item: CancerEvent = {
        kind: event.payload.kind === "breast" || event.payload.kind === "cervical" ? event.payload.kind : "colorectal",
        method: String(event.payload.method || ""),
        result: event.payload.result === "abnormal" ? "abnormal" : "normal",
        screened_on: String(event.payload.screened_on || event.recorded_on),
        follow_up_on: event.payload.follow_up_on ? String(event.payload.follow_up_on) : null,
      };
      return { ...item, state: followUpState(item, DEMO_AS_OF, DEFAULT_CARE_SETTINGS.cancer_followup_days) };
    });
    const cognitive = safety.filter((event) => event.kind === "cognitive").map((event) => ({
      score: Number(event.payload.score || 0),
      recorded_on: event.recorded_on,
    }));
    const falls = safety.filter((event) => event.kind === "falls").map((event) => ({
      at_risk: Boolean(event.payload.at_risk),
      recorded_on: event.recorded_on,
    }));
    const strain = safety.filter((event) => event.kind === "strain").map((event) => ({
      score: Number(event.payload.score || 0),
      recorded_on: event.recorded_on,
    }));
    const conditions = [
      fresh.has_hypertension ? "Hypertension" : "",
      fresh.has_diabetes ? "Diabetes" : "",
    ].filter(Boolean);
    patients.push({
      external_id: fresh.external_id,
      name: `Fictional ${draft.name}`,
      phone: demoPhone(draft.n),
      family_phone: draft.wellness === "escalated" ? `555-010-${2000 + draft.n}` : draft.wellness === "ok" ? `555-010-${2100 + draft.n}` : null,
      caregiver: draft.caregiver,
      age: fresh.age,
      sex: fresh.sex,
      has_diabetes: fresh.has_diabetes,
      has_hypertension: fresh.has_hypertension,
      conditions,
      lives_alone: fresh.lives_alone,
      note: draft.note,
      next_visit_date: fresh.next_visit_date,
      missed_medication: draft.missedMed,
      missed_appointment: draft.missedAppt,
      cost_barrier: fresh.cost_barrier,
      transport_barrier: fresh.transport_barrier,
      wellness_label: wellnessLabel(fresh),
      wellness_last_ok: fresh.wellness_last_ok,
      wellness_family_notified_at: fresh.wellness_family_notified_at,
      wellness_team_notified_at: fresh.wellness_team_notified_at,
      cancer,
      cognitive,
      cognitive_due: cognitiveDue(fresh.age, cognitive, DEMO_AS_OF, DEFAULT_CARE_SETTINGS.cognitive_interval_days),
      falls,
      strain,
      strain_score: latestStrain(strain),
      alerts: (await store.listAlerts(fresh.id)).map((alert) => ({
        metric: alert.metric,
        value_text: alert.value_text,
        created_on: alert.created_on,
      })),
      readings,
      tracking: trackingResult.data,
      outreach: (await store.listOutreach(fresh.id)).map((item) => ({
        staff_role: item.staff_role,
        outcome: item.outcome,
        created_on: item.created_on,
      })),
      checkins: (await store.listCheckins(fresh.id)).map((item) => ({
        kind: item.kind,
        status: item.status,
        occurred_on: item.occurred_on,
      })),
      concerns: (await store.listMessages(fresh.id)).map((item) => ({
        author_role: item.author_role,
        body: item.body,
        created_on: item.created_on,
      })),
      minutes: trackingResult.data.minutes,
    });
  }

  const nameOf = new Map(patients.map((patient) => [patient.external_id, patient.name]));
  const alerts = patients.flatMap((patient) => patient.alerts.map((alert) => ({
    external_id: patient.external_id,
    name: patient.name,
    ...alert,
  }))).sort((a, b) => b.created_on.localeCompare(a.created_on) || a.external_id.localeCompare(b.external_id));
  const outreach = patients.flatMap((patient) => patient.outreach.map((item) => ({
    external_id: patient.external_id,
    name: nameOf.get(patient.external_id) || patient.external_id,
    ...item,
  }))).sort((a, b) => b.created_on.localeCompare(a.created_on) || a.external_id.localeCompare(b.external_id));

  return {
    banner: DEMO_BANNER,
    clinic_name: DEMO_CLINIC_NAME,
    as_of: DEMO_AS_OF,
    month: DEMO_MONTH,
    sample_day_label: "Sample day October 31, 2026. Rates and day counts use that day.",
    disabled_message: DEMO_DISABLED_MESSAGE,
    patient_count: patients.length,
    staff: STAFF.map((person) => ({ role: person.role, name: person.name, phone: person.phone })),
    patients,
    worklist: work.data,
    gaps: gapResult.data,
    measures: measured.data,
    scorecard: card.data,
    alerts,
    outreach,
  };
}

let cached: Promise<DemoSnapshot> | null = null;

export function loadDemoSnapshot(): Promise<DemoSnapshot> {
  if (!cached) cached = buildDemoSnapshot();
  return cached.then((snapshot) => structuredClone(snapshot));
}

function demoJson(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "private, no-store",
    },
  });
}

/**
 * Read-only demo HTTP. Any method other than GET returns the disabled message
 * and does not touch a clinic store, SMS, email, or a model call.
 * fetchImpl is accepted so tests can prove it is never called.
 */
export async function handleDemoHttp(req: Request, fetchImpl?: typeof fetch): Promise<Response> {
  void fetchImpl;
  if (req.method !== "GET") {
    await req.text().catch(() => "");
    return demoJson({ error: DEMO_DISABLED_MESSAGE, disabled: true }, 403);
  }
  const snapshot = await loadDemoSnapshot();
  return demoJson(snapshot, 200);
}

export function demoReadingSpanDays(snapshot: DemoSnapshot): number {
  let oldest = 0;
  for (const patient of snapshot.patients) {
    for (const reading of patient.readings) {
      const days = daysBetween(snapshot.as_of, reading.recorded_on);
      if (days != null && days > oldest) oldest = days;
    }
  }
  return oldest;
}
