import "server-only";

/**
 * Longevity biomarker reference table.
 *
 * One entry per biomarker. Each entry is sex-neutral OR has separate male /
 * female threshold sets. The Shield decrypt endpoint merges these into the
 * response so clients render the same zones the server flagged.
 *
 * Range sourcing notes:
 *   - Clinical "normal" ranges follow standard US lab ranges (LabCorp /
 *     Quest defaults).
 *   - "Optimal" ranges follow longevity-medicine targets (broadly aligned
 *     with Attia, Levine, and adjacent practitioners). They are tighter
 *     than clinical normal: a value can be inside normal and still flagged
 *     as suboptimal here.
 *   - For age-dependent biomarkers (DHEA-S, IGF-1) we use representative
 *     middle-age (35-55) ranges. A future phase can age-tier them.
 *   - Cognitive scores (memory / processing speed / executive function)
 *     are normalized to a 0-100 scale; pilot deployments using a
 *     different scale should remap before storing.
 *
 * Editing:
 *   - To override a single threshold per deployment, set the env var
 *     SHIELD_BIOMARKER_OVERRIDES to a JSON object keyed by spec.key, e.g.
 *     {"ldl":{"optimal_high":60}}. getThresholds() will merge it on read.
 */

export type BiomarkerCategory =
  | "metabolic"
  | "cardiovascular"
  | "organ"
  | "blood"
  | "hormonal"
  | "longevity"
  | "cognitive";

export type Sex = "male" | "female" | "unknown";

export type BiomarkerStatus = "ok" | "suboptimal" | "outside_normal" | "unknown";

export type BiomarkerTrend = "improving" | "stable" | "declining" | null;

export interface BiomarkerThresholds {
  normal_low: number | null;
  normal_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
}

interface SexedThresholds {
  male: BiomarkerThresholds;
  female: BiomarkerThresholds;
}

export interface BiomarkerSpec {
  key: string;
  category: BiomarkerCategory;
  label: string;
  unit: string;
  precision: number;
  bar_min: number;
  bar_max: number;
  thresholds: BiomarkerThresholds | SexedThresholds;
  legacy_keys?: string[];
  wearable_field?:
    | "heartRate"
    | "steps"
    | "spo2"
    | "sleepHours"
    | "hrv"
    | "activeCalories"
    | "calories";
}

function t(
  normal_low: number | null,
  normal_high: number | null,
  optimal_low: number | null,
  optimal_high: number | null,
): BiomarkerThresholds {
  return { normal_low, normal_high, optimal_low, optimal_high };
}

export const BIOMARKER_SPECS: BiomarkerSpec[] = [
  // ============ METABOLIC ============
  { key: "fasting_glucose", category: "metabolic", label: "Fasting Glucose", unit: "mg/dL", precision: 0,
    bar_min: 50, bar_max: 200, thresholds: t(70, 99, 75, 85), legacy_keys: ["fastingGlucose"] },
  { key: "fasting_insulin", category: "metabolic", label: "Fasting Insulin", unit: "µIU/mL", precision: 1,
    bar_min: 0, bar_max: 30, thresholds: t(null, 25, 2, 5) },
  { key: "homa_ir", category: "metabolic", label: "HOMA-IR", unit: "", precision: 2,
    bar_min: 0, bar_max: 6, thresholds: t(null, 2.5, null, 1) },
  { key: "a1c", category: "metabolic", label: "A1C", unit: "%", precision: 1,
    bar_min: 4, bar_max: 10, thresholds: t(null, 5.7, null, 5.3) },
  { key: "uric_acid", category: "metabolic", label: "Uric Acid", unit: "mg/dL", precision: 1,
    bar_min: 1, bar_max: 10,
    thresholds: { male: t(3.4, 7.0, null, 5.5), female: t(2.4, 6.0, null, 4.5) } },

  // ============ CARDIOVASCULAR ============
  { key: "ldl", category: "cardiovascular", label: "LDL Cholesterol", unit: "mg/dL", precision: 0,
    bar_min: 30, bar_max: 250, thresholds: t(null, 130, null, 70), legacy_keys: ["ldl"] },
  { key: "hdl", category: "cardiovascular", label: "HDL Cholesterol", unit: "mg/dL", precision: 0,
    bar_min: 20, bar_max: 100,
    thresholds: { male: t(40, null, 60, null), female: t(50, null, 60, null) }, legacy_keys: ["hdl"] },
  { key: "total_cholesterol", category: "cardiovascular", label: "Total Cholesterol", unit: "mg/dL", precision: 0,
    bar_min: 100, bar_max: 320, thresholds: t(null, 200, null, 180), legacy_keys: ["totalCholesterol"] },
  { key: "triglycerides", category: "cardiovascular", label: "Triglycerides", unit: "mg/dL", precision: 0,
    bar_min: 30, bar_max: 400, thresholds: t(null, 150, null, 80), legacy_keys: ["triglycerides"] },
  { key: "apob", category: "cardiovascular", label: "ApoB", unit: "mg/dL", precision: 0,
    bar_min: 30, bar_max: 200, thresholds: t(null, 130, null, 60) },
  { key: "lpa", category: "cardiovascular", label: "Lp(a)", unit: "nmol/L", precision: 0,
    bar_min: 0, bar_max: 200, thresholds: t(null, 75, null, 30) },
  { key: "hs_crp", category: "cardiovascular", label: "hs-CRP", unit: "mg/L", precision: 2,
    bar_min: 0, bar_max: 10, thresholds: t(null, 3, null, 0.5), legacy_keys: ["crp", "hsCrp", "hs_crp"] },
  { key: "homocysteine", category: "cardiovascular", label: "Homocysteine", unit: "µmol/L", precision: 1,
    bar_min: 0, bar_max: 25, thresholds: t(null, 15, null, 7) },
  { key: "vldl", category: "cardiovascular", label: "VLDL", unit: "mg/dL", precision: 0,
    bar_min: 0, bar_max: 60, thresholds: t(null, 30, null, 20) },

  // ============ ORGAN FUNCTION ============
  { key: "egfr", category: "organ", label: "eGFR", unit: "mL/min", precision: 0,
    bar_min: 0, bar_max: 120, thresholds: t(60, null, 90, null), legacy_keys: ["egfr"] },
  { key: "creatinine", category: "organ", label: "Creatinine", unit: "mg/dL", precision: 2,
    bar_min: 0.3, bar_max: 2.0,
    thresholds: { male: t(0.7, 1.3, 0.8, 1.0), female: t(0.6, 1.1, 0.7, 0.9) } },
  { key: "bun", category: "organ", label: "BUN", unit: "mg/dL", precision: 0,
    bar_min: 0, bar_max: 40, thresholds: t(6, 24, 8, 15) },
  { key: "alt", category: "organ", label: "ALT", unit: "U/L", precision: 0,
    bar_min: 0, bar_max: 80,
    thresholds: { male: t(null, 40, null, 20), female: t(null, 40, null, 17) } },
  { key: "ast", category: "organ", label: "AST", unit: "U/L", precision: 0,
    bar_min: 0, bar_max: 80,
    thresholds: { male: t(null, 40, null, 20), female: t(null, 40, null, 17) } },
  { key: "albumin", category: "organ", label: "Albumin", unit: "g/dL", precision: 1,
    bar_min: 2, bar_max: 6, thresholds: t(3.5, 5.0, 4.5, 5.0) },
  { key: "bilirubin", category: "organ", label: "Bilirubin", unit: "mg/dL", precision: 2,
    bar_min: 0, bar_max: 2, thresholds: t(0.1, 1.2, 0.5, 1.0) },

  // ============ BLOOD ============
  { key: "wbc", category: "blood", label: "WBC", unit: "K/µL", precision: 1,
    bar_min: 1, bar_max: 15, thresholds: t(4.0, 11.0, 5.0, 7.0) },
  { key: "rbc", category: "blood", label: "RBC", unit: "M/µL", precision: 2,
    bar_min: 3, bar_max: 7,
    thresholds: { male: t(4.5, 5.9, 5.0, 5.5), female: t(4.1, 5.1, 4.4, 4.8) } },
  { key: "hemoglobin", category: "blood", label: "Hemoglobin", unit: "g/dL", precision: 1,
    bar_min: 8, bar_max: 20,
    thresholds: { male: t(13.5, 17.5, 14.5, 16.0), female: t(12.0, 15.5, 13.0, 14.5) } },
  { key: "hematocrit", category: "blood", label: "Hematocrit", unit: "%", precision: 1,
    bar_min: 25, bar_max: 60,
    thresholds: { male: t(41, 50, 43, 47), female: t(36, 44, 38, 42) } },
  { key: "platelets", category: "blood", label: "Platelets", unit: "K/µL", precision: 0,
    bar_min: 100, bar_max: 500, thresholds: t(150, 450, 200, 300) },
  { key: "ferritin", category: "blood", label: "Ferritin", unit: "ng/mL", precision: 0,
    bar_min: 10, bar_max: 400,
    thresholds: { male: t(24, 336, 50, 150), female: t(11, 307, 40, 120) } },
  { key: "vitamin_b12", category: "blood", label: "Vitamin B12", unit: "pg/mL", precision: 0,
    bar_min: 100, bar_max: 1500, thresholds: t(200, 900, 500, 900) },

  // ============ HORMONAL ============
  { key: "testosterone_total", category: "hormonal", label: "Testosterone (Total)", unit: "ng/dL", precision: 0,
    bar_min: 0, bar_max: 1200,
    thresholds: { male: t(264, 916, 600, 900), female: t(15, 70, 30, 60) } },
  { key: "testosterone_free", category: "hormonal", label: "Testosterone (Free)", unit: "pg/mL", precision: 1,
    bar_min: 0, bar_max: 50,
    thresholds: { male: t(9, 30, 18, 28), female: t(0.6, 4.2, 1.5, 3.5) } },
  { key: "dhea_s", category: "hormonal", label: "DHEA-S", unit: "µg/dL", precision: 0,
    bar_min: 0, bar_max: 600,
    thresholds: { male: t(80, 560, 200, 400), female: t(35, 430, 150, 300) } },
  { key: "cortisol_am", category: "hormonal", label: "Cortisol (AM)", unit: "µg/dL", precision: 1,
    bar_min: 0, bar_max: 30, thresholds: t(6, 23, 10, 15) },
  { key: "igf1", category: "hormonal", label: "IGF-1", unit: "ng/mL", precision: 0,
    bar_min: 50, bar_max: 350, thresholds: t(90, 250, 110, 180) },
  { key: "tsh", category: "hormonal", label: "TSH", unit: "mIU/L", precision: 2,
    bar_min: 0, bar_max: 5, thresholds: t(0.4, 4.5, 0.5, 2.0) },
  { key: "vitamin_d", category: "hormonal", label: "Vitamin D", unit: "ng/mL", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(30, 100, 50, 80) },
  { key: "omega3_index", category: "hormonal", label: "Omega-3 Index", unit: "%", precision: 1,
    bar_min: 0, bar_max: 12, thresholds: t(4, null, 8, null) },

  // ============ LONGEVITY ============
  { key: "biological_age_estimate", category: "longevity", label: "Biological Age", unit: "yrs", precision: 1,
    bar_min: 20, bar_max: 90, thresholds: t(null, null, null, null) },
  { key: "grip_strength", category: "longevity", label: "Grip Strength", unit: "kg", precision: 0,
    bar_min: 0, bar_max: 80,
    thresholds: { male: t(30, null, 50, null), female: t(18, null, 30, null) } },
  { key: "vo2_max", category: "longevity", label: "VO2 Max", unit: "mL/kg/min", precision: 1,
    bar_min: 15, bar_max: 70,
    thresholds: { male: t(35, null, 50, null), female: t(28, null, 42, null) } },
  { key: "resting_hr", category: "longevity", label: "Resting HR", unit: "bpm", precision: 0,
    bar_min: 35, bar_max: 100, thresholds: t(60, 100, 50, 65), wearable_field: "heartRate" },
  { key: "hrv", category: "longevity", label: "HRV", unit: "ms", precision: 0,
    bar_min: 10, bar_max: 150, thresholds: t(30, null, 60, null), wearable_field: "hrv" },
  { key: "sleep_score", category: "longevity", label: "Sleep Score", unit: "/100", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(60, null, 80, null) },
  { key: "stress_score", category: "longevity", label: "Stress Score", unit: "/100", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(null, 60, null, 30) },

  // ============ COGNITIVE ============
  { key: "memory_score", category: "cognitive", label: "Memory", unit: "/100", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(60, null, 80, null) },
  { key: "processing_speed", category: "cognitive", label: "Processing Speed", unit: "/100", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(60, null, 80, null) },
  { key: "executive_function", category: "cognitive", label: "Executive Function", unit: "/100", precision: 0,
    bar_min: 0, bar_max: 100, thresholds: t(60, null, 80, null) },
];

let OVERRIDES_CACHE: Record<string, Partial<BiomarkerThresholds>> | null = null;

function loadOverrides(): Record<string, Partial<BiomarkerThresholds>> {
  if (OVERRIDES_CACHE !== null) return OVERRIDES_CACHE;
  const raw = process.env.SHIELD_BIOMARKER_OVERRIDES;
  if (!raw) {
    OVERRIDES_CACHE = {};
    return OVERRIDES_CACHE;
  }
  try {
    OVERRIDES_CACHE = JSON.parse(raw) as Record<string, Partial<BiomarkerThresholds>>;
  } catch {
    OVERRIDES_CACHE = {};
  }
  return OVERRIDES_CACHE;
}

export function getThresholds(spec: BiomarkerSpec, sex: Sex): BiomarkerThresholds {
  let base: BiomarkerThresholds;
  const tx = spec.thresholds as BiomarkerThresholds | SexedThresholds;
  if ((tx as SexedThresholds).male && (tx as SexedThresholds).female) {
    const sx = tx as SexedThresholds;
    if (sex === "male") base = { ...sx.male };
    else if (sex === "female") base = { ...sx.female };
    else base = unionWidest(sx.male, sx.female);
  } else {
    base = { ...(tx as BiomarkerThresholds) };
  }
  const ov = loadOverrides()[spec.key];
  if (ov) {
    if (ov.normal_low !== undefined) base.normal_low = ov.normal_low;
    if (ov.normal_high !== undefined) base.normal_high = ov.normal_high;
    if (ov.optimal_low !== undefined) base.optimal_low = ov.optimal_low;
    if (ov.optimal_high !== undefined) base.optimal_high = ov.optimal_high;
  }
  return base;
}

function unionWidest(a: BiomarkerThresholds, b: BiomarkerThresholds): BiomarkerThresholds {
  const minOrNull = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : Math.min(x, y);
  const maxOrNull = (x: number | null, y: number | null): number | null =>
    x === null || y === null ? null : Math.max(x, y);
  return {
    normal_low: minOrNull(a.normal_low, b.normal_low),
    normal_high: maxOrNull(a.normal_high, b.normal_high),
    optimal_low: null,
    optimal_high: null,
  };
}

export function computeStatus(
  value: number | null,
  th: BiomarkerThresholds,
): BiomarkerStatus {
  if (value === null) return "unknown";
  const outsideNormalLow = th.normal_low !== null && value < th.normal_low;
  const outsideNormalHigh = th.normal_high !== null && value > th.normal_high;
  if (outsideNormalLow || outsideNormalHigh) return "outside_normal";
  const hasOptimalLow = th.optimal_low !== null;
  const hasOptimalHigh = th.optimal_high !== null;
  if (hasOptimalLow && hasOptimalHigh) {
    if (value >= (th.optimal_low as number) && value <= (th.optimal_high as number)) return "ok";
    return "suboptimal";
  }
  if (hasOptimalLow) {
    if (value >= (th.optimal_low as number)) return "ok";
    return "suboptimal";
  }
  if (hasOptimalHigh) {
    if (value <= (th.optimal_high as number)) return "ok";
    return "suboptimal";
  }
  if (th.normal_low !== null || th.normal_high !== null) return "ok";
  return "unknown";
}

/**
 * Returns the ideal target value for a biomarker based on its thresholds.
 * Used by trend computation to decide which direction is "improving".
 */
export function getTargetCenter(th: BiomarkerThresholds): number | null {
  if (th.optimal_low !== null && th.optimal_high !== null) {
    return (th.optimal_low + th.optimal_high) / 2;
  }
  if (th.optimal_low !== null) return th.optimal_low;
  if (th.optimal_high !== null) return th.optimal_high;
  if (th.normal_low !== null && th.normal_high !== null) {
    return (th.normal_low + th.normal_high) / 2;
  }
  if (th.normal_low !== null) return th.normal_low;
  if (th.normal_high !== null) return th.normal_high;
  return null;
}

/**
 * computeTrend: directional change in distance to target.
 *
 *   improving   value moved closer to its longevity target
 *   declining   value moved further from its target
 *   stable      change smaller than the noise tolerance
 *   null        no thresholds defined and no usable noise floor
 *
 * Noise tolerance defaults to 5% of the larger of |current|, |previous|,
 * which keeps small day-to-day measurement jitter from flipping the trend
 * label every save.
 */
export function computeTrend(
  current: number,
  previous: number,
  th: BiomarkerThresholds,
  noiseTolerancePct = 0.05,
): BiomarkerTrend {
  const target = getTargetCenter(th);
  const noise =
    Math.max(Math.abs(previous), Math.abs(current)) * noiseTolerancePct;

  if (target === null) {
    // No directionality. Report stable when within noise, else null.
    if (Math.abs(current - previous) <= noise) return "stable";
    return null;
  }

  const dPrev = Math.abs(previous - target);
  const dCurr = Math.abs(current - target);
  if (Math.abs(dCurr - dPrev) <= noise) return "stable";
  if (dCurr < dPrev) return "improving";
  return "declining";
}

export const BIOMARKER_KEYS: string[] = BIOMARKER_SPECS.map((s) => s.key);
