/**
 * Cancer screening, wellness check-in, cognitive reminder, and caregiver strain.
 * Screening rates are estimates, not validated CMS measures.
 */

import { daysBetween } from "./logic";

export const CANCER_FOLLOWUP_DAYS = 30;
export const WELLNESS_WINDOW_HOURS = 26;
export const COGNITIVE_INTERVAL_DAYS = 365;
export const COGNITIVE_CONCERN_AT = 2;
export const STRAIN_HIGH_AT = 7;
export const MAMMOGRAM_DAYS = 822;
export const WELLNESS_SMS = "Reply OK if you are well today.";

export interface CareSettings {
  wellness_window_hours: number;
  cancer_followup_days: number;
  cognitive_interval_days: number;
  cognitive_concern_at: number;
  strain_high_at: number;
}

export const DEFAULT_CARE_SETTINGS: CareSettings = {
  wellness_window_hours: WELLNESS_WINDOW_HOURS,
  cancer_followup_days: CANCER_FOLLOWUP_DAYS,
  cognitive_interval_days: COGNITIVE_INTERVAL_DAYS,
  cognitive_concern_at: COGNITIVE_CONCERN_AT,
  strain_high_at: STRAIN_HIGH_AT,
};

export type CancerKind = "colorectal" | "breast" | "cervical";

export interface CancerEvent {
  kind: CancerKind;
  method: string;
  result: "normal" | "abnormal";
  screened_on: string;
  follow_up_on: string | null;
}

export interface WellnessState {
  opted_in: boolean;
  lives_alone: boolean;
  last_ok_at: string | null;
  family_notified_at: string | null;
  team_notified_at: string | null;
}

const METHOD_DAYS: Record<string, number> = {
  fit: 365,
  fit_dna: 365 * 3,
  sigmoidoscopy: 365 * 5,
  colonoscopy: 365 * 10,
  mammogram: MAMMOGRAM_DAYS,
  pap: 365 * 3,
  pap_hpv: 365 * 5,
};

export function methodInWindow(method: string, screenedOn: string, asOf: string): boolean {
  const limit = METHOD_DAYS[method];
  if (!limit) return false;
  const days = daysBetween(asOf, screenedOn);
  return days != null && days >= 0 && days <= limit;
}

export function colorectalMet(events: CancerEvent[], asOf: string): boolean {
  return events.some((event) =>
    event.kind === "colorectal" && methodInWindow(event.method, event.screened_on, asOf),
  );
}

export function breastMet(sex: string | null, age: number | null, events: CancerEvent[], asOf: string): "out" | "met" | "gap" {
  if (sex !== "female" || age == null || age < 52 || age > 74) return "out";
  const met = events.some((event) => event.kind === "breast" && methodInWindow("mammogram", event.screened_on, asOf));
  return met ? "met" : "gap";
}

export function cervicalMet(sex: string | null, age: number | null, events: CancerEvent[], asOf: string): "out" | "met" | "gap" {
  if (sex !== "female" || age == null || age < 21 || age > 64) return "out";
  const met = events.some((event) => {
    if (event.kind !== "cervical") return false;
    if (event.method === "pap_hpv" && age < 30) return false;
    const method = event.method === "pap_hpv" ? "pap_hpv" : "pap";
    return methodInWindow(method, event.screened_on, asOf);
  });
  return met ? "met" : "gap";
}

export function followUpState(event: CancerEvent, asOf: string, overdueDays: number): "closed" | "open" | "overdue" {
  if (event.result !== "abnormal" || event.follow_up_on) return "closed";
  const days = daysBetween(asOf, event.screened_on);
  if (days != null && days > overdueDays) return "overdue";
  return "open";
}

export function wellnessDecision(
  state: WellnessState,
  nowIso: string,
  windowHours: number,
): "ineligible" | "ok" | "escalate_family" | "waiting_on_family" | "escalate_care_team" {
  if (!state.opted_in || !state.lives_alone) return "ineligible";
  const now = Date.parse(nowIso);
  if (Number.isNaN(now)) return "ineligible";
  const windowMs = windowHours * 60 * 60 * 1000;
  const last = state.last_ok_at ? Date.parse(state.last_ok_at) : null;
  if (last != null && !Number.isNaN(last) && now - last <= windowMs) return "ok";
  if (!state.family_notified_at) return "escalate_family";
  const familyAt = Date.parse(state.family_notified_at);
  if (!Number.isNaN(familyAt) && now - familyAt <= windowMs) return "waiting_on_family";
  return "escalate_care_team";
}

export function isWellnessOkReply(body: string): boolean {
  return /^(ok|yes)$/i.test(body.trim());
}

export function cognitiveDue(
  age: number | null,
  screens: Array<{ recorded_on: string }>,
  asOf: string,
  intervalDays: number,
): boolean {
  if (age == null || age < 65) return false;
  return !screens.some((screen) => {
    const days = daysBetween(asOf, screen.recorded_on);
    return days != null && days >= 0 && days <= intervalDays;
  });
}

export function cognitiveConcern(screens: Array<{ score: number; recorded_on: string }>, concernAt: number): boolean {
  const latest = [...screens].sort((a, b) => a.recorded_on.localeCompare(b.recorded_on)).pop();
  return latest != null && latest.score <= concernAt;
}

export function fallsState(
  age: number | null,
  screens: Array<{ recorded_on: string }>,
  asOf: string,
): "out" | "met" | "gap" {
  if (age == null || age < 65) return "out";
  const met = screens.some((screen) => {
    const days = daysBetween(asOf, screen.recorded_on);
    return days != null && days >= 0 && days <= 365;
  });
  return met ? "met" : "gap";
}

export function latestStrain(screens: Array<{ score: number; recorded_on: string }>): number | null {
  const latest = [...screens].sort((a, b) => a.recorded_on.localeCompare(b.recorded_on)).pop();
  return latest ? latest.score : null;
}
