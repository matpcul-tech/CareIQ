import "server-only";

import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";

/**
 * Lab PDF parser.
 *
 * Best-effort extraction of biomarker values from Quest Diagnostics or
 * LabCorp PDF lab reports. Pipeline:
 *
 *   1. unpdf (pdfjs-dist under the hood) extracts text from the PDF.
 *      Imported DYNAMICALLY inside extractTextFromPdf so a failure to
 *      load the package in the Vercel serverless runtime does NOT
 *      cascade into a module-load error on /api/onboard/upload.
 *   2. Per-biomarker regex patterns search the merged text for
 *      "<name> <value> <unit>" sequences and return the canonical
 *      biomarker key + numeric value.
 *   3. Sanity-check the value against a min/max plausibility band so
 *      garbage values (page numbers, reference ranges, dates) never
 *      end up populating the form.
 *
 * Pattern coverage targets the standard panels the two largest US
 * commercial labs return today: lipid panel, basic / comprehensive
 * metabolic panel, A1C, CBC with differential, TSH, vitamin D, B12,
 * ferritin, plus optional add-ons (apoB, Lp(a), hs-CRP, homocysteine,
 * fasting insulin, uric acid, testosterone, DHEA-S, cortisol, IGF-1,
 * omega-3 index).
 *
 * Wearable-only biomarkers (resting_hr, hrv, sleep_score, stress_score),
 * cognitive scores, biological age, grip strength, and VO2 max are NOT
 * pattern-matched here. Those don't appear in standard lab PDFs.
 *
 * Privacy: only the extracted numeric values + canonical keys leave
 * this module. The raw PDF text is parsed in memory and not returned.
 */

interface PatternSpec {
  key: string;
  patterns: RegExp[];
  min: number;
  max: number;
}

function nameAndValue(names: string[], unitPattern: string = ""): RegExp[] {
  return names.map((name) => {
    const safeName = name
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/ /g, "\\s*");
    return new RegExp(
      `${safeName}[\\s,:]*([\\d]+(?:\\.[\\d]+)?)\\s*${unitPattern}`,
      "i",
    );
  });
}

const PATTERNS: PatternSpec[] = [
  // Metabolic
  {
    key: "fasting_glucose",
    patterns: nameAndValue(["Glucose, Fasting", "Fasting Glucose", "Glucose"], "mg/dL"),
    min: 30,
    max: 600,
  },
  {
    key: "fasting_insulin",
    patterns: nameAndValue(["Insulin, Fasting", "Fasting Insulin", "Insulin"], "u?IU/mL|mcIU/mL|µIU/mL"),
    min: 0,
    max: 200,
  },
  {
    key: "a1c",
    patterns: nameAndValue([
      "Hemoglobin A1c",
      "HbA1c",
      "A1C, NGSP",
      "Hemoglobin A1C",
      "A1c",
    ], "%"),
    min: 3,
    max: 20,
  },
  {
    key: "uric_acid",
    patterns: nameAndValue(["Uric Acid", "Urate"], "mg/dL"),
    min: 0.5,
    max: 20,
  },

  // Cardiovascular
  {
    key: "ldl",
    patterns: [
      ...nameAndValue([
        "LDL Cholesterol Calc",
        "LDL Cholesterol",
        "LDL-Cholesterol",
        "LDL Calc",
        "LDL Chol",
      ], "mg/dL"),
      ...nameAndValue(["LDL"], "mg/dL"),
    ],
    min: 5,
    max: 600,
  },
  {
    key: "hdl",
    patterns: nameAndValue([
      "HDL Cholesterol",
      "HDL-Cholesterol",
      "HDL Chol",
      "HDL",
    ], "mg/dL"),
    min: 5,
    max: 200,
  },
  {
    key: "total_cholesterol",
    patterns: nameAndValue([
      "Cholesterol, Total",
      "Total Cholesterol",
      "Cholesterol Total",
      "Cholesterol",
    ], "mg/dL"),
    min: 30,
    max: 600,
  },
  {
    key: "triglycerides",
    patterns: nameAndValue(["Triglycerides"], "mg/dL"),
    min: 5,
    max: 4000,
  },
  {
    key: "vldl",
    patterns: nameAndValue([
      "VLDL Cholesterol Calc",
      "VLDL Cholesterol",
      "VLDL Chol",
      "VLDL",
    ], "mg/dL"),
    min: 1,
    max: 100,
  },
  {
    key: "apob",
    patterns: nameAndValue([
      "Apolipoprotein B",
      "Apo B",
      "ApoB",
      "APO B",
    ], "mg/dL"),
    min: 10,
    max: 400,
  },
  {
    key: "lpa",
    patterns: [
      ...nameAndValue(["Lipoprotein \\(a\\)", "Lipoprotein\\(a\\)"], "nmol/L|mg/dL"),
      ...nameAndValue(["Lp\\(a\\)"], "nmol/L|mg/dL"),
    ],
    min: 0,
    max: 1000,
  },
  {
    key: "hs_crp",
    patterns: nameAndValue([
      "hs-CRP",
      "hsCRP",
      "High Sensitivity CRP",
      "C-Reactive Protein, High Sensitivity",
      "C-Reactive Protein",
      "CRP",
    ], "mg/L"),
    min: 0,
    max: 200,
  },
  {
    key: "homocysteine",
    patterns: nameAndValue(["Homocysteine"], "u?mol/L|µmol/L|mcmol/L"),
    min: 1,
    max: 100,
  },

  // Organ function
  {
    key: "egfr",
    patterns: [
      ...nameAndValue([
        "eGFR Non-African American",
        "eGFR",
        "Estimated GFR",
        "GFR Estimated",
      ], "mL/min(?:/1\\.73)?"),
      ...nameAndValue(["eGFR"], ""),
    ],
    min: 1,
    max: 200,
  },
  {
    key: "creatinine",
    patterns: nameAndValue(["Creatinine"], "mg/dL"),
    min: 0.1,
    max: 15,
  },
  {
    key: "bun",
    patterns: nameAndValue([
      "Urea Nitrogen \\(BUN\\)",
      "BUN",
      "Urea Nitrogen",
    ], "mg/dL"),
    min: 1,
    max: 200,
  },
  {
    key: "alt",
    patterns: nameAndValue([
      "ALT \\(SGPT\\)",
      "ALT",
      "Alanine Aminotransferase",
      "SGPT",
    ], "U/L|IU/L"),
    min: 1,
    max: 1000,
  },
  {
    key: "ast",
    patterns: nameAndValue([
      "AST \\(SGOT\\)",
      "AST",
      "Aspartate Aminotransferase",
      "SGOT",
    ], "U/L|IU/L"),
    min: 1,
    max: 1000,
  },
  {
    key: "albumin",
    patterns: nameAndValue(["Albumin"], "g/dL"),
    min: 1,
    max: 7,
  },
  {
    key: "bilirubin",
    patterns: nameAndValue([
      "Bilirubin, Total",
      "Total Bilirubin",
      "Bilirubin Total",
      "Bilirubin",
    ], "mg/dL"),
    min: 0,
    max: 30,
  },

  // Blood / CBC
  {
    key: "wbc",
    patterns: nameAndValue([
      "WBC",
      "White Blood Cells",
      "White Blood Cell Count",
    ], "(?:x10E3/uL|10\\^3/uL|10x3/uL|K/uL)"),
    min: 1,
    max: 50,
  },
  {
    key: "rbc",
    patterns: nameAndValue([
      "RBC",
      "Red Blood Cells",
      "Red Blood Cell Count",
    ], "(?:x10E6/uL|10\\^6/uL|M/uL)"),
    min: 2,
    max: 8,
  },
  {
    key: "hemoglobin",
    patterns: nameAndValue(["Hemoglobin", "Hgb", "HGB"], "g/dL"),
    min: 5,
    max: 25,
  },
  {
    key: "hematocrit",
    patterns: nameAndValue(["Hematocrit", "Hct", "HCT"], "%"),
    min: 15,
    max: 65,
  },
  {
    key: "platelets",
    patterns: nameAndValue([
      "Platelets",
      "Platelet Count",
      "PLT",
    ], "(?:x10E3/uL|10\\^3/uL|K/uL)"),
    min: 50,
    max: 1000,
  },
  {
    key: "ferritin",
    patterns: nameAndValue(["Ferritin"], "ng/mL"),
    min: 1,
    max: 5000,
  },
  {
    key: "vitamin_b12",
    patterns: nameAndValue([
      "Vitamin B12",
      "Vitamin B-12",
      "B12, Serum",
      "Cobalamin",
    ], "pg/mL"),
    min: 50,
    max: 5000,
  },

  // Hormonal
  {
    key: "testosterone_total",
    patterns: nameAndValue([
      "Testosterone, Total",
      "Total Testosterone",
      "Testosterone Total",
      "Testosterone",
    ], "ng/dL"),
    min: 5,
    max: 2000,
  },
  {
    key: "testosterone_free",
    patterns: nameAndValue([
      "Testosterone, Free",
      "Free Testosterone",
      "Testosterone Free",
    ], "pg/mL"),
    min: 0.1,
    max: 100,
  },
  {
    key: "dhea_s",
    patterns: nameAndValue([
      "DHEA Sulfate",
      "DHEA-S",
      "DHEA Sulfated",
      "Dehydroepiandrosterone Sulfate",
    ], "u?g/dL|mcg/dL|µg/dL"),
    min: 1,
    max: 1500,
  },
  {
    key: "cortisol_am",
    patterns: nameAndValue([
      "Cortisol, AM",
      "Cortisol AM",
      "Cortisol",
    ], "u?g/dL|mcg/dL|µg/dL"),
    min: 0.5,
    max: 60,
  },
  {
    key: "igf1",
    patterns: nameAndValue([
      "IGF-1",
      "IGF 1",
      "Insulin-Like Growth Factor",
      "Somatomedin C",
    ], "ng/mL"),
    min: 10,
    max: 800,
  },
  {
    key: "tsh",
    patterns: nameAndValue([
      "TSH, 3rd Generation",
      "TSH",
      "Thyroid Stimulating Hormone",
      "Thyrotropin",
    ], "u?IU/mL|mIU/L|uIU/mL"),
    min: 0,
    max: 100,
  },
  {
    key: "vitamin_d",
    patterns: nameAndValue([
      "Vitamin D, 25-Hydroxy",
      "Vitamin D 25-OH",
      "25-Hydroxy Vitamin D",
      "Vitamin D",
      "25-OH Vitamin D",
    ], "ng/mL"),
    min: 1,
    max: 200,
  },
  {
    key: "omega3_index",
    patterns: nameAndValue([
      "Omega-3 Index",
      "Omega 3 Index",
    ], "%"),
    min: 0.5,
    max: 20,
  },
];

/**
 * Run unpdf on the byte array and return the merged page text.
 * Returns empty string if extraction fails for any reason.
 *
 * unpdf is loaded via dynamic import on first use so a module-level
 * load failure (e.g., pdfjs-dist incompatibility with the Vercel
 * Node serverless runtime) cannot brick the upload route. Worst
 * case: this function returns "" and PDF parsing is silently skipped.
 */
export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const mod = await import("unpdf");
    const pdf = await mod.getDocumentProxy(bytes);
    const result = await mod.extractText(pdf, { mergePages: true });
    if (typeof result.text === "string") return result.text;
    if (Array.isArray(result.text)) return result.text.join("\n");
    return "";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] unpdf extract failed:", (err as Error)?.message || "unknown");
    return "";
  }
}

/**
 * Apply patterns to extracted PDF text and return canonical biomarker
 * key -> numeric value pairs. Values that fail the per-biomarker
 * plausibility band are dropped. Returns an empty object if no
 * biomarkers matched (PDF was not a recognized lab format).
 */
export function parseBiomarkers(text: string): Record<string, number> {
  if (!text) return {};
  const flat = text.replace(/[ \s]+/g, " ");

  const out: Record<string, number> = {};
  const knownKeys = new Set<string>(BIOMARKER_KEYS);

  for (const spec of PATTERNS) {
    if (!knownKeys.has(spec.key)) continue;
    if (spec.key in out) continue;
    for (const re of spec.patterns) {
      const m = re.exec(flat);
      if (!m) continue;
      const v = Number(m[1]);
      if (!Number.isFinite(v)) continue;
      if (v < spec.min || v > spec.max) continue;
      out[spec.key] = v;
      break;
    }
  }

  return out;
}

export interface ParsePdfResult {
  ok: boolean;
  biomarkers: Record<string, number>;
  text_chars: number;
  reason?: string;
}

/**
 * Convenience entry: takes raw PDF bytes, extracts text, applies
 * biomarker patterns, returns the recognized values. Never throws;
 * returns ok=false with a reason for the upload route to log.
 */
export async function parsePdfBiomarkers(bytes: Uint8Array): Promise<ParsePdfResult> {
  const text = await extractTextFromPdf(bytes);
  if (!text) {
    return { ok: false, biomarkers: {}, text_chars: 0, reason: "extract_failed" };
  }
  const biomarkers = parseBiomarkers(text);
  return {
    ok: Object.keys(biomarkers).length > 0,
    biomarkers,
    text_chars: text.length,
    ...(Object.keys(biomarkers).length === 0 ? { reason: "no_patterns_matched" } : {}),
  };
}
