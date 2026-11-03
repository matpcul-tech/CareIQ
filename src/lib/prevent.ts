/**
 * AHA PREVENT 10-year total cardiovascular disease risk, base model.
 *
 * Source: Khan SS, Matsushita K, Sang Y, et al. Development and Validation of the American Heart
 * Association's Predicting Risk of cardiovascular disease EVENTs (PREVENT) Equations.
 * Circulation. 2024;149:430-449 (published online November 10, 2023).
 * doi:10.1161/CIRCULATIONAHA.123.067626. Base model coefficients, supplemental Table S12A.
 *
 * Valid for ages 30 to 79. The model has no race term. Runs on the device from data already on
 * file; nothing is sent anywhere. General information, not a diagnosis.
 */

export interface PreventInputs {
  age?: number | null;
  sex?: "female" | "male" | "unknown" | null;
  totalCholesterol?: number | null; // mg/dL
  hdl?: number | null; // mg/dL
  systolic?: number | null; // mmHg
  bpTreated?: boolean | null;
  diabetes?: boolean | null;
  currentSmoker?: boolean | null;
  egfr?: number | null; // mL/min/1.73 m2
  statin?: boolean | null;
}

type Coef = {
  age: number; nonHdl: number; hdl: number; sbpLt110: number; sbpGte110: number; dm: number; smoking: number;
  egfrLt60: number; egfrGte60: number; bpTx: number; statin: number; bpTxSbp: number; statinNonHdl: number;
  ageNonHdl: number; ageHdl: number; ageSbp: number; ageDm: number; ageSmoking: number; ageEgfrLt60: number; constant: number;
};

/** 10-year total CVD, base model (Table S12A). */
export const PREVENT_TOTAL_CVD_10YR: Record<"female" | "male", Coef> = {
  female: {
    age: 0.7939329, nonHdl: 0.0305239, hdl: -0.1606857, sbpLt110: -0.2394003, sbpGte110: 0.3600781,
    dm: 0.8667604, smoking: 0.5360739, egfrLt60: 0.6045917, egfrGte60: 0.0433769, bpTx: 0.3151672,
    statin: -0.1477655, bpTxSbp: -0.0663612, statinNonHdl: 0.1197879, ageNonHdl: -0.0819715,
    ageHdl: 0.0306769, ageSbp: -0.0946348, ageDm: -0.27057, ageSmoking: -0.078715, ageEgfrLt60: -0.1637806,
    constant: -3.307728,
  },
  male: {
    age: 0.7688528, nonHdl: 0.0736174, hdl: -0.0954431, sbpLt110: -0.4347345, sbpGte110: 0.3362658,
    dm: 0.7692857, smoking: 0.4386871, egfrLt60: 0.5378979, egfrGte60: 0.0164827, bpTx: 0.288879,
    statin: -0.1337349, bpTxSbp: -0.0475924, statinNonHdl: 0.150273, ageNonHdl: -0.0517874,
    ageHdl: 0.0191169, ageSbp: -0.1049477, ageDm: -0.2251948, ageSmoking: -0.0895067, ageEgfrLt60: -0.1543702,
    constant: -3.031168,
  },
};

/** Input ranges the equations were built for. */
export const PREVENT_RANGES = {
  age: [30, 79], totalCholesterol: [130, 320], hdl: [20, 100], systolic: [90, 180], egfr: [15, 140],
} as const;

const LABELS: Record<keyof PreventInputs, string> = {
  age: "age (date of birth)", sex: "sex", totalCholesterol: "total cholesterol", hdl: "HDL cholesterol",
  systolic: "systolic blood pressure", bpTreated: "whether you take blood pressure medicine",
  diabetes: "diabetes status", currentSmoker: "smoking status", egfr: "eGFR (kidney filtration)",
  statin: "whether you take a statin or cholesterol medicine",
};

const MG_TO_MMOL = 0.02586;

export type PreventResult =
  | { ok: true; risk: number; percent: string; category: "low" | "borderline" | "intermediate" | "high" }
  | { ok: false; missing: string[]; outOfRange: string[] };

/** AHA PREVENT categories: under 5% low, 5 to under 7.5% borderline, 7.5 to under 20% intermediate, 20% or more high. */
export function preventCategory(risk: number) {
  if (risk < 0.05) return "low" as const;
  if (risk < 0.075) return "borderline" as const;
  if (risk < 0.2) return "intermediate" as const;
  return "high" as const;
}

export function preventTotalCvd10(input: PreventInputs): PreventResult {
  const missing: string[] = [];
  const outOfRange: string[] = [];
  const num = (k: "age" | "totalCholesterol" | "hdl" | "systolic" | "egfr") => {
    const v = input[k];
    if (typeof v !== "number" || !Number.isFinite(v)) { missing.push(LABELS[k]); return NaN; }
    const [lo, hi] = PREVENT_RANGES[k];
    if (v < lo || v > hi) outOfRange.push(`${LABELS[k]} must be ${lo} to ${hi}`);
    return v;
  };
  const bool = (k: "bpTreated" | "diabetes" | "currentSmoker" | "statin") => {
    const v = input[k];
    if (typeof v !== "boolean") { missing.push(LABELS[k]); return false; }
    return v;
  };
  const age = num("age");
  if (input.sex !== "female" && input.sex !== "male") missing.push(LABELS.sex);
  const tc = num("totalCholesterol");
  const hdlMg = num("hdl");
  const sbp = num("systolic");
  const bpTx = bool("bpTreated");
  const dm = bool("diabetes");
  const smoke = bool("currentSmoker");
  const egfr = num("egfr");
  const statin = bool("statin");
  if (missing.length || outOfRange.length) return { ok: false, missing, outOfRange };
  const c = PREVENT_TOTAL_CVD_10YR[input.sex as "female" | "male"];

  const a = (age - 55) / 10;
  const nonHdl = (tc - hdlMg) * MG_TO_MMOL - 3.5;
  const hdl = (hdlMg * MG_TO_MMOL - 1.3) / 0.3;
  const sbpLt = (Math.min(sbp, 110) - 110) / 20;
  const sbpGte = (Math.max(sbp, 110) - 130) / 20;
  const eLt = (Math.min(egfr, 60) - 60) / -15;
  const eGte = (Math.max(egfr, 60) - 90) / -15;
  const d = dm ? 1 : 0, s = smoke ? 1 : 0, bt = bpTx ? 1 : 0, st = statin ? 1 : 0;

  const x = c.constant + c.age * a + c.nonHdl * nonHdl + c.hdl * hdl + c.sbpLt110 * sbpLt + c.sbpGte110 * sbpGte
    + c.dm * d + c.smoking * s + c.egfrLt60 * eLt + c.egfrGte60 * eGte + c.bpTx * bt + c.statin * st
    + c.bpTxSbp * bt * sbpGte + c.statinNonHdl * st * nonHdl
    + c.ageNonHdl * a * nonHdl + c.ageHdl * a * hdl + c.ageSbp * a * sbpGte + c.ageDm * a * d
    + c.ageSmoking * a * s + c.ageEgfrLt60 * a * eLt;
  const risk = Math.exp(x) / (1 + Math.exp(x));
  return { ok: true, risk, percent: `${(Math.round(risk * 1000) / 10).toFixed(1)}%`, category: preventCategory(risk) };
}

export const PREVENT_SOURCE = {
  label: "Khan SS, et al. Circulation. 2024;149:430-449 (AHA PREVENT equations)",
  url: "https://doi.org/10.1161/CIRCULATIONAHA.123.067626",
};
