/**
 * Care gap measures for the UDS panel. Pure functions, no network, no model call.
 * Logic tested against the measure specs, not certified eCQM software.
 *
 * Sources (eCQI Resource Center, 2026 performance period):
 *   CMS125v14 Breast Cancer Screening        https://ecqi.healthit.gov/ecqm/ec/2026/cms0125v14
 *   CMS130v14 Colorectal Cancer Screening    https://ecqi.healthit.gov/ecqm/ec/2026/cms0130v14
 *   CMS124v14 Cervical Cancer Screening      https://ecqi.healthit.gov/ecqm/ec/2026/cms0124v14
 *   CMS2v15   Depression Screening and Follow-Up Plan  https://ecqi.healthit.gov/ecqm/ec/2026/cms0002v15
 *   CMS138v14 Tobacco Use: Screening and Cessation Intervention  https://ecqi.healthit.gov/ecqm/ec/2026/cms0138v14
 *   CMS347v9  Statin Therapy for the Prevention and Treatment of Cardiovascular Disease
 *             https://ecqi.healthit.gov/ecqm/ec/2026/cms0347v9
 */

import {
  ageOn,
  commonExclusion,
  evaluateCms122,
  evaluateCms165,
  hadVisit,
  isIsoDate,
  MEASURE_LABEL,
  rate,
  UNSUPPORTED_EXCLUSIONS,
  type MeasureId,
  type MeasureRate,
  type MeasureResult,
  type PanelPatient,
  type PanelRow,
  type Period,
} from "./measures";

export const CARE_GAP_MEASURES: MeasureId[] = ["CMS125", "CMS130", "CMS124", "CMS2", "CMS138", "CMS347"];
export const ALL_MEASURES: MeasureId[] = ["CMS165", "CMS122", ...CARE_GAP_MEASURES];

/** Plain gap text shown to staff when a patient is due. */
export const GAP_TEXT: Record<MeasureId, string> = {
  CMS165: "BP not controlled or no BP this period",
  CMS122: "A1C over 9 or no A1C this period",
  CMS125: "Mammogram due",
  CMS130: "Colorectal screening due",
  CMS124: "Cervical screening due",
  CMS2: "Depression screening or follow-up plan due",
  CMS138: "Tobacco screening or cessation intervention due",
  CMS347: "Statin therapy not documented",
};

function shiftYears(iso: string, years: number): string {
  const y = Number(iso.slice(0, 4)) + years;
  return `${y}${iso.slice(4)}`;
}

function between(date: string, start: string, end: string): boolean {
  return isIsoDate(date) && date >= start && date <= end;
}

function addDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function female(p: PanelPatient): boolean {
  return (p.sexAtBirth ?? (p.sex === "female" ? "female" : p.sex === "male" ? "male" : null)) === "female";
}

const startYear = (period: Period) => Number(period.start.slice(0, 4));

function result(measure: MeasureId, status: MeasureResult["status"], exclusion: string | null = null): MeasureResult {
  return {
    measure,
    status,
    inNumerator: status === "met",
    exclusion,
    latest: null,
    needsOutreach: status === "due",
  };
}

/** CMS125: women 42 to 74 at end of period; mammogram Oct 1 two years before the period through period end. */
export function evaluateCms125(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.end);
  if (age === null || age < 42 || age > 74 || !female(p) || !hadVisit(p, period)) return result("CMS125", "not_in_denominator");
  const ex = commonExclusion(p, age) || (p.bilateralMastectomy ? "bilateral mastectomy" : null);
  if (ex) return result("CMS125", "excluded", ex);
  const windowStart = `${startYear(period) - 2}-10-01`;
  const met = (p.mammograms || []).some((d) => between(d, windowStart, period.end));
  return result("CMS125", met ? "met" : "due");
}

/** Lookback in years before the period for each colorectal test type (0 means the period only). */
export const COLORECTAL_LOOKBACK_YEARS = { colonoscopy: 9, ct_colonography: 4, flex_sig: 4, fit_dna: 2, fit: 0 } as const;

/** CMS130: age 46 to 75 at end of period. */
export function evaluateCms130(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.end);
  if (age === null || age < 46 || age > 75 || !hadVisit(p, period)) return result("CMS130", "not_in_denominator");
  const ex = commonExclusion(p, age) || (p.colorectalCancer ? "colorectal cancer" : null) || (p.totalColectomy ? "total colectomy" : null);
  if (ex) return result("CMS130", "excluded", ex);
  const met = (p.colorectalScreens || []).some((s) => {
    const back = COLORECTAL_LOOKBACK_YEARS[s.type];
    return back !== undefined && between(s.date, shiftYears(period.start, -back), period.end);
  });
  return result("CMS130", met ? "met" : "due");
}

/**
 * CMS124: women 24 to 64 at end of period. Cytology in the period or two years before;
 * HPV test in the period or four years before when the patient was 30 or older on the test date.
 * A cotest counts as both.
 */
export function evaluateCms124(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.end);
  if (age === null || age < 24 || age > 64 || !female(p) || !hadVisit(p, period)) return result("CMS124", "not_in_denominator");
  const ex = (p.hospice ? "hospice" : null) || (p.palliativeCare ? "palliative care" : null) || (p.hysterectomy ? "hysterectomy with no residual cervix" : null);
  if (ex) return result("CMS124", "excluded", ex);
  const met = (p.cervicalScreens || []).some((s) => {
    const cyto = (s.type === "cytology" || s.type === "cotest") && between(s.date, shiftYears(period.start, -2), period.end);
    const ageAtTest = ageOn(p.birthDate, s.date);
    const hpv = (s.type === "hpv" || s.type === "cotest") && ageAtTest !== null && ageAtTest >= 30 &&
      between(s.date, shiftYears(period.start, -4), period.end);
    return cyto || hpv;
  });
  return result("CMS124", met ? "met" : "due");
}

/** Positive screen: PHQ-9 of 10 or more, or PHQ-2 of 3 or more. */
export function phqPositive(tool: "phq2" | "phq9", score: number): boolean {
  return tool === "phq9" ? score >= 10 : score >= 3;
}

/**
 * CMS2: age 12 and over at start of period. Uses the most recent screen in the period.
 * Met when negative, or positive with a follow-up plan on the screen date or up to two days after.
 */
export function evaluateCms2(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.start);
  if (age === null || age < 12 || !hadVisit(p, period)) return result("CMS2", "not_in_denominator");
  if (p.bipolar) return result("CMS2", "excluded", "bipolar disorder");
  if (p.depressionScreenException) return result("CMS2", "excluded", "screening exception (patient refused or medical reason)");
  const screens = (p.phqResults || []).filter((r) => between(r.date, period.start, period.end));
  if (screens.length === 0) return result("CMS2", "due");
  const last = screens.reduce((a, b) => (b.date > a.date ? b : a));
  if (!phqPositive(last.tool, last.score)) return result("CMS2", "met");
  const until = addDays(last.date, 2);
  const followed = (p.depressionFollowUps || []).some((d) => between(d, last.date, until));
  return result("CMS2", followed ? "met" : "due");
}

/**
 * CMS138 population 3: age 12 and over at start of period, screened at least once in the period,
 * and if the most recent screen shows tobacco use, a cessation intervention in the period or six months before.
 */
export function evaluateCms138(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.start);
  if (age === null || age < 12 || !hadVisit(p, period)) return result("CMS138", "not_in_denominator");
  if (p.hospice) return result("CMS138", "excluded", "hospice");
  const screens = (p.tobaccoScreens || []).filter((s) => between(s.date, period.start, period.end));
  if (screens.length === 0) return result("CMS138", "due");
  const last = screens.reduce((a, b) => (b.date > a.date ? b : a));
  if (!last.user) return result("CMS138", "met");
  const sixBefore = (() => {
    const [y, m, d] = period.start.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1 - 6, d));
    return dt.toISOString().slice(0, 10);
  })();
  const intervened = (p.tobaccoInterventions || []).some((d) => between(d, sixBefore, period.end));
  return result("CMS138", intervened ? "met" : "due");
}

/**
 * CMS347: any of four risk groups. 1 clinical ASCVD (any age); 2 age 20 to 75 at start of period with
 * LDL-C of 190 or more or familial hypercholesterolemia; 3 age 40 to 75 with diabetes; 4 age 40 to 75 with
 * 10-year ASCVD risk of 20 percent or more. Met when a statin is active or ordered in the period.
 */
export function evaluateCms347(p: PanelPatient, period: Period): MeasureResult {
  const age = ageOn(p.birthDate, period.start);
  if (age === null || !hadVisit(p, period)) return result("CMS347", "not_in_denominator");
  const inPop = !!p.ascvd ||
    (age >= 20 && age <= 75 && !!p.ldl190OrFh) ||
    (age >= 40 && age <= 75 && (p.diabetes || !!p.ascvdRisk20));
  if (!inPop) return result("CMS347", "not_in_denominator");
  const ex = (p.breastfeeding ? "breastfeeding" : null) || (p.rhabdomyolysis ? "rhabdomyolysis" : null) ||
    (p.hospice ? "hospice (exception)" : null) || (p.palliativeCare ? "palliative care (exception)" : null) ||
    (p.esrd ? "ESRD (exception)" : null) || (p.statinException ? "statin allergy, muscle symptoms, liver disease, or medical reason (exception)" : null);
  if (ex) return result("CMS347", "excluded", ex);
  return result("CMS347", p.statin ? "met" : "due");
}

export interface CareGapRow extends PanelRow {
  measures: Partial<Record<MeasureId, MeasureResult>>;
  gapsDue: string[];
}

export interface CareGapSummary {
  period: Period;
  label: string;
  rates: MeasureRate[];
  rows: CareGapRow[];
}

const EVALUATORS: Record<MeasureId, (p: PanelPatient, period: Period) => MeasureResult> = {
  CMS165: evaluateCms165,
  CMS122: evaluateCms122,
  CMS125: evaluateCms125,
  CMS130: evaluateCms130,
  CMS124: evaluateCms124,
  CMS2: evaluateCms2,
  CMS138: evaluateCms138,
  CMS347: evaluateCms347,
};

export function evaluateCareGapPanel(
  patients: (PanelPatient & { source?: PanelRow["source"] })[],
  period: Period,
): CareGapSummary {
  const rows: CareGapRow[] = patients.map((p) => {
    const measures: Partial<Record<MeasureId, MeasureResult>> = {};
    for (const id of ALL_MEASURES) measures[id] = EVALUATORS[id](p, period);
    const gapsDue = ALL_MEASURES.filter((id) => measures[id]!.needsOutreach).map((id) => `${id}: ${GAP_TEXT[id]}`);
    return {
      patientId: p.patientId,
      age: ageOn(p.birthDate, period.end),
      sex: p.sex,
      source: p.source || "csv",
      cms165: measures.CMS165!,
      cms122: measures.CMS122!,
      measures,
      gapsDue,
      needsOutreach: gapsDue.length > 0,
    };
  });
  return {
    period,
    label: MEASURE_LABEL,
    rates: ALL_MEASURES.map((id) => rate(id, rows.map((r) => r.measures[id]!))),
    rows,
  };
}

export const CARE_GAP_UNSUPPORTED: string[] = [
  ...UNSUPPORTED_EXCLUSIONS,
  "CMS125: right plus left unilateral mastectomy is only recognized through the bilateral mastectomy flag; the two age strata (42 to 51, 52 to 74) are not reported separately.",
  "CMS130: colorectal cancer and total colectomy rely on yes or no flags; the age strata are not reported separately.",
  "CMS124: hysterectomy with no residual cervix and cervical agenesis rely on the hysterectomy flag; cytology done before age 24 is not filtered out.",
  "CMS2: the measure is screened per qualifying encounter; this panel uses the most recent PHQ-2 or PHQ-9 in the period instead of the 14 days before each encounter. Other standardized tools, adolescent tools, and an active depression medication overlapping the encounter are not recognized. The exception flag covers patient refusal and medical reasons.",
  "CMS138: only population 3 (screened and, if a user, intervention) is shown; populations 1 and 2 and the two-visit or preventive-visit rule are not checked.",
  "CMS347: risk groups rely on ASCVD, LDL 190 or familial hypercholesterolemia, diabetes, and 10-year risk flags; no LDL values or risk calculator are used. Statin is a yes or no flag for active or ordered in the period. Exceptions (hospice, palliative care, ESRD, statin allergy, muscle symptoms, liver disease, medical reason) are removed from the denominator with exclusions.",
];
