/**
 * Clinic scorecard estimates. Not validated CMS, HEDIS, or IHS GPRA measures.
 * RPM and CCM figures are tracking only, not claims submission.
 * Built-in targets and RPM dollar amounts are examples. This repo does not
 * include a cited fee schedule or national target table. 99470 is unconfirmed.
 */

import { daysBetween, MEASUREMENT_DAYS } from "./logic";
import {
  breastMet,
  cervicalMet,
  cognitiveConcern,
  cognitiveDue,
  colorectalMet,
  DEFAULT_CARE_SETTINGS,
  fallsState,
  followUpState,
  latestStrain,
  wellnessDecision,
  type CancerEvent,
  type CareSettings,
  type WellnessState,
} from "./safety";

export const SCORECARD_LABEL =
  "Estimate only. Not a validated CMS, HEDIS, UDS, or IHS GPRA measure.";

export const P4P_LABEL =
  "Estimate only. Example MCO tiers of $40, $80, and $100 per compliant member. Not a payment.";

export const RPM_DOLLAR_LABEL =
  "Tracking only. Not claims submission. RPM dollar amounts are examples, not a cited fee schedule. 99470 is unconfirmed.";

export const CCM_LABEL =
  "CCM or APCM time is tracking only. The scorecard did not list a dollar amount, so none is estimated.";

export const MEASURE_IDS = [
  "cms165",
  "hedis_cbp",
  "cms122",
  "hedis_gsd",
  "cms2",
  "cms159",
  "gpra_a1c",
  "gpra_bp",
  "gpra_depression",
  "cms130",
  "cms125",
  "cms124",
  "cms139",
] as const;

export type MeasureId = (typeof MEASURE_IDS)[number];

/** Example rates only. Null means this repo has no cited default percent. */
export const SCORECARD_DEFAULT_TARGETS: Record<MeasureId, number | null> = {
  cms165: 0.6908,
  hedis_cbp: 0.6387,
  cms122: 0.2628,
  hedis_gsd: 0.5669,
  cms2: null,
  cms159: null,
  gpra_a1c: 0.121,
  gpra_bp: 0.575,
  gpra_depression: 0.396,
  cms130: null,
  cms125: null,
  cms124: null,
  cms139: null,
};

const MEASURE_META: Record<MeasureId, { name: string; direction: "higher" | "lower" }> = {
  cms165: { name: "CMS165 blood pressure control", direction: "higher" },
  hedis_cbp: { name: "HEDIS CBP blood pressure control", direction: "higher" },
  cms122: { name: "CMS122 A1c over 9", direction: "lower" },
  hedis_gsd: { name: "HEDIS GSD A1c under 8", direction: "higher" },
  cms2: { name: "CMS2 depression screening and follow-up", direction: "higher" },
  cms159: { name: "CMS159 depression remission, 12 month PHQ-9", direction: "higher" },
  gpra_a1c: { name: "IHS GPRA A1c over 9", direction: "lower" },
  gpra_bp: { name: "IHS GPRA diabetes blood pressure control", direction: "higher" },
  gpra_depression: { name: "IHS GPRA adult depression screening", direction: "higher" },
  cms130: { name: "CMS130 colorectal screening", direction: "higher" },
  cms125: { name: "CMS125 breast screening", direction: "higher" },
  cms124: { name: "CMS124 cervical screening", direction: "higher" },
  cms139: { name: "CMS139 falls screening", direction: "higher" },
};

export interface ScreenPoint {
  instrument: "phq2" | "phq9";
  score: number;
  follow_up: boolean;
  recorded_on: string;
}

export interface ScorecardPatient {
  external_id: string;
  age: number | null;
  has_diabetes: boolean;
  has_hypertension: boolean;
  a1c: number | null;
  a1c_date: string | null;
  systolic: number | null;
  diastolic: number | null;
  bp_date: string | null;
  screens: ScreenPoint[];
  reading_dates: string[];
  minutes: number;
  sex?: "female" | "male" | "unknown" | null;
  cancer?: CancerEvent[];
  cost_barrier?: boolean;
  transport_barrier?: boolean;
  cognitive?: Array<{ score: number; recorded_on: string }>;
  falls?: Array<{ at_risk: boolean; recorded_on: string }>;
  strain?: Array<{ score: number; recorded_on: string }>;
  wellness?: WellnessState | null;
}

export interface MeasureCard {
  id: MeasureId;
  name: string;
  direction: "higher" | "lower";
  numerator: number;
  denominator: number;
  rate: number | null;
  target: number | null;
  target_source: "example" | "clinic" | "none";
  gap: number | null;
  needed: number | null;
  patient_count: number;
  patients: string[];
  note: string;
}

const PATIENT_CAP = 20;
const RPM_SETUP = 22;
const RPM_DEVICE_DAYS = 47;
const RPM_FIRST_20 = 52;
const RPM_EXTRA_20 = 41;
const RPM_SHORT_10 = 26;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function inLastYear(asOf: string, date: string | null): boolean {
  if (!date) return false;
  const days = daysBetween(asOf, date);
  return days != null && days >= 0 && days <= MEASUREMENT_DAYS;
}

function bpControlled(row: ScorecardPatient, asOf: string): boolean {
  return (
    inLastYear(asOf, row.bp_date) &&
    row.systolic != null &&
    row.diastolic != null &&
    row.systolic < 140 &&
    row.diastolic < 90
  );
}

function a1cPoor(row: ScorecardPatient, asOf: string): boolean {
  if (!inLastYear(asOf, row.a1c_date) || row.a1c == null) return true;
  return row.a1c > 9;
}

function a1cUnder8(row: ScorecardPatient, asOf: string): boolean {
  return inLastYear(asOf, row.a1c_date) && row.a1c != null && row.a1c < 8;
}

function latestScreen(row: ScorecardPatient, asOf: string): ScreenPoint | null {
  const recent = row.screens
    .filter((screen) => inLastYear(asOf, screen.recorded_on))
    .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on) || (a.instrument === "phq9" ? 1 : -1));
  return recent[recent.length - 1] || null;
}

function screenPositive(screen: ScreenPoint): boolean {
  if (screen.instrument === "phq2") return screen.score >= 3;
  return screen.score >= 10;
}

function cms2Met(row: ScorecardPatient, asOf: string): boolean {
  const screen = latestScreen(row, asOf);
  if (!screen) return false;
  if (!screenPositive(screen)) return true;
  return screen.follow_up;
}

function indexPhq9(row: ScorecardPatient): ScreenPoint | null {
  const hits = row.screens
    .filter((screen) => screen.instrument === "phq9" && screen.score > 9)
    .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
  return hits[0] || null;
}

function cms159State(row: ScorecardPatient, asOf: string): "out" | "met" | "gap" {
  const index = indexPhq9(row);
  if (!index) return "out";
  const since = daysBetween(asOf, index.recorded_on);
  if (since == null || since < 305) return "out";
  const remitted = row.screens.some((screen) => {
    if (screen.instrument !== "phq9" || screen.score >= 5) return false;
    if (screen.recorded_on <= index.recorded_on) return false;
    const after = daysBetween(screen.recorded_on, index.recorded_on);
    return after != null && after >= 300;
  });
  return remitted ? "met" : "gap";
}

function ageOk(age: number | null, min: number, max?: number): boolean {
  if (age == null) return false;
  if (age < min) return false;
  if (max != null && age > max) return false;
  return true;
}

interface Bucket {
  numerator: number;
  denominator: number;
  open: string[];
}

function emptyBucket(): Bucket {
  return { numerator: 0, denominator: 0, open: [] };
}

function add(bucket: Bucket, id: string, inNumerator: boolean, opensGap: boolean) {
  bucket.denominator += 1;
  if (inNumerator) bucket.numerator += 1;
  if (opensGap) bucket.open.push(id);
}

export function resolveTargets(overrides: Partial<Record<MeasureId, number>>): Record<MeasureId, { target: number | null; source: "example" | "clinic" | "none" }> {
  const out = {} as Record<MeasureId, { target: number | null; source: "example" | "clinic" | "none" }>;
  for (const id of MEASURE_IDS) {
    if (typeof overrides[id] === "number") {
      out[id] = { target: overrides[id] as number, source: "clinic" };
    } else if (SCORECARD_DEFAULT_TARGETS[id] == null) {
      out[id] = { target: null, source: "none" };
    } else {
      out[id] = { target: SCORECARD_DEFAULT_TARGETS[id], source: "example" };
    }
  }
  return out;
}

function card(id: MeasureId, bucket: Bucket, targets: ReturnType<typeof resolveTargets>): MeasureCard {
  const meta = MEASURE_META[id];
  const rate = bucket.denominator === 0 ? null : round3(bucket.numerator / bucket.denominator);
  const target = targets[id].target;
  let gap: number | null = null;
  let needed: number | null = null;
  if (rate != null && target != null && bucket.denominator > 0) {
    if (meta.direction === "higher") {
      gap = round3(Math.max(0, target - rate));
      needed = Math.max(0, Math.ceil(target * bucket.denominator - bucket.numerator - 1e-9));
    } else {
      gap = round3(Math.max(0, rate - target));
      needed = Math.max(0, Math.ceil(bucket.numerator - target * bucket.denominator - 1e-9));
    }
  }
  const showPatients = target == null || (needed != null && needed > 0);
  const ordered = [...bucket.open].sort((a, b) => a.localeCompare(b));
  const patients = showPatients ? ordered.slice(0, PATIENT_CAP) : [];
  let note = SCORECARD_LABEL;
  if (id === "cms159") {
    note = "12 month PHQ-9 reminder. The list starts about 10 months after an index score over 9. " + SCORECARD_LABEL;
  }
  if (id === "cms2" || id === "cms159" || id === "cms130" || id === "cms125" || id === "cms124" || id === "cms139") {
    if (target == null) note = "No default percent in the scorecard. Set a clinic target. " + note;
  }
  if (id === "gpra_a1c" || id === "gpra_bp" || id === "gpra_depression") {
    note = "Tribal site version. " + note;
  }
  return {
    id,
    name: meta.name,
    direction: meta.direction,
    numerator: bucket.numerator,
    denominator: bucket.denominator,
    rate,
    target,
    target_source: targets[id].source,
    gap,
    needed,
    patient_count: showPatients ? bucket.open.length : 0,
    patients,
    note,
  };
}

export interface RpmCodeLine {
  code: "99453" | "99454" | "99457" | "99458" | "99470";
  units: number;
  dollars_each: number;
  dollars: number;
  rule: string;
}

export function estimateCareManagement(rows: ScorecardPatient[], month: string): {
  label: string;
  month: string;
  rpm: RpmCodeLine[];
  rpm_dollars: number;
  ccm_apcm: { minutes: number; patients_at_20: number; label: string };
} {
  let setup = 0;
  let device = 0;
  let first20 = 0;
  let extra20 = 0;
  let short10 = 0;
  let minutes = 0;
  let at20 = 0;
  for (const row of rows) {
    const inMonth = row.reading_dates.filter((date) => date.startsWith(month));
    const uniqueDays = new Set(inMonth);
    const first = [...row.reading_dates].sort()[0];
    if (first && first.startsWith(month)) setup += 1;
    if (uniqueDays.size >= 16) device += 1;
    if (row.minutes >= 20) {
      first20 += 1;
      extra20 += Math.floor((row.minutes - 20) / 20);
      at20 += 1;
    } else if (row.minutes >= 10) {
      short10 += 1;
    }
    minutes += row.minutes;
  }
  const rpm: RpmCodeLine[] = [
    { code: "99453", units: setup, dollars_each: RPM_SETUP, dollars: setup * RPM_SETUP, rule: "First home reading month. One time setup estimate." },
    { code: "99454", units: device, dollars_each: RPM_DEVICE_DAYS, dollars: device * RPM_DEVICE_DAYS, rule: "16 or more reading days in the month." },
    { code: "99457", units: first20, dollars_each: RPM_FIRST_20, dollars: first20 * RPM_FIRST_20, rule: "20 or more care minutes in the month." },
    { code: "99458", units: extra20, dollars_each: RPM_EXTRA_20, dollars: extra20 * RPM_EXTRA_20, rule: "Each extra 20 minutes after the first 20." },
    { code: "99470", units: short10, dollars_each: RPM_SHORT_10, dollars: short10 * RPM_SHORT_10, rule: "10 to 19 care minutes. Not stacked with 99457. 99470 is unconfirmed, and this dollar amount is an example." },
  ];
  return {
    label: RPM_DOLLAR_LABEL,
    month,
    rpm,
    rpm_dollars: rpm.reduce((sum, line) => sum + line.dollars, 0),
    ccm_apcm: { minutes, patients_at_20: at20, label: CCM_LABEL },
  };
}

function dollarsFor(compliant: number) {
  return { p40: compliant * 40, p80: compliant * 80, p100: compliant * 100 };
}

export function buildScorecard(
  rows: ScorecardPatient[],
  overrides: Partial<Record<MeasureId, number>>,
  asOf: string,
  month: string,
  settings: CareSettings = DEFAULT_CARE_SETTINGS,
) {
  const targets = resolveTargets(overrides);
  const buckets = Object.fromEntries(MEASURE_IDS.map((id) => [id, emptyBucket()])) as Record<MeasureId, Bucket>;
  for (const row of rows) {
    if (row.has_hypertension && ageOk(row.age, 18, 85)) {
      const met = bpControlled(row, asOf);
      add(buckets.cms165, row.external_id, met, !met);
      add(buckets.hedis_cbp, row.external_id, met, !met);
    }
    if (row.has_diabetes && ageOk(row.age, 18, 75)) {
      const poor = a1cPoor(row, asOf);
      const under8 = a1cUnder8(row, asOf);
      add(buckets.cms122, row.external_id, poor, poor);
      add(buckets.hedis_gsd, row.external_id, under8, !under8);
    }
    if (row.has_diabetes && ageOk(row.age, 18)) {
      const poor = a1cPoor(row, asOf);
      const bp = bpControlled(row, asOf);
      add(buckets.gpra_a1c, row.external_id, poor, poor);
      add(buckets.gpra_bp, row.external_id, bp, !bp);
    }
    if (ageOk(row.age, 12)) {
      const met = cms2Met(row, asOf);
      add(buckets.cms2, row.external_id, met, !met);
    }
    if (ageOk(row.age, 18)) {
      const screened = latestScreen(row, asOf) != null;
      add(buckets.gpra_depression, row.external_id, screened, !screened);
    }
    const remission = cms159State(row, asOf);
    if (remission === "met") add(buckets.cms159, row.external_id, true, false);
    if (remission === "gap") add(buckets.cms159, row.external_id, false, true);
    if (ageOk(row.age, 45, 75)) {
      const met = colorectalMet(row.cancer || [], asOf);
      add(buckets.cms130, row.external_id, met, !met);
    }
    const breast = breastMet(row.sex || null, row.age, row.cancer || [], asOf);
    if (breast === "met") add(buckets.cms125, row.external_id, true, false);
    if (breast === "gap") add(buckets.cms125, row.external_id, false, true);
    const cervical = cervicalMet(row.sex || null, row.age, row.cancer || [], asOf);
    if (cervical === "met") add(buckets.cms124, row.external_id, true, false);
    if (cervical === "gap") add(buckets.cms124, row.external_id, false, true);
    const falls = fallsState(row.age, row.falls || [], asOf);
    if (falls === "met") add(buckets.cms139, row.external_id, true, false);
    if (falls === "gap") add(buckets.cms139, row.external_id, false, true);
  }
  const measures = MEASURE_IDS.map((id) => card(id, buckets[id], targets));
  const cbp = buckets.hedis_cbp.numerator;
  const gsd = buckets.hedis_gsd.numerator;
  const cbpDollars = dollarsFor(cbp);
  const gsdDollars = dollarsFor(gsd);
  const work = new Map<string, string[]>();
  for (const measure of measures) {
    for (const externalId of measure.patients) {
      const list = work.get(externalId) || [];
      list.push(measure.id);
      work.set(externalId, list);
    }
  }
  const nowIso = asOf.length === 10 ? `${asOf}T12:00:00Z` : asOf;
  for (const row of rows) {
    const tags = operationalTags(row, asOf, nowIso, settings, work.get(row.external_id) || []);
    if (tags.length === 0) continue;
    const list = work.get(row.external_id) || [];
    for (const tag of tags) {
      if (!list.includes(tag)) list.push(tag);
    }
    work.set(row.external_id, list);
  }
  const worklist = [...work.entries()]
    .map(([external_id, measuresForPatient]) => ({ external_id, measures: measuresForPatient, gaps: measuresForPatient.length }))
    .sort((a, b) => b.gaps - a.gaps || a.external_id.localeCompare(b.external_id))
    .slice(0, 50);
  return {
    label: SCORECARD_LABEL,
    as_of: asOf,
    month,
    measures,
    worklist,
    p4p: {
      label: P4P_LABEL,
      hedis_cbp: { compliant: cbp, ...cbpDollars },
      hedis_gsd: { compliant: gsd, ...gsdDollars },
      combined: {
        p40: cbpDollars.p40 + gsdDollars.p40,
        p80: cbpDollars.p80 + gsdDollars.p80,
        p100: cbpDollars.p100 + gsdDollars.p100,
      },
    },
    care_management: estimateCareManagement(rows, month),
  };
}

function operationalTags(
  row: ScorecardPatient,
  asOf: string,
  nowIso: string,
  settings: CareSettings,
  already: string[],
): string[] {
  const tags: string[] = [];
  const cancer = row.cancer || [];
  let cancerOpen = false;
  for (const event of cancer) {
    const state = followUpState(event, asOf, settings.cancer_followup_days);
    if (state === "open") {
      tags.push("cancer_followup_open");
      cancerOpen = true;
    }
    if (state === "overdue") {
      tags.push("cancer_followup_overdue");
      cancerOpen = true;
    }
  }
  const cancerGap = already.some((id) => id === "cms130" || id === "cms125" || id === "cms124");
  if (cancerOpen || cancerGap) {
    if (row.cost_barrier) tags.push("cost_barrier");
    if (row.transport_barrier) tags.push("transport_barrier");
  }
  if (row.wellness) {
    const decision = wellnessDecision(row.wellness, nowIso, settings.wellness_window_hours);
    if (decision === "escalate_family" || decision === "waiting_on_family") tags.push("wellness_family");
    if (decision === "escalate_care_team") tags.push("wellness_care_team");
  }
  if (cognitiveDue(row.age, row.cognitive || [], asOf, settings.cognitive_interval_days)) tags.push("cognitive_due");
  const concern = cognitiveConcern(row.cognitive || [], settings.cognitive_concern_at);
  const falls = fallsState(row.age, row.falls || [], asOf);
  const atRisk = (row.falls || []).some((item) => item.at_risk);
  if (concern && (falls === "gap" || atRisk)) tags.push("falls_risk_cms139");
  const strain = latestStrain(row.strain || []);
  if (strain != null && strain >= settings.strain_high_at) tags.push("caregiver_strain");
  return tags;
}

export function validScreen(instrument: string, score: number): instrument is "phq2" | "phq9" {
  if (instrument === "phq2") return score >= 0 && score <= 6 && Number.isInteger(score);
  if (instrument === "phq9") return score >= 0 && score <= 27 && Number.isInteger(score);
  return false;
}
