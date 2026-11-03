/**
 * Markers and statuses for local copy.
 * Cut points live in ranges.ts. They are not longevity optimal bands.
 */

export type LocalSex = "male" | "female" | "unknown";

export type LocalMarker =
  | "bp"
  | "a1c"
  | "fasting_glucose"
  | "ldl"
  | "triglycerides"
  | "hdl"
  | "tsh"
  | "vitamin_d";

export type LocalStatus =
  | "missing"
  | "in_range"
  | "borderline"
  | "high"
  | "very_high"
  | "low"
  | "outside";

export interface BpReading {
  systolic: number;
  diastolic: number;
}

export type MarkerValue = number | BpReading;
