/**
 * Published cut points for local status labels.
 *
 * Blood pressure: 130/80 and 140/90 (ACC/AHA 2017).
 * A1C: 5.7 and 6.5 (ADA).
 * Fasting glucose: 100 and 126 mg/dL (ADA).
 * LDL: 130, 160, and 190 mg/dL (NCEP ATP III).
 * Triglycerides: 150, 200, and 500 mg/dL (NCEP).
 * HDL: below 40 for men, below 50 for women. Unknown sex uses 40.
 * TSH: 0.4 to 4.5. Copy says only "outside the typical lab range".
 * Vitamin D: below 20 ng/mL, with soft wording.
 *
 * A value inside a wider published span is "in_range" here even when a
 * longevity optimal band would call it suboptimal. This file does not
 * read src/lib/biomarker-ranges.ts.
 */

import type { BpReading, LocalMarker, LocalSex, LocalStatus, MarkerValue } from "./types";

export const BP_STAGE_1 = { systolic: 130, diastolic: 80 } as const;
export const BP_STAGE_2 = { systolic: 140, diastolic: 90 } as const;
export const A1C_LOWER = 5.7;
export const A1C_UPPER = 6.5;
export const GLUCOSE_LOWER = 100;
export const GLUCOSE_UPPER = 126;
export const LDL_BORDERLINE = 130;
export const LDL_HIGH = 160;
export const LDL_VERY_HIGH = 190;
export const TG_BORDERLINE = 150;
export const TG_HIGH = 200;
export const TG_VERY_HIGH = 500;
export const HDL_MALE_OR_UNKNOWN = 40;
export const HDL_FEMALE = 50;
export const TSH_LOW = 0.4;
export const TSH_HIGH = 4.5;
export const VITAMIN_D_LOW = 20;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function isBp(value: MarkerValue): value is BpReading {
  return typeof value === "object" && value !== null && "systolic" in value && "diastolic" in value;
}

export function hdlCut(sex: LocalSex = "unknown"): number {
  return sex === "female" ? HDL_FEMALE : HDL_MALE_OR_UNKNOWN;
}

export function statusOf(
  key: LocalMarker,
  value: MarkerValue | null | undefined,
  sex: LocalSex = "unknown",
): LocalStatus {
  if (value == null) return "missing";

  if (key === "bp") {
    if (!isBp(value) || !finite(value.systolic) || !finite(value.diastolic)) return "missing";
    if (value.systolic >= BP_STAGE_2.systolic || value.diastolic >= BP_STAGE_2.diastolic) return "high";
    if (value.systolic >= BP_STAGE_1.systolic || value.diastolic >= BP_STAGE_1.diastolic) return "borderline";
    return "in_range";
  }

  if (typeof value !== "number" || !finite(value)) return "missing";

  switch (key) {
    case "a1c":
      if (value >= A1C_UPPER) return "high";
      if (value >= A1C_LOWER) return "borderline";
      return "in_range";
    case "fasting_glucose":
      if (value >= GLUCOSE_UPPER) return "high";
      if (value >= GLUCOSE_LOWER) return "borderline";
      return "in_range";
    case "ldl":
      if (value >= LDL_VERY_HIGH) return "very_high";
      if (value >= LDL_HIGH) return "high";
      if (value >= LDL_BORDERLINE) return "borderline";
      return "in_range";
    case "triglycerides":
      if (value >= TG_VERY_HIGH) return "very_high";
      if (value >= TG_HIGH) return "high";
      if (value >= TG_BORDERLINE) return "borderline";
      return "in_range";
    case "hdl":
      return value < hdlCut(sex) ? "low" : "in_range";
    case "tsh":
      return value < TSH_LOW || value > TSH_HIGH ? "outside" : "in_range";
    case "vitamin_d":
      return value < VITAMIN_D_LOW ? "low" : "in_range";
    default:
      return "missing";
  }
}
