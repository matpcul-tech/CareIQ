/**
 * Informational labels only. These are not LE8 points and not a diagnosis.
 *
 * Glucose categories follow ADA cut points already used in this app:
 * A1C below 5.7 and fasting glucose below 100 are called the normal range.
 * A1C 5.7 to 6.4 or fasting glucose 100 to 125 are called the prediabetes range.
 * A1C 6.5 or more, or fasting glucose 126 or more, are called the diabetes range.
 * If both values are on file and they fall in different ranges, the label
 * uses the higher range. That tie-break is an implementation choice.
 *
 * eGFR stages follow KDIGO 2012 GFR categories:
 * G1 90 or more, G2 60 to 89, G3a 45 to 59, G3b 30 to 44,
 * G4 15 to 29, G5 below 15. Units are mL/min/1.73 m2.
 * The paper's albuminuria axis is not shown because urine albumin is not on file.
 *
 * PREVENT (Khan et al., Circulation. 2024) and a USPSTF screening list
 * are not implemented.
 */

export type GlucoseRangeLabel = "normal" | "prediabetes" | "diabetes";

export function glucoseRangeLabel(input: {
  a1c?: number;
  fastingGlucose?: number;
}): GlucoseRangeLabel | null {
  const a1c = typeof input.a1c === "number" && Number.isFinite(input.a1c) ? input.a1c : undefined;
  const fg = typeof input.fastingGlucose === "number" && Number.isFinite(input.fastingGlucose)
    ? input.fastingGlucose
    : undefined;
  if (a1c === undefined && fg === undefined) return null;
  const diabetes = (a1c !== undefined && a1c >= 6.5) || (fg !== undefined && fg >= 126);
  if (diabetes) return "diabetes";
  const prediabetes = (a1c !== undefined && a1c >= 5.7) || (fg !== undefined && fg >= 100);
  if (prediabetes) return "prediabetes";
  return "normal";
}

export function glucoseRangeSentence(label: GlucoseRangeLabel): string {
  const range = label === "normal" ? "normal" : label === "prediabetes" ? "prediabetes" : "diabetes";
  return [
    `The glucose result on file is in the ${range} range.`,
    "Talk with your care team about this result.",
    "This is general information, not a diagnosis.",
  ].join(" ");
}

export type KdigoGStage = "G1" | "G2" | "G3a" | "G3b" | "G4" | "G5";

export function kdigoGStage(egfr: number): KdigoGStage | null {
  if (!Number.isFinite(egfr)) return null;
  if (egfr >= 90) return "G1";
  if (egfr >= 60) return "G2";
  if (egfr >= 45) return "G3a";
  if (egfr >= 30) return "G3b";
  if (egfr >= 15) return "G4";
  return "G5";
}

export function kdigoSentence(stage: KdigoGStage, egfr: number): string {
  return [
    `eGFR on file is ${Math.round(egfr)}. The KDIGO G category for that number is ${stage}.`,
    "Talk with your care team about this result.",
    "This is general information, not a diagnosis.",
  ].join(" ");
}

/** Inputs for PREVENT and the USPSTF list, built from data already on file. Missing stays missing. */
export interface RiskInputs {
  age?: number | null;
  sex?: "female" | "male" | "unknown";
  totalCholesterol?: number | null;
  hdl?: number | null;
  systolic?: number | null;
  bpTreated?: boolean | null;
  diabetes?: boolean | null;
  currentSmoker?: boolean | null;
  smoking?: "never" | "former" | "current" | "unknown";
  egfr?: number | null;
  statin?: boolean | null;
  bmi?: number | null;
}

type NicotineAnswer = "never" | "quit_5y_or_more" | "quit_1_to_under_5y" | "quit_under_1y_or_nds" | "current_smoker";

export function buildRiskInputs(src: {
  age: number | null;
  sex: "female" | "male" | "unknown";
  labs: { totalCholesterol?: number; hdl?: number; bpSystolic?: number; egfr?: number };
  conditions?: string[] | null;
  nicotine?: NicotineAnswer;
  bpTreated?: boolean;
  lipidTreated?: boolean;
  bmi?: number;
}): RiskInputs {
  const conds = src.conditions ? src.conditions.map((c) => c.toLowerCase()) : null;
  const smoking = src.nicotine === undefined ? "unknown" : src.nicotine === "never" ? "never" : src.nicotine === "current_smoker" ? "current" : "former";
  return {
    age: src.age,
    sex: src.sex,
    totalCholesterol: src.labs.totalCholesterol ?? null,
    hdl: src.labs.hdl ?? null,
    systolic: src.labs.bpSystolic ?? null,
    bpTreated: src.bpTreated ?? null,
    // A recorded diabetes diagnosis. When the conditions list was answered and has none, that is "no".
    diabetes: conds ? conds.some((c) => c.includes("diabet")) : null,
    currentSmoker: smoking === "unknown" ? null : smoking === "current",
    smoking,
    egfr: src.labs.egfr ?? null,
    // The history form asks about cholesterol medicine; PREVENT uses statin use. Closest answer on file.
    statin: src.lipidTreated ?? null,
    bmi: src.bmi ?? null,
  };
}
