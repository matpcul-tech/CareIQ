/**
 * On-device scoring for encrypted entries (design doc section 6). Runs in the browser after the
 * patient's data key is unlocked. Only two coarse results leave the device unencrypted:
 * the LE8 band and the alert severity (owner decision 6, approved 2026-11-02). No raw values.
 * Pure functions, no model call, no network.
 */
import { scoreLe8, type Le8Input } from "../le8";
import { evaluateReading } from "../clinic/alerts/rules";
import { DEFAULT_THRESHOLDS } from "../clinic/logic";
import type { AlertSeverity, Le8Band } from "./patient";

export type FormCategory = "profile" | "health_history" | "manual_labs";
export const FORM_CATEGORIES: readonly FormCategory[] = ["profile", "health_history", "manual_labs"];

export interface ProfileData { firstName?: string; lastName?: string; dateOfBirth?: string; sex?: "male" | "female"; communityAffiliation?: string }
export interface HistoryData {
  chronicConditions?: string[];
  le8?: Partial<Pick<Le8Input, "mepa" | "moderateMinutesPerWeek" | "vigorousMinutesPerWeek" | "nicotine" | "livesWithIndoorSmoker" | "sleepHours" | "lipidTreated" | "bpTreated">>;
  [k: string]: unknown;
}
export interface LabsData {
  biomarkers?: Record<string, { value: number; date_collected?: string; source?: string }>;
  bpSystolic?: number; bpDiastolic?: number; weight?: number; height?: number;
}
export interface FormSnapshot { profile?: ProfileData | null; health_history?: HistoryData | null; manual_labs?: LabsData | null }

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function le8InputFromForms(s: FormSnapshot): Le8Input {
  const h = s.health_history?.le8 ?? {};
  const b = s.manual_labs?.biomarkers ?? {};
  const conditions = (s.health_history?.chronicConditions ?? []).map((c) => String(c).toLowerCase());
  return {
    sex: s.profile?.sex ?? "unknown",
    mepa: h.mepa ?? null,
    moderateMinutesPerWeek: num(h.moderateMinutesPerWeek),
    vigorousMinutesPerWeek: num(h.vigorousMinutesPerWeek),
    nicotine: h.nicotine,
    livesWithIndoorSmoker: h.livesWithIndoorSmoker,
    sleepHours: num(h.sleepHours),
    weightLb: num(s.manual_labs?.weight),
    heightIn: num(s.manual_labs?.height),
    totalCholesterol: num(b.total_cholesterol?.value),
    hdl: num(b.hdl?.value),
    lipidTreated: h.lipidTreated,
    a1c: num(b.a1c?.value),
    fastingGlucose: num(b.fasting_glucose?.value),
    diabetesRecorded: conditions.some((c) => c.includes("diabet")),
    bpSystolic: num(s.manual_labs?.bpSystolic),
    bpDiastolic: num(s.manual_labs?.bpDiastolic),
    bpTreated: h.bpTreated,
  };
}

/** LE8 band, or null when not enough of the 8 parts are entered to give a total. */
export function le8BandOnDevice(s: FormSnapshot): Le8Band | null {
  return scoreLe8(le8InputFromForms(s)).band;
}

const ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, informational: 2 };

/**
 * Strongest alert severity for entered labs, using the same rules as the clinic alert queue
 * (src/lib/clinic/alerts/rules.ts) with the default clinic thresholds. A1C at or above the
 * default clinic A1C threshold is informational. Returns null when nothing is flagged.
 */
export function alertSeverityOnDevice(labs: LabsData | null | undefined, today = new Date().toISOString().slice(0, 10)): AlertSeverity | null {
  if (!labs) return null;
  const hits: AlertSeverity[] = [];
  const sys = num(labs.bpSystolic), dia = num(labs.bpDiastolic);
  if (sys !== undefined && dia !== undefined) {
    const r = evaluateReading({ kind: "bp", systolic: sys, diastolic: dia, glucose: null, recorded_on: today }, [], DEFAULT_THRESHOLDS);
    if (r) hits.push(r.severity);
  }
  const g = num(labs.biomarkers?.fasting_glucose?.value);
  if (g !== undefined) {
    const r = evaluateReading({ kind: "glucose", systolic: null, diastolic: null, glucose: g, recorded_on: today }, [], DEFAULT_THRESHOLDS);
    if (r) hits.push(r.severity);
  }
  const a1c = num(labs.biomarkers?.a1c?.value);
  if (a1c !== undefined && a1c >= DEFAULT_THRESHOLDS.a1c) hits.push("informational");
  return hits.sort((a, b) => ORDER[a] - ORDER[b])[0] ?? null;
}

/** Fields for one encrypted form entry. Band and severity are the only readable parts. */
export function coarseFieldsFor(category: FormCategory, snapshot: FormSnapshot): { le8Band: Le8Band | null; alertSeverity: AlertSeverity | null } {
  return {
    le8Band: le8BandOnDevice(snapshot),
    alertSeverity: category === "manual_labs" ? alertSeverityOnDevice(snapshot.manual_labs) : null,
  };
}
