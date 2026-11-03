/**
 * Home reading alert rules for the clinic alert queue.
 * General guidance for the care team, not a diagnosis. Pure functions, no model call.
 *
 * Sources:
 *   AHA/ACC 2017 Guideline for High Blood Pressure in Adults, and AHA "Understanding Blood
 *   Pressure Readings": stage 2 is 140 or more systolic or 90 or more diastolic; a reading at or
 *   above 180 and/or 120 calls for prompt follow-up (hypertensive crisis range). The same 180/120
 *   and stage 2 cut points are used by src/lib/local-health/weekly-plan.ts (bpCategory).
 *   ADA Standards of Care, Section 6 (Glycemic Goals and Hypoglycemia): glucose under 54 mg/dL is
 *   level 2 (clinically significant) hypoglycemia. ADA hyperglycemia guidance: glucose over 300 mg/dL
 *   warrants prompt contact with the care team (and ketone checks for type 1).
 *   Existing clinic thresholds (src/lib/clinic/logic.ts readingOutOfRange, default 140/90,
 *   glucose 180 high and 70 low) are kept as the lowest severity rule.
 */

import { bpCategory } from "../../local-health/weekly-plan";
import { daysBetween, readingOutOfRange, type HomeReading, type Thresholds } from "../logic";

export type AlertSeverity = "critical" | "high" | "informational";
export type AlertRule = "bp_crisis" | "bp_stage2_repeated" | "glucose_very_low" | "glucose_very_high" | "clinic_threshold";

export const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, high: 1, informational: 2 };

export const REPEAT_WINDOW_DAYS = 7;
export const REPEAT_COUNT = 2;

export { ALERT_GUIDANCE_LABEL } from "./labels";

export const RULE_TEXT: Record<AlertRule, string> = {
  bp_crisis: "Blood pressure at or above 180/120. Contact the patient promptly.",
  bp_stage2_repeated: `Stage 2 blood pressure (140/90 or higher) on ${REPEAT_COUNT} or more readings within ${REPEAT_WINDOW_DAYS} days.`,
  glucose_very_low: "Glucose under 54 mg/dL (level 2 low). Contact the patient promptly.",
  glucose_very_high: "Glucose over 300 mg/dL. Contact the patient promptly.",
  clinic_threshold: "Reading is outside this clinic's alert thresholds.",
};

export interface AlertCandidate {
  rule: AlertRule;
  severity: AlertSeverity;
}

/**
 * Returns the single strongest alert for a new reading, or null.
 * history is the patient's earlier home readings (the new reading may or may not be included).
 */
export function evaluateReading(
  reading: HomeReading & { id?: string },
  history: (HomeReading & { id?: string })[],
  thresholds: Thresholds,
): AlertCandidate | null {
  if (reading.kind === "bp") {
    const cat = bpCategory(reading.systolic, reading.diastolic);
    if (cat === "very_high") return { rule: "bp_crisis", severity: "critical" };
    if (cat === "stage2") {
      const others = history.filter((h) =>
        h !== reading && (h.id === undefined || h.id !== reading.id) && h.kind === "bp" &&
        (bpCategory(h.systolic, h.diastolic) === "stage2" || bpCategory(h.systolic, h.diastolic) === "very_high") &&
        (() => { const d = daysBetween(reading.recorded_on, h.recorded_on); return d !== null && d >= 0 && d < REPEAT_WINDOW_DAYS; })(),
      );
      if (others.length + 1 >= REPEAT_COUNT) return { rule: "bp_stage2_repeated", severity: "high" };
    }
  } else if (reading.kind === "glucose" && typeof reading.glucose === "number") {
    if (reading.glucose < 54) return { rule: "glucose_very_low", severity: "critical" };
    if (reading.glucose > 300) return { rule: "glucose_very_high", severity: "high" };
  }
  if (readingOutOfRange(reading, thresholds).out) return { rule: "clinic_threshold", severity: "informational" };
  return null;
}
