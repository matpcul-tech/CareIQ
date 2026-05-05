import "server-only";

import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";

/**
 * Universal lab PDF parser.
 *
 * Vendor-agnostic: works on Quest, LabCorp, Physicians Lab, Boston Heart,
 * Cleveland HeartLab, Genova, DUTCH, ZRT, and any other lab whose PDF
 * extracts as text where each test row contains a recognizable name +
 * numeric value (and optionally a unit and reference range).
 *
 * Pipeline:
 *   1. unpdf extracts text. Loaded dynamically so a runtime failure to
 *      load the package cannot brick the upload route.
 *   2. Split into lines. Drop lines that match SKIP_LINE_PATTERNS
 *      ("reference range", "below detection limit", "<LOQ", "unable to
 *      calculate", "ratio", etc.).
 *   3. For each remaining line: strip an optional leading test-code
 *      (e.g. Quest's "001  Glucose ..."), then extract:
 *         name  = text before the first standalone number
 *         value = first standalone decimal that isn't part of a date
 *         unit  = first unit-shaped token after the value
 *   4. Normalize the name (lowercase, collapse whitespace, drop
 *      parentheticals + suffixes after comma) and look it up against a
 *      flat synonym table built from BIOMARKER_SPECS. Longer patterns
 *      win, primary > alias.
 *   5. Sanity-check the value against the per-biomarker plausibility
 *      band; reject otherwise (avoids picking up reference ranges or
 *      page numbers).
 *   6. Compute confidence:
 *         high   primary tier + unit matches expected + value in band
 *         medium alias tier OR unit doesn't match the expected list
 *         low    fuzzy-only OR value at the band edge
 *      For duplicate biomarker matches across multiple lines, the
 *      highest-confidence match wins.
 *
 * Output (back-compat with the existing /api/onboard/upload contract):
 *   biomarkers      Record<key, number>             plain map for client form auto-fill
 *   confidence      Record<key, "high"|"medium"|"low">  per-biomarker confidence
 *   details         ExtractedBiomarker[]            full extraction trace (raw line, raw
 *                                                   name, unit) for audit / debugging
 *
 * Wearable-only biomarkers (resting_hr, hrv, sleep_score, stress_score),
 * cognitive scores, biological age, grip strength, and VO2 max are NOT
 * synonymed here. Those don't appear in standard lab PDFs.
 */

export type Confidence = "high" | "medium" | "low";

export interface ExtractedBiomarker {
  key: string;
  value: number;
  unit: string;
  raw_name: string;
  raw_line: string;
  confidence: Confidence;
  tier: "primary" | "alias";
}

interface Spec {
  key: string;
  primary: string[];
  aliases: string[];
  units: string[];
  min: number;
  max: number;
}

const SPECS: Spec[] = [
  // ============ METABOLIC ============
  {
    key: "fasting_glucose",
    primary: ["fasting glucose", "glucose fasting", "glucose, fasting", "glucose plasma fasting"],
    aliases: ["glucose", "plasma glucose", "blood glucose", "blood sugar"],
    units: ["mg/dl"],
    min: 30, max: 600,
  },
  {
    key: "fasting_insulin",
    primary: ["fasting insulin", "insulin fasting", "insulin, fasting"],
    aliases: ["insulin"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"],
    min: 0, max: 200,
  },
  {
    key: "homa_ir",
    primary: ["homa-ir", "homa ir", "homair"],
    aliases: ["insulin resistance index", "homa index", "insulin resistance"],
    units: [],
    min: 0, max: 50,
  },
  {
    key: "a1c",
    primary: ["hemoglobin a1c", "hba1c", "a1c", "a1c, ngsp"],
    aliases: ["glycated hemoglobin", "glycohemoglobin"],
    units: ["%"],
    min: 3, max: 20,
  },
  {
    key: "uric_acid",
    primary: ["uric acid"],
    aliases: ["urate", "serum uric acid"],
    units: ["mg/dl"],
    min: 0.5, max: 20,
  },
  // ============ CARDIOVASCULAR ============
  {
    key: "ldl",
    primary: ["ldl cholesterol", "ldl-c", "ldl chol", "ldl calc", "ldl cholesterol calc", "ldl-cholesterol"],
    aliases: ["ldl", "low density lipoprotein", "low-density lipoprotein"],
    units: ["mg/dl"],
    min: 5, max: 600,
  },
  {
    key: "hdl",
    primary: ["hdl cholesterol", "hdl-c", "hdl chol", "hdl-cholesterol"],
    aliases: ["hdl", "high density lipoprotein", "high-density lipoprotein"],
    units: ["mg/dl"],
    min: 5, max: 200,
  },
  {
    key: "total_cholesterol",
    primary: ["cholesterol total", "total cholesterol", "cholesterol, total"],
    aliases: ["cholesterol", "serum cholesterol"],
    units: ["mg/dl"],
    min: 30, max: 600,
  },
  {
    key: "triglycerides",
    primary: ["triglycerides", "triglycerides serum"],
    aliases: ["trig", "triglyceride", "tg"],
    units: ["mg/dl"],
    min: 5, max: 4000,
  },
  {
    key: "vldl",
    primary: ["vldl cholesterol", "vldl-c", "vldl chol", "vldl cholesterol calc"],
    aliases: ["vldl", "very low density lipoprotein", "very-low-density lipoprotein"],
    units: ["mg/dl"],
    min: 1, max: 100,
  },
  {
    key: "apob",
    primary: ["apolipoprotein b", "apo b", "apob", "apo-b"],
    aliases: [],
    units: ["mg/dl"],
    min: 10, max: 400,
  },
  {
    key: "lpa",
    primary: ["lipoprotein a", "lp a", "lp(a)", "lipoprotein(a)", "lipoprotein little a"],
    aliases: ["lpa"],
    units: ["nmol/l", "mg/dl"],
    min: 0, max: 1000,
  },
  {
    key: "hs_crp",
    primary: [
      "hs-crp", "hscrp", "hs crp",
      "high sensitivity crp", "high-sensitivity crp",
      "c-reactive protein high sensitivity",
      "c-reactive protein, high sensitivity",
      "c-reactive protein hs",
    ],
    aliases: ["c-reactive protein", "crp", "c reactive protein"],
    units: ["mg/l"],
    min: 0, max: 200,
  },
  {
    key: "homocysteine",
    primary: ["homocysteine"],
    aliases: ["hcy"],
    units: ["umol/l", "µmol/l", "mcmol/l"],
    min: 1, max: 100,
  },
  // ============ ORGAN FUNCTION ============
  {
    key: "egfr",
    primary: ["egfr", "estimated gfr", "gfr estimated", "egfr non-african american", "egfr if non-african american"],
    aliases: ["glomerular filtration rate", "gfr"],
    units: ["ml/min", "ml/min/1.73", "ml/min/1.73m2"],
    min: 1, max: 200,
  },
  {
    key: "creatinine",
    primary: ["creatinine"],
    aliases: ["creat", "serum creatinine"],
    units: ["mg/dl"],
    min: 0.1, max: 15,
  },
  {
    key: "bun",
    primary: ["bun", "urea nitrogen", "blood urea nitrogen", "urea nitrogen (bun)"],
    aliases: ["urea"],
    units: ["mg/dl"],
    min: 1, max: 200,
  },
  {
    key: "alt",
    primary: ["alt", "alt (sgpt)", "sgpt", "alanine aminotransferase", "alanine transaminase"],
    aliases: ["alanine aminotransferase alt"],
    units: ["u/l", "iu/l"],
    min: 1, max: 1000,
  },
  {
    key: "ast",
    primary: ["ast", "ast (sgot)", "sgot", "aspartate aminotransferase", "aspartate transaminase"],
    aliases: ["aspartate aminotransferase ast"],
    units: ["u/l", "iu/l"],
    min: 1, max: 1000,
  },
  {
    key: "albumin",
    primary: ["albumin"],
    aliases: ["alb", "serum albumin"],
    units: ["g/dl"],
    min: 1, max: 7,
  },
  {
    key: "bilirubin",
    primary: ["bilirubin total", "total bilirubin", "bilirubin, total"],
    aliases: ["bilirubin", "t bili", "tbili"],
    units: ["mg/dl"],
    min: 0, max: 30,
  },
  // ============ BLOOD ============
  {
    key: "wbc",
    primary: ["wbc", "white blood cell count", "white blood cells"],
    aliases: ["leukocytes", "leukocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"],
    min: 1, max: 50,
  },
  {
    key: "rbc",
    primary: ["rbc", "red blood cell count", "red blood cells"],
    aliases: ["erythrocytes", "erythrocyte count"],
    units: ["m/ul", "10^6/ul", "x10e6/ul"],
    min: 2, max: 8,
  },
  {
    key: "hemoglobin",
    primary: ["hemoglobin", "hgb", "hb"],
    aliases: ["haemoglobin"],
    units: ["g/dl"],
    min: 5, max: 25,
  },
  {
    key: "hematocrit",
    primary: ["hematocrit", "hct"],
    aliases: ["haematocrit", "pcv", "packed cell volume"],
    units: ["%"],
    min: 15, max: 65,
  },
  {
    key: "platelets",
    primary: ["platelets", "platelet count", "plt"],
    aliases: ["thrombocytes", "thrombocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"],
    min: 50, max: 1000,
  },
  {
    key: "ferritin",
    primary: ["ferritin"],
    aliases: ["serum ferritin"],
    units: ["ng/ml"],
    min: 1, max: 5000,
  },
  {
    key: "vitamin_b12",
    primary: ["vitamin b12", "vitamin b-12", "b12 serum", "b12, serum", "b12"],
    aliases: ["cobalamin"],
    units: ["pg/ml"],
    min: 50, max: 5000,
  },
  // ============ HORMONAL ============
  {
    key: "testosterone_total",
    primary: ["testosterone total", "total testosterone", "testosterone, total"],
    aliases: ["testosterone", "serum testosterone"],
    units: ["ng/dl"],
    min: 5, max: 2000,
  },
  {
    key: "testosterone_free",
    primary: ["testosterone free", "free testosterone", "testosterone, free"],
    aliases: [],
    units: ["pg/ml", "ng/dl"],
    min: 0.1, max: 100,
  },
  {
    key: "dhea_s",
    primary: [
      "dhea-s", "dhea sulfate", "dheas", "dhea-sulfate",
      "dhea sulfated", "dhea-sulphate",
    ],
    aliases: [
      "dehydroepiandrosterone sulfate",
      "dehydroepiandrosterone-sulfate",
      "dehydroepiandrosterone sulphate",
    ],
    units: ["ug/dl", "mcg/dl", "µg/dl"],
    min: 1, max: 1500,
  },
  {
    key: "cortisol_am",
    primary: [
      "cortisol am", "cortisol, am",
      "morning cortisol", "waking cortisol",
      "cortisol morning", "diurnal cortisol am",
      "a.m. cortisol", "am cortisol",
    ],
    aliases: ["cortisol", "serum cortisol"],
    units: ["ug/dl", "mcg/dl", "µg/dl"],
    min: 0.5, max: 60,
  },
  {
    key: "igf1",
    primary: [
      "igf-1", "igf 1", "igf1",
      "insulin-like growth factor 1",
      "insulin like growth factor 1",
      "insulin-like growth factor-1",
    ],
    aliases: ["somatomedin c", "somatomedin-c"],
    units: ["ng/ml"],
    min: 10, max: 800,
  },
  {
    key: "tsh",
    primary: [
      "tsh", "tsh, 3rd generation", "tsh 3rd generation",
      "thyroid stimulating hormone", "thyrotropin",
    ],
    aliases: ["thyroid-stimulating hormone"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"],
    min: 0, max: 100,
  },
  {
    key: "vitamin_d",
    primary: [
      "vitamin d 25-hydroxy",
      "25-hydroxy vitamin d",
      "vitamin d, 25-oh",
      "vitamin d 25-oh",
      "25-oh vitamin d",
      "25(oh)d",
      "25 hydroxy vitamin d",
    ],
    aliases: ["vitamin d", "calcidiol", "vit d"],
    units: ["ng/ml"],
    min: 1, max: 200,
  },
  {
    key: "omega3_index",
    primary: ["omega-3 index", "omega 3 index", "o3i"],
    aliases: ["omega-3 fatty acid index"],
    units: ["%"],
    min: 0.5, max: 20,
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

interface FlatSyn {
  pattern: string;
  key: string;
  tier: "primary" | "alias";
  spec: Spec;
}

const SYNONYMS: FlatSyn[] = (() => {
  const out: FlatSyn[] = [];
  for (const spec of SPECS) {
    for (const p of spec.primary) {
      out.push({ pattern: normalize(p), key: spec.key, tier: "primary", spec });
    }
    for (const a of spec.aliases) {
      out.push({ pattern: normalize(a), key: spec.key, tier: "alias", spec });
    }
  }
  // Longer patterns first so "hdl cholesterol" matches before "hdl".
  out.sort((a, b) => b.pattern.length - a.pattern.length);
  return out;
})();

const SKIP_LINE_PATTERNS: RegExp[] = [
  /\bbelow\s+detection\s+limit\b/i,
  /\bunable\s+to\s+calculate\b/i,
  /\bnot\s+detect(?:ed|able)\b/i,
  /\bnot\s+established\b/i,
  /\bbelow\s+lod\b/i,
  /<\s*lo[qd]\b/i,
  /\bbdl\b/i,
  /\btnp\b/i,
  /\bcomment[s]?:?\b/i,
  /\breference\s+range\b/i,
  /\bref\s+range\b/i,
  /\bratio\b/i,
];

const NAME_REJECT = /\b(reference|range|ratio|interval|interpretation|comment)\b/i;
const DATE_RE = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g;
const NUM_RE = /(?:^|[^\d.\-])(\d{1,5}(?:\.\d{1,3})?)\b/;
const CODE_PREFIX = /^\s*\d{1,4}\s+(?=[A-Za-z])/;

interface LineParse {
  name: string;
  value: number;
  unit: string;
  raw_line: string;
}

function parseLine(originalLine: string): LineParse | null {
  const line = originalLine.trim();
  if (!line) return null;
  for (const re of SKIP_LINE_PATTERNS) if (re.test(line)) return null;

  // Strip leading test code if present (Quest-style "001 Glucose ...").
  let body = line.replace(CODE_PREFIX, "");
  // Mask out dates so they don't get picked up as the patient's value.
  body = body.replace(DATE_RE, " ");

  const m = NUM_RE.exec(body);
  if (!m) return null;
  const valueText = m[1];
  const value = Number(valueText);
  if (!Number.isFinite(value)) return null;

  // m.index is the position of the lookbehind char (or 0 if at line start).
  // The actual digit start is m.index + (m[0].length - valueText.length).
  const digitStart = m.index + (m[0].length - valueText.length);
  const nameRaw = body.slice(0, digitStart).trim();
  if (!nameRaw || nameRaw.length < 2) return null;
  if (NAME_REJECT.test(nameRaw)) return null;

  const after = body.slice(digitStart + valueText.length).trim();
  const unitMatch = after.match(/^([a-zA-Z%\/µμ][\w%\/.\-µμ]{0,30})/);
  const unit = unitMatch ? unitMatch[1] : "";

  return { name: nameRaw, value, unit, raw_line: line };
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    // strip parentheticals
    .replace(/\([^)]*\)/g, " ")
    // strip serum/plasma qualifiers after a comma
    .replace(/,\s*(serum|plasma|whole blood|blood)\b.*$/i, "")
    // collapse to single spaces
    .replace(/[ \s]+/g, " ")
    .trim();
}

function matchSynonym(
  name: string,
): { key: string; tier: "primary" | "alias"; spec: Spec } | null {
  const norm = normalizeForMatch(name);
  if (!norm) return null;
  // 1. Exact equality.
  for (const s of SYNONYMS) {
    if (norm === s.pattern) return { key: s.key, tier: s.tier, spec: s.spec };
  }
  // 2. Word-boundary substring (longer patterns first by sort order).
  const wrapped = " " + norm + " ";
  for (const s of SYNONYMS) {
    if (wrapped.includes(" " + s.pattern + " ")) {
      return { key: s.key, tier: s.tier, spec: s.spec };
    }
  }
  return null;
}

function unitMatches(spec: Spec, unit: string): boolean {
  if (spec.units.length === 0) return true; // no expected unit (HOMA-IR etc.)
  if (!unit) return false;
  const u = unit
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/µ/g, "u")
    .replace(/μ/g, "u");
  return spec.units.some((expected) => {
    const e = expected.toLowerCase().replace(/µ/g, "u").replace(/μ/g, "u");
    return u === e || u.startsWith(e);
  });
}

function confidenceFor(
  spec: Spec,
  tier: "primary" | "alias",
  value: number,
  unit: string,
): Confidence {
  const inBand = value >= spec.min && value <= spec.max;
  if (!inBand) return "low";
  const um = unitMatches(spec, unit);
  if (tier === "primary" && um) return "high";
  if (tier === "primary" || um) return "medium";
  return "low";
}

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const mod = await import("unpdf");
    const pdf = await mod.getDocumentProxy(bytes);
    const result = await mod.extractText(pdf, { mergePages: true });
    const t = result.text as unknown;
    let text = "";
    if (typeof t === "string") text = t;
    else if (Array.isArray(t)) text = (t as string[]).join("\n");
    // eslint-disable-next-line no-console
    console.log(`[lab-pdf-parser] unpdf extracted ${text.length} chars`);
    return text;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] unpdf extract failed:", (err as Error)?.message || "unknown");
    return "";
  }
}

export function extractBiomarkersFromText(text: string): ExtractedBiomarker[] {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const knownKeys = new Set<string>(BIOMARKER_KEYS);
  const best = new Map<string, ExtractedBiomarker>();

  let highConf = 0, medConf = 0, lowConf = 0;
  for (const rawLine of lines) {
    const parsed = parseLine(rawLine);
    if (!parsed) continue;
    const m = matchSynonym(parsed.name);
    if (!m) continue;
    if (!knownKeys.has(m.key)) continue;
    const conf = confidenceFor(m.spec, m.tier, parsed.value, parsed.unit);
    // Drop low-confidence matches that are also out of band: probably noise.
    if (conf === "low" && (parsed.value < m.spec.min || parsed.value > m.spec.max)) continue;
    const candidate: ExtractedBiomarker = {
      key: m.key,
      value: parsed.value,
      unit: parsed.unit,
      raw_name: parsed.name,
      raw_line: parsed.raw_line,
      confidence: conf,
      tier: m.tier,
    };
    const existing = best.get(m.key);
    if (!existing || CONF_RANK[conf] > CONF_RANK[existing.confidence]) {
      best.set(m.key, candidate);
    }
  }
  for (const e of best.values()) {
    if (e.confidence === "high") highConf += 1;
    else if (e.confidence === "medium") medConf += 1;
    else lowConf += 1;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] matched ${best.size} biomarkers (high=${highConf} medium=${medConf} low=${lowConf})`,
    best.size > 0 ? Array.from(best.keys()).join(",") : "(none)",
  );
  return Array.from(best.values());
}

export interface ParsePdfResult {
  ok: boolean;
  biomarkers: Record<string, number>;
  confidence: Record<string, Confidence>;
  details: ExtractedBiomarker[];
  text_chars: number;
  reason?: string;
}

export async function parsePdfBiomarkers(bytes: Uint8Array): Promise<ParsePdfResult> {
  const text = await extractTextFromPdf(bytes);
  if (!text) {
    return {
      ok: false,
      biomarkers: {},
      confidence: {},
      details: [],
      text_chars: 0,
      reason: "extract_failed",
    };
  }
  const details = extractBiomarkersFromText(text);
  const biomarkers: Record<string, number> = {};
  const confidence: Record<string, Confidence> = {};
  for (const d of details) {
    biomarkers[d.key] = d.value;
    confidence[d.key] = d.confidence;
  }
  return {
    ok: details.length > 0,
    biomarkers,
    confidence,
    details,
    text_chars: text.length,
    ...(details.length === 0 ? { reason: "no_patterns_matched" } : {}),
  };
}

// Back-compat wrapper used elsewhere (e.g., tests). Returns just the
// canonical key -> numeric value map.
export function parseBiomarkers(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of extractBiomarkersFromText(text)) out[d.key] = d.value;
  return out;
}
