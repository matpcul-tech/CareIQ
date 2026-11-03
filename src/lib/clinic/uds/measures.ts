/**
 * UDS clinical quality measure logic for CMS165 and CMS122.
 *
 * Logic tested against the measure specs, not certified eCQM software.
 *
 * Sources (eCQI Resource Center, 2026 performance period):
 *   CMS165v14 Controlling High Blood Pressure
 *     https://ecqi.healthit.gov/ecqm/ec/2026/cms0165v14
 *   CMS122v14 Diabetes: Glycemic Status Assessment Greater Than 9%
 *     https://ecqi.healthit.gov/ecqm/ec/2026/cms0122v14
 *
 * Pure functions. No database, no network, no model call.
 */

export const MEASURE_LABEL = "Logic tested against the measure specs, not certified eCQM software.";

export interface BpReading {
  date: string; // YYYY-MM-DD
  systolic: number;
  diastolic: number;
  source?: "csv" | "app";
}

export interface A1cResult {
  date: string;
  value: number;
  source?: "csv" | "app";
}

export interface PanelPatient {
  patientId: string;
  birthDate: string; // YYYY-MM-DD
  sex: "female" | "male" | "other" | "unknown";
  hypertension: boolean;
  /** Optional. Hypertension diagnosis start date. */
  hypertensionOnset?: string | null;
  diabetes: boolean;
  bp: BpReading[];
  a1c: A1cResult[];
  /** Optional visit dates. When none are supplied the visit requirement is assumed met. */
  visitDates?: string[];
  hospice?: boolean;
  palliativeCare?: boolean;
  frailty?: boolean;
  advancedIllness?: boolean;
  longTermCare?: boolean;
  esrd?: boolean;
  dialysis?: boolean;
  kidneyTransplant?: boolean;
  pregnancy?: boolean;
  // Care gap measures (all optional).
  sexAtBirth?: "female" | "male" | null;
  mammograms?: string[];
  colorectalScreens?: { date: string; type: ColorectalType }[];
  cervicalScreens?: { date: string; type: CervicalType }[];
  phqResults?: { date: string; tool: "phq2" | "phq9"; score: number }[];
  depressionFollowUps?: string[];
  tobaccoScreens?: { date: string; user: boolean }[];
  tobaccoInterventions?: string[];
  ascvd?: boolean;
  ldl190OrFh?: boolean;
  ascvdRisk20?: boolean;
  statin?: boolean;
  bilateralMastectomy?: boolean;
  hysterectomy?: boolean;
  colorectalCancer?: boolean;
  totalColectomy?: boolean;
  bipolar?: boolean;
  depressionScreenException?: boolean;
  breastfeeding?: boolean;
  rhabdomyolysis?: boolean;
  statinException?: boolean;
}

export type ColorectalType = "colonoscopy" | "fit" | "fit_dna" | "ct_colonography" | "flex_sig";
export type CervicalType = "cytology" | "hpv" | "cotest";

export interface Period {
  start: string;
  end: string;
}

export type MeasureId = "CMS165" | "CMS122" | "CMS125" | "CMS130" | "CMS124" | "CMS2" | "CMS138" | "CMS347";

/**
 * Per-patient status shown to staff.
 * CMS165: controlled is good. CMS122 is inverse: "not_controlled" (A1C over 9 or missing) is the bad outcome.
 */
export type PatientStatus = "controlled" | "not_controlled" | "missing_reading" | "excluded" | "not_in_denominator" | "met" | "due";

export interface MeasureResult {
  measure: MeasureId;
  status: PatientStatus;
  inNumerator: boolean;
  exclusion: string | null;
  latest: BpReading | A1cResult | null;
  needsOutreach: boolean;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO.test(value)) return false;
  const t = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value;
}

export function calendarYearPeriod(year: number): Period {
  return { start: `${year}-01-01`, end: `${year}-12-31` };
}

/** Age in whole years on a given date (end of the measurement period for both measures). */
export function ageOn(birthDate: string, onDate: string): number | null {
  if (!isIsoDate(birthDate) || !isIsoDate(onDate)) return null;
  const [by, bm, bd] = birthDate.split("-").map(Number);
  const [y, m, d] = onDate.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age < 0 ? null : age;
}

export function inPeriod(date: string, period: Period): boolean {
  return isIsoDate(date) && date >= period.start && date <= period.end;
}

export function hadVisit(p: PanelPatient, period: Period): boolean {
  if (!p.visitDates || p.visitDates.length === 0) return true;
  return p.visitDates.some((d) => inPeriod(d, period));
}

/** Exclusions shared by CMS165 and CMS122. Returns a reason or null. */
export function commonExclusion(p: PanelPatient, age: number): string | null {
  if (p.hospice) return "hospice";
  if (p.palliativeCare) return "palliative care";
  // 66 and over living long term in a nursing home.
  if (age >= 66 && p.longTermCare) return "long term care, 66 and over";
  // 66 to 80 with frailty AND advanced illness.
  if (age >= 66 && age <= 80 && p.frailty && p.advancedIllness) return "frailty and advanced illness, 66 to 80";
  // 81 and over with frailty alone.
  if (age >= 81 && p.frailty) return "frailty, 81 and over";
  return null;
}

/**
 * Most recent BP in the period. Per CMS165, when several readings share the most
 * recent day, use the lowest systolic and the lowest diastolic from that day.
 */
export function mostRecentBp(readings: BpReading[], period: Period): BpReading | null {
  const valid = readings.filter(
    (r) => inPeriod(r.date, period) && Number.isFinite(r.systolic) && Number.isFinite(r.diastolic),
  );
  if (valid.length === 0) return null;
  const last = valid.reduce((max, r) => (r.date > max ? r.date : max), valid[0].date);
  const sameDay = valid.filter((r) => r.date === last);
  return {
    date: last,
    systolic: Math.min(...sameDay.map((r) => r.systolic)),
    diastolic: Math.min(...sameDay.map((r) => r.diastolic)),
    source: sameDay[0].source,
  };
}

/** Most recent A1C in the period. Same-day ties use the highest value (conservative). */
export function mostRecentA1c(results: A1cResult[], period: Period): A1cResult | null {
  const valid = results.filter((r) => inPeriod(r.date, period) && Number.isFinite(r.value));
  if (valid.length === 0) return null;
  const last = valid.reduce((max, r) => (r.date > max ? r.date : max), valid[0].date);
  const sameDay = valid.filter((r) => r.date === last);
  return sameDay.reduce((hi, r) => (r.value > hi.value ? r : hi), sameDay[0]);
}

/**
 * CMS165 Controlling High Blood Pressure.
 * Initial population: age 18 to 85 at end of period, visit in period, essential
 * hypertension starting before or in the first six months of the period.
 * Numerator: most recent BP in period is systolic < 140 AND diastolic < 90.
 * No BP in the period counts as not controlled.
 */
export function evaluateCms165(p: PanelPatient, period: Period): MeasureResult {
  const base = { measure: "CMS165" as const, inNumerator: false, exclusion: null, latest: null, needsOutreach: false };
  const age = ageOn(p.birthDate, period.end);
  if (age === null || age < 18 || age > 85 || !p.hypertension || !hadVisit(p, period)) {
    return { ...base, status: "not_in_denominator" };
  }
  if (p.hypertensionOnset && isIsoDate(p.hypertensionOnset)) {
    const year = Number(period.start.slice(0, 4));
    const sixMonths = `${year}-06-30`;
    if (p.hypertensionOnset > sixMonths || p.hypertensionOnset > period.end) {
      return { ...base, status: "not_in_denominator" };
    }
  }
  const exclusion =
    commonExclusion(p, age) ||
    (p.esrd ? "end stage renal disease" : null) ||
    (p.dialysis ? "dialysis" : null) ||
    (p.kidneyTransplant ? "kidney transplant" : null) ||
    (p.pregnancy ? "pregnancy" : null);
  if (exclusion) return { ...base, status: "excluded", exclusion };
  const latest = mostRecentBp(p.bp, period);
  if (!latest) return { ...base, status: "missing_reading", needsOutreach: true };
  const controlled = latest.systolic < 140 && latest.diastolic < 90;
  return {
    ...base,
    latest,
    inNumerator: controlled,
    status: controlled ? "controlled" : "not_controlled",
    needsOutreach: !controlled,
  };
}

/**
 * CMS122 Diabetes: HbA1c (glycemic status) poor control > 9%. Inverse measure, lower is better.
 * Initial population: age 18 to 75 at end of period, visit in period, diabetes.
 * Numerator: most recent A1C in period > 9.0, OR no A1C in the period.
 */
export function evaluateCms122(p: PanelPatient, period: Period): MeasureResult {
  const base = { measure: "CMS122" as const, inNumerator: false, exclusion: null, latest: null, needsOutreach: false };
  const age = ageOn(p.birthDate, period.end);
  if (age === null || age < 18 || age > 75 || !p.diabetes || !hadVisit(p, period)) {
    return { ...base, status: "not_in_denominator" };
  }
  const exclusion = commonExclusion(p, age);
  if (exclusion) return { ...base, status: "excluded", exclusion };
  const latest = mostRecentA1c(p.a1c, period);
  if (!latest) return { ...base, status: "missing_reading", inNumerator: true, needsOutreach: true };
  const poor = latest.value > 9;
  return {
    ...base,
    latest,
    inNumerator: poor,
    status: poor ? "not_controlled" : "controlled",
    needsOutreach: poor,
  };
}

export const MEASURE_TITLES: Record<MeasureId, string> = {
  CMS165: "Controlling High Blood Pressure",
  CMS122: "Diabetes: HbA1c Poor Control (over 9%)",
  CMS125: "Breast Cancer Screening",
  CMS130: "Colorectal Cancer Screening",
  CMS124: "Cervical Cancer Screening",
  CMS2: "Depression Screening and Follow-Up Plan",
  CMS138: "Tobacco Use: Screening and Cessation Intervention",
  CMS347: "Statin Therapy for Cardiovascular Disease",
};

export interface MeasureRate {
  measure: MeasureId;
  title: string;
  inverse: boolean;
  numerator: number;
  denominator: number;
  exclusions: number;
  percent: number | null;
}

export function rate(measure: MeasureId, results: MeasureResult[]): MeasureRate {
  const inDenom = results.filter((r) => r.status !== "not_in_denominator" && r.status !== "excluded");
  const numerator = inDenom.filter((r) => r.inNumerator).length;
  const denominator = inDenom.length;
  return {
    measure,
    title: MEASURE_TITLES[measure],
    inverse: measure === "CMS122",
    numerator,
    denominator,
    exclusions: results.filter((r) => r.status === "excluded").length,
    percent: denominator === 0 ? null : Math.round((numerator / denominator) * 1000) / 10,
  };
}

export interface PanelRow {
  patientId: string;
  age: number | null;
  sex: PanelPatient["sex"];
  source: "csv" | "app" | "csv+app";
  cms165: MeasureResult;
  cms122: MeasureResult;
  needsOutreach: boolean;
}

export interface PanelSummary {
  period: Period;
  label: string;
  rates: MeasureRate[];
  rows: PanelRow[];
}

export function evaluatePanel(patients: (PanelPatient & { source?: PanelRow["source"] })[], period: Period): PanelSummary {
  const rows: PanelRow[] = patients.map((p) => {
    const cms165 = evaluateCms165(p, period);
    const cms122 = evaluateCms122(p, period);
    return {
      patientId: p.patientId,
      age: ageOn(p.birthDate, period.end),
      sex: p.sex,
      source: p.source || "csv",
      cms165,
      cms122,
      needsOutreach: cms165.needsOutreach || cms122.needsOutreach,
    };
  });
  return {
    period,
    label: MEASURE_LABEL,
    rates: [rate("CMS165", rows.map((r) => r.cms165)), rate("CMS122", rows.map((r) => r.cms122))],
    rows,
  };
}

/** Exclusions in the specs that this CSV-based logic cannot evaluate. */
export const UNSUPPORTED_EXCLUSIONS: string[] = [
  "Exclusion criteria are only as good as the yes or no flags in the CSV. Value set codes (SNOMED, ICD-10, CPT, HCPCS, LOINC) are not matched, so hospice, palliative care, frailty, advanced illness, ESRD, dialysis, transplant, and pregnancy rely on clinic-supplied flags.",
  "Advanced illness timing (two outpatient encounters or one inpatient encounter in the period or year before) and the dementia medication path are not checked; the advanced illness flag is trusted as given.",
  "Frailty device, encounter, symptom, and diagnosis value sets are not checked; the frailty flag is trusted as given.",
  "Long term care: the 90 day nursing home residency rule and Medicare institutional SNP enrollment are not checked; the long term care flag is trusted as given.",
  "CMS165: BP readings taken during an acute inpatient stay or ED visit cannot be filtered out; CSV and app readings are assumed outpatient or remote device readings.",
  "CMS165: hypertension onset in the first six months is only checked when an onset date column is supplied.",
  "Qualifying encounter value sets: when no visit dates are supplied the visit in period requirement is assumed met.",
  "CMS122: glucose management indicator (GMI) as a glycemic status result is not supported; only lab A1C values are used.",
];
