/**
 * Clinic care circle rules. Pure functions, no database and no model call.
 * CMS165 and CMS122 figures here are estimates, not validated measures.
 * Reading days and minutes are tracking only, not claims submission.
 */

import { redactIdentifiers, replaceKnownNames } from "../shield-redact";

export const OVERDUE_DAYS = 180;
export const MEASUREMENT_DAYS = 365;
export const PREVISIT_WINDOW_DAYS = 30;
export const RPM_READING_DAY_REFERENCE = 16;
export const CARE_MINUTES_REFERENCE = 20;

export const ESTIMATE_LABEL =
  "Estimate only. Not a validated CMS165, CMS122, or UDS measure.";
export const TRACKING_LABEL =
  "Tracking only. Not claims submission. Reference lines are not a billing decision.";

export type StaffRole = "provider" | "ma" | "chw";
export type CircleRole = "admin" | "caregiver" | "viewer" | StaffRole;

export interface Thresholds {
  bp_systolic: number;
  bp_diastolic: number;
  glucose_high: number;
  glucose_low: number;
  a1c: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  bp_systolic: 140,
  bp_diastolic: 90,
  glucose_high: 180,
  glucose_low: 70,
  a1c: 9,
};

export type Actor =
  | { kind: "patient"; patientId: string }
  | { kind: "staff"; clinicId: string; staffId: string; role: StaffRole; revoked?: boolean }
  | { kind: "circle"; clinicPatientId: string; memberId: string; role: CircleRole; revoked?: boolean };

export function canAddMember(actor: Actor): boolean {
  if (actor.kind === "patient") return true;
  if (actor.kind === "circle" && !actor.revoked && actor.role === "admin") return true;
  return false;
}

export function canRevoke(actor: Actor, targetRole: CircleRole): boolean {
  if (actor.kind === "patient") return true;
  if (actor.kind === "circle" && !actor.revoked && actor.role === "admin" && targetRole !== "admin") {
    return true;
  }
  return false;
}

export function canPostConcern(actor: Actor): boolean {
  if (actor.kind === "patient") return true;
  if (actor.kind === "circle" && !actor.revoked && (actor.role === "caregiver" || actor.role === "admin")) {
    return true;
  }
  return false;
}

export function isActiveStaff(actor: Actor): actor is Extract<Actor, { kind: "staff" }> {
  return actor.kind === "staff" && !actor.revoked;
}

export function daysBetween(laterIso: string, earlierIso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(laterIso) || !/^\d{4}-\d{2}-\d{2}$/.test(earlierIso)) return null;
  const later = Date.parse(laterIso + "T00:00:00Z");
  const earlier = Date.parse(earlierIso + "T00:00:00Z");
  if (Number.isNaN(later) || Number.isNaN(earlier)) return null;
  return Math.round((later - earlier) / 86400000);
}

export interface VitalSnapshot {
  a1c: number | null;
  a1c_date: string | null;
  systolic: number | null;
  diastolic: number | null;
  bp_date: string | null;
}

export interface HomeReading {
  kind: "bp" | "glucose";
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
  recorded_on: string;
}

export function effectiveVitals(base: VitalSnapshot, readings: HomeReading[]): VitalSnapshot {
  const bp = readings
    .filter((r) => r.kind === "bp" && r.systolic != null && r.diastolic != null)
    .sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
  const latest = bp[bp.length - 1];
  if (!latest) return base;
  if (base.bp_date && latest.recorded_on < base.bp_date) return base;
  return {
    ...base,
    systolic: latest.systolic,
    diastolic: latest.diastolic,
    bp_date: latest.recorded_on,
  };
}

export function readingOutOfRange(
  reading: HomeReading,
  thresholds: Thresholds,
): { out: boolean; metric: string | null; value: string | null } {
  if (reading.kind === "bp") {
    const sys = reading.systolic;
    const dia = reading.diastolic;
    if (sys == null || dia == null) return { out: false, metric: null, value: null };
    const out = sys >= thresholds.bp_systolic || dia >= thresholds.bp_diastolic;
    return { out, metric: out ? "bp" : null, value: out ? `${sys}/${dia}` : null };
  }
  const g = reading.glucose;
  if (g == null) return { out: false, metric: null, value: null };
  if (g >= thresholds.glucose_high) return { out: true, metric: "glucose_high", value: String(g) };
  if (g <= thresholds.glucose_low) return { out: true, metric: "glucose_low", value: String(g) };
  return { out: false, metric: null, value: null };
}

export interface PanelRow {
  external_id: string;
  age: number | null;
  has_diabetes: boolean;
  has_hypertension: boolean;
  a1c: number | null;
  a1c_date: string | null;
  systolic: number | null;
  diastolic: number | null;
  bp_date: string | null;
  next_visit_date: string | null;
  missed_medication: boolean;
  missed_appointment: boolean;
  home_out_of_range: boolean;
  home_reading_within_30d: boolean;
  last_outcome: string | null;
}

export interface WorklistItem {
  external_id: string;
  rank: number;
  score: number;
  reasons: string[];
  a1c: number | null;
  bp: string | null;
  days_overdue: number;
  last_outcome: string | null;
}

function overdueDays(asOf: string, date: string | null, applies: boolean): number {
  if (!applies) return 0;
  if (!date) return OVERDUE_DAYS + 1;
  const days = daysBetween(asOf, date);
  if (days == null) return OVERDUE_DAYS + 1;
  return days > OVERDUE_DAYS ? days : 0;
}

export function worklistReasons(row: PanelRow, asOf: string): { reasons: string[]; days_overdue: number } {
  const reasons: string[] = [];
  const a1cOver = overdueDays(asOf, row.a1c_date, row.has_diabetes);
  const bpOver = overdueDays(asOf, row.bp_date, row.has_hypertension);
  if (a1cOver > 0) reasons.push("overdue_a1c");
  if (bpOver > 0) reasons.push("overdue_bp");
  if ((row.systolic != null && row.systolic >= 140) || (row.diastolic != null && row.diastolic >= 90)) {
    reasons.push("uncontrolled_bp");
  }
  if (row.a1c != null && row.a1c > 9) reasons.push("uncontrolled_a1c");
  if (row.missed_medication) reasons.push("missed_medication");
  if (row.missed_appointment) reasons.push("missed_appointment");
  if (row.home_out_of_range) reasons.push("home_out_of_range");
  return { reasons, days_overdue: Math.max(a1cOver, bpOver) };
}

export function rankWorklist(rows: PanelRow[], asOf: string): WorklistItem[] {
  const ranked = rows
    .map((row) => {
      const { reasons, days_overdue } = worklistReasons(row, asOf);
      if (reasons.length === 0) return null;
      const uncontrolled = reasons.some((r) => r === "uncontrolled_bp" || r === "uncontrolled_a1c");
      const overdue = reasons.some((r) => r === "overdue_a1c" || r === "overdue_bp");
      const missed = reasons.some((r) => r === "missed_medication" || r === "missed_appointment");
      const score =
        (uncontrolled ? 40 : 0) +
        (overdue ? 30 : 0) +
        (missed ? 20 : 0) +
        (reasons.includes("home_out_of_range") ? 10 : 0) +
        Math.min(days_overdue, 365) / 1000;
      return {
        external_id: row.external_id,
        rank: 0,
        score,
        reasons,
        a1c: row.a1c,
        bp: row.systolic != null && row.diastolic != null ? `${row.systolic}/${row.diastolic}` : null,
        days_overdue,
        last_outcome: row.last_outcome,
      };
    })
    .filter((row): row is WorklistItem => row != null)
    .sort((a, b) => b.score - a.score || a.external_id.localeCompare(b.external_id));
  ranked.forEach((row, index) => {
    row.rank = index + 1;
  });
  return ranked;
}

export interface MeasureEstimate {
  numerator: number;
  denominator: number;
  rate: number | null;
  label: string;
}

function rate(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

export function estimateMeasures(rows: PanelRow[], asOf: string): {
  cms165: MeasureEstimate;
  cms122: MeasureEstimate;
  excluded_missing_age: number;
  label: string;
} {
  let excluded = 0;
  let bpDen = 0;
  let bpNum = 0;
  let a1cDen = 0;
  let a1cNum = 0;
  for (const row of rows) {
    if (row.age == null) {
      if (row.has_diabetes || row.has_hypertension) excluded += 1;
      continue;
    }
    if (row.has_hypertension && row.age >= 18 && row.age <= 85) {
      bpDen += 1;
      const recent = row.bp_date != null && (daysBetween(asOf, row.bp_date) ?? MEASUREMENT_DAYS + 1) <= MEASUREMENT_DAYS;
      const controlled =
        recent &&
        row.systolic != null &&
        row.diastolic != null &&
        row.systolic < 140 &&
        row.diastolic < 90;
      if (controlled) bpNum += 1;
    }
    if (row.has_diabetes && row.age >= 18 && row.age <= 75) {
      a1cDen += 1;
      const recent = row.a1c_date != null && (daysBetween(asOf, row.a1c_date) ?? MEASUREMENT_DAYS + 1) <= MEASUREMENT_DAYS;
      const poor = !recent || row.a1c == null || row.a1c > 9;
      if (poor) a1cNum += 1;
    }
  }
  return {
    cms165: {
      numerator: bpNum,
      denominator: bpDen,
      rate: rate(bpNum, bpDen),
      label: "CMS165 blood pressure control estimate. " + ESTIMATE_LABEL,
    },
    cms122: {
      numerator: a1cNum,
      denominator: a1cDen,
      rate: rate(a1cNum, a1cDen),
      label: "CMS122 A1c poor control estimate. Lower is better. " + ESTIMATE_LABEL,
    },
    excluded_missing_age: excluded,
    label: ESTIMATE_LABEL,
  };
}

export function preVisitGaps(row: PanelRow, asOf: string): string[] {
  const { reasons } = worklistReasons(row, asOf);
  const gaps = [...reasons];
  if (!row.home_reading_within_30d) gaps.push("no_home_reading_30d");
  return gaps;
}

export function visitIsSoon(nextVisit: string | null, asOf: string): boolean {
  if (!nextVisit) return false;
  const days = daysBetween(nextVisit, asOf);
  if (days == null) return false;
  return days >= -7 && days <= PREVISIT_WINDOW_DAYS;
}

export function trackingSummary(readingDates: string[], minutes: number, month: string): {
  month: string;
  reading_days: number;
  reading_day_reference: number;
  minutes: number;
  minutes_reference: number;
  label: string;
} {
  const days = new Set(readingDates.filter((d) => d.startsWith(month)));
  return {
    month,
    reading_days: days.size,
    reading_day_reference: RPM_READING_DAY_REFERENCE,
    minutes,
    minutes_reference: CARE_MINUTES_REFERENCE,
    label: TRACKING_LABEL,
  };
}

const CSV_COLUMNS = [
  "external_id",
  "age",
  "has_diabetes",
  "has_hypertension",
  "last_a1c",
  "last_a1c_date",
  "bp_systolic",
  "bp_diastolic",
  "last_bp_date",
  "next_visit_date",
  "patient_id",
] as const;

export interface CsvPatient {
  external_id: string;
  age: number | null;
  has_diabetes: boolean;
  has_hypertension: boolean;
  last_a1c: number | null;
  last_a1c_date: string | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  last_bp_date: string | null;
  next_visit_date: string | null;
  patient_id: string | null;
}

function parseBool(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "yes" || v === "true" || v === "1" || v === "y";
}

function parseNum(value: string): number | null {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function parseRegistryCsv(text: string): { rows: CsvPatient[] } | { error: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { error: "csv needs a header and one row" };
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const allowed = new Set<string>(CSV_COLUMNS);
  for (const column of header) {
    if (!allowed.has(column)) return { error: `column not allowed: ${column}` };
  }
  if (!header.includes("external_id")) return { error: "external_id is required" };
  const rows: CsvPatient[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const rec: Record<string, string> = {};
    header.forEach((key, index) => {
      rec[key] = (cells[index] || "").trim();
    });
    const external = rec.external_id || "";
    if (!external) return { error: "external_id is empty" };
    if (/\d{3}-\d{2}-\d{4}/.test(external) || /@/.test(external)) {
      return { error: "external_id must not be an email or SSN" };
    }
    const age = parseNum(rec.age || "");
    rows.push({
      external_id: external.slice(0, 64),
      age: age == null ? null : Math.round(age),
      has_diabetes: parseBool(rec.has_diabetes || ""),
      has_hypertension: parseBool(rec.has_hypertension || ""),
      last_a1c: parseNum(rec.last_a1c || ""),
      last_a1c_date: parseDate(rec.last_a1c_date || ""),
      bp_systolic: parseNum(rec.bp_systolic || ""),
      bp_diastolic: parseNum(rec.bp_diastolic || ""),
      last_bp_date: parseDate(rec.last_bp_date || ""),
      next_visit_date: parseDate(rec.next_visit_date || ""),
      patient_id: rec.patient_id ? rec.patient_id : null,
    });
  }
  return { rows };
}

export function maskForModel(text: string, knownNames: string[]): string {
  return redactIdentifiers(replaceKnownNames(text, knownNames));
}

export function circleModelPayload(
  parts: Array<{ label: string; text: string }>,
  knownNames: string[],
): string {
  const lines = parts.map((part) => `${part.label}: ${maskForModel(part.text, knownNames)}`);
  return [
    "Clinic circle summary (reduced):",
    ...lines,
    "",
    "Summarize in 3 sentences for a clinic care team. Do not invent identifiers.",
  ].join("\n");
}
