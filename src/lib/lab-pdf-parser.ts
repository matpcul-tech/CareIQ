import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";

/**
 * Universal lab PDF parser.
 *
 * Two-stage extraction:
 *   1. unpdf text extraction + line-by-line synonym matching. Free,
 *      fast, deterministic. Covers any vendor that printed-to-PDF with
 *      a real text layer (Quest, LabCorp, Boston Heart, etc.).
 *   2. Claude vision fallback. Triggered when stage 1 yields fewer
 *      than 100 chars of text (scanned/image PDFs, rasterized labs).
 *      Claude reads the PDF directly, OCRs the contents, and returns
 *      structured biomarker JSON keyed to our canonical schema.
 *
 * Both stages produce ExtractedBiomarker[] with confidence labels.
 * Stage 2 only fires if ANTHROPIC_API_KEY is configured; otherwise
 * the parser degrades gracefully to stage 1 only.
 *
 * Output (back-compat with /api/onboard/upload):
 *   biomarkers       Record<key, number>
 *   confidence       Record<key, "high"|"medium"|"low">
 *   details          ExtractedBiomarker[]
 *   text_chars       number
 *   extraction_mode  "text" | "vision" | "none"
 *   reason?          string
 */

export type Confidence = "high" | "medium" | "low";
export type ExtractionMode = "text" | "vision" | "none";

export interface ExtractedBiomarker {
  key: string;
  value: number;
  unit: string;
  raw_name: string;
  raw_line: string;
  confidence: Confidence;
  tier: "primary" | "alias" | "vision";
}

interface Spec {
  key: string;
  primary: string[];
  aliases: string[];
  units: string[];
  min: number;
  max: number;
  /** Short human description for the Claude prompt. */
  desc?: string;
}

const SPECS: Spec[] = [
  // ============ METABOLIC ============
  { key: "fasting_glucose",
    primary: ["fasting glucose", "glucose fasting", "glucose, fasting", "glucose plasma fasting"],
    aliases: ["glucose", "plasma glucose", "blood glucose", "blood sugar"],
    units: ["mg/dl"], min: 30, max: 600, desc: "fasting glucose mg/dL" },
  { key: "fasting_insulin",
    primary: ["fasting insulin", "insulin fasting", "insulin, fasting"],
    aliases: ["insulin"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"], min: 0, max: 200, desc: "fasting insulin uIU/mL" },
  { key: "homa_ir",
    primary: ["homa-ir", "homa ir", "homair"],
    aliases: ["insulin resistance index", "homa index", "insulin resistance"],
    units: [], min: 0, max: 50, desc: "HOMA-IR insulin resistance index" },
  { key: "a1c",
    primary: ["hemoglobin a1c", "hba1c", "a1c", "a1c, ngsp"],
    aliases: ["glycated hemoglobin", "glycohemoglobin"],
    units: ["%"], min: 3, max: 20, desc: "hemoglobin A1C %" },
  { key: "uric_acid",
    primary: ["uric acid"],
    aliases: ["urate", "serum uric acid"],
    units: ["mg/dl"], min: 0.5, max: 20, desc: "uric acid mg/dL" },

  // ============ CARDIOVASCULAR ============
  { key: "ldl",
    primary: ["ldl cholesterol", "ldl-c", "ldl chol", "ldl calc", "ldl cholesterol calc", "ldl-cholesterol"],
    aliases: ["ldl", "low density lipoprotein", "low-density lipoprotein"],
    units: ["mg/dl"], min: 5, max: 600, desc: "LDL cholesterol mg/dL" },
  { key: "hdl",
    primary: ["hdl cholesterol", "hdl-c", "hdl chol", "hdl-cholesterol"],
    aliases: ["hdl", "high density lipoprotein", "high-density lipoprotein"],
    units: ["mg/dl"], min: 5, max: 200, desc: "HDL cholesterol mg/dL" },
  { key: "total_cholesterol",
    primary: ["cholesterol total", "total cholesterol", "cholesterol, total"],
    aliases: ["cholesterol", "serum cholesterol"],
    units: ["mg/dl"], min: 30, max: 600, desc: "total cholesterol mg/dL" },
  { key: "triglycerides",
    primary: ["triglycerides", "triglycerides serum"],
    aliases: ["trig", "triglyceride", "tg"],
    units: ["mg/dl"], min: 5, max: 4000, desc: "triglycerides mg/dL" },
  { key: "vldl",
    primary: ["vldl cholesterol", "vldl-c", "vldl chol", "vldl cholesterol calc"],
    aliases: ["vldl", "very low density lipoprotein", "very-low-density lipoprotein"],
    units: ["mg/dl"], min: 1, max: 100, desc: "VLDL cholesterol mg/dL" },
  { key: "apob",
    primary: ["apolipoprotein b", "apo b", "apob", "apo-b"],
    aliases: [],
    units: ["mg/dl"], min: 10, max: 400, desc: "apolipoprotein B mg/dL" },
  { key: "lpa",
    primary: ["lipoprotein a", "lp a", "lp(a)", "lipoprotein(a)", "lipoprotein little a"],
    aliases: ["lpa"],
    units: ["nmol/l", "mg/dl"], min: 0, max: 1000, desc: "Lp(a) lipoprotein little-a (nmol/L preferred)" },
  { key: "hs_crp",
    primary: [
      "hs-crp", "hscrp", "hs crp",
      "high sensitivity crp", "high-sensitivity crp",
      "c-reactive protein high sensitivity",
      "c-reactive protein, high sensitivity",
      "c-reactive protein hs",
    ],
    aliases: ["c-reactive protein", "crp", "c reactive protein"],
    units: ["mg/l"], min: 0, max: 200, desc: "high-sensitivity CRP mg/L" },
  { key: "homocysteine",
    primary: ["homocysteine"],
    aliases: ["hcy"],
    units: ["umol/l", "µmol/l", "mcmol/l"], min: 1, max: 100, desc: "homocysteine µmol/L" },

  // ============ ORGAN FUNCTION ============
  { key: "egfr",
    primary: ["egfr", "estimated gfr", "gfr estimated", "egfr non-african american", "egfr if non-african american"],
    aliases: ["glomerular filtration rate", "gfr"],
    units: ["ml/min", "ml/min/1.73", "ml/min/1.73m2"], min: 1, max: 200, desc: "eGFR mL/min" },
  { key: "creatinine",
    primary: ["creatinine"],
    aliases: ["creat", "serum creatinine"],
    units: ["mg/dl"], min: 0.1, max: 15, desc: "creatinine mg/dL" },
  { key: "bun",
    primary: ["bun", "urea nitrogen", "blood urea nitrogen", "urea nitrogen (bun)"],
    aliases: ["urea"],
    units: ["mg/dl"], min: 1, max: 200, desc: "blood urea nitrogen mg/dL" },
  { key: "alt",
    primary: ["alt", "alt (sgpt)", "sgpt", "alanine aminotransferase", "alanine transaminase"],
    aliases: ["alanine aminotransferase alt"],
    units: ["u/l", "iu/l"], min: 1, max: 1000, desc: "ALT (SGPT) U/L" },
  { key: "ast",
    primary: ["ast", "ast (sgot)", "sgot", "aspartate aminotransferase", "aspartate transaminase"],
    aliases: ["aspartate aminotransferase ast"],
    units: ["u/l", "iu/l"], min: 1, max: 1000, desc: "AST (SGOT) U/L" },
  { key: "albumin",
    primary: ["albumin"],
    aliases: ["alb", "serum albumin"],
    units: ["g/dl"], min: 1, max: 7, desc: "albumin g/dL" },
  { key: "bilirubin",
    primary: ["bilirubin total", "total bilirubin", "bilirubin, total"],
    aliases: ["bilirubin", "t bili", "tbili"],
    units: ["mg/dl"], min: 0, max: 30, desc: "total bilirubin mg/dL" },

  // ============ BLOOD ============
  { key: "wbc",
    primary: ["wbc", "white blood cell count", "white blood cells"],
    aliases: ["leukocytes", "leukocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"], min: 1, max: 50, desc: "WBC count K/uL" },
  { key: "rbc",
    primary: ["rbc", "red blood cell count", "red blood cells"],
    aliases: ["erythrocytes", "erythrocyte count"],
    units: ["m/ul", "10^6/ul", "x10e6/ul"], min: 2, max: 8, desc: "RBC count M/uL" },
  { key: "hemoglobin",
    primary: ["hemoglobin", "hgb", "hb"],
    aliases: ["haemoglobin"],
    units: ["g/dl"], min: 5, max: 25, desc: "hemoglobin g/dL" },
  { key: "hematocrit",
    primary: ["hematocrit", "hct"],
    aliases: ["haematocrit", "pcv", "packed cell volume"],
    units: ["%"], min: 15, max: 65, desc: "hematocrit %" },
  { key: "platelets",
    primary: ["platelets", "platelet count", "plt"],
    aliases: ["thrombocytes", "thrombocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"], min: 50, max: 1000, desc: "platelets K/uL" },
  { key: "ferritin",
    primary: ["ferritin"],
    aliases: ["serum ferritin"],
    units: ["ng/ml"], min: 1, max: 5000, desc: "ferritin ng/mL" },
  { key: "vitamin_b12",
    primary: ["vitamin b12", "vitamin b-12", "b12 serum", "b12, serum", "b12"],
    aliases: ["cobalamin"],
    units: ["pg/ml"], min: 50, max: 5000, desc: "vitamin B12 pg/mL" },

  // ============ HORMONAL ============
  { key: "testosterone_total",
    primary: ["testosterone total", "total testosterone", "testosterone, total"],
    aliases: ["testosterone", "serum testosterone"],
    units: ["ng/dl"], min: 5, max: 2000, desc: "total testosterone ng/dL" },
  { key: "testosterone_free",
    primary: ["testosterone free", "free testosterone", "testosterone, free"],
    aliases: [],
    units: ["pg/ml", "ng/dl"], min: 0.1, max: 100, desc: "free testosterone pg/mL" },
  { key: "dhea_s",
    primary: ["dhea-s", "dhea sulfate", "dheas", "dhea-sulfate", "dhea sulfated", "dhea-sulphate"],
    aliases: ["dehydroepiandrosterone sulfate", "dehydroepiandrosterone-sulfate", "dehydroepiandrosterone sulphate"],
    units: ["ug/dl", "mcg/dl", "µg/dl"], min: 1, max: 1500, desc: "DHEA-S µg/dL" },
  { key: "cortisol_am",
    primary: [
      "cortisol am", "cortisol, am",
      "morning cortisol", "waking cortisol",
      "cortisol morning", "diurnal cortisol am",
      "a.m. cortisol", "am cortisol",
    ],
    aliases: ["cortisol", "serum cortisol"],
    units: ["ug/dl", "mcg/dl", "µg/dl"], min: 0.5, max: 60, desc: "AM cortisol µg/dL" },
  { key: "igf1",
    primary: ["igf-1", "igf 1", "igf1", "insulin-like growth factor 1", "insulin like growth factor 1", "insulin-like growth factor-1"],
    aliases: ["somatomedin c", "somatomedin-c"],
    units: ["ng/ml"], min: 10, max: 800, desc: "IGF-1 ng/mL" },
  { key: "tsh",
    primary: ["tsh", "tsh, 3rd generation", "tsh 3rd generation", "thyroid stimulating hormone", "thyrotropin"],
    aliases: ["thyroid-stimulating hormone"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"], min: 0, max: 100, desc: "TSH uIU/mL" },
  { key: "vitamin_d",
    primary: [
      "vitamin d 25-hydroxy", "25-hydroxy vitamin d", "vitamin d, 25-oh",
      "vitamin d 25-oh", "25-oh vitamin d", "25(oh)d", "25 hydroxy vitamin d",
    ],
    aliases: ["vitamin d", "calcidiol", "vit d"],
    units: ["ng/ml"], min: 1, max: 200, desc: "vitamin D 25-hydroxy ng/mL" },
  { key: "omega3_index",
    primary: ["omega-3 index", "omega 3 index", "o3i"],
    aliases: ["omega-3 fatty acid index"],
    units: ["%"], min: 0.5, max: 20, desc: "omega-3 index %" },
];

const SPEC_BY_KEY: Record<string, Spec> = (() => {
  const m: Record<string, Spec> = {};
  for (const s of SPECS) m[s.key] = s;
  return m;
})();

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
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
  let body = line.replace(CODE_PREFIX, "");
  body = body.replace(DATE_RE, " ");
  const m = NUM_RE.exec(body);
  if (!m) return null;
  const valueText = m[1];
  const value = Number(valueText);
  if (!Number.isFinite(value)) return null;
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
    .replace(/\([^)]*\)/g, " ")
    .replace(/,\s*(serum|plasma|whole blood|blood)\b.*$/i, "")
    .replace(/[ \s]+/g, " ")
    .trim();
}

function matchSynonym(name: string): { key: string; tier: "primary" | "alias"; spec: Spec } | null {
  const norm = normalizeForMatch(name);
  if (!norm) return null;
  for (const s of SYNONYMS) {
    if (norm === s.pattern) return { key: s.key, tier: s.tier, spec: s.spec };
  }
  const wrapped = " " + norm + " ";
  for (const s of SYNONYMS) {
    if (wrapped.includes(" " + s.pattern + " ")) {
      return { key: s.key, tier: s.tier, spec: s.spec };
    }
  }
  return null;
}

function unitMatches(spec: Spec, unit: string): boolean {
  if (spec.units.length === 0) return true;
  if (!unit) return false;
  const u = unit.toLowerCase().replace(/\s+/g, "").replace(/µ/g, "u").replace(/μ/g, "u");
  return spec.units.some((expected) => {
    const e = expected.toLowerCase().replace(/µ/g, "u").replace(/μ/g, "u");
    return u === e || u.startsWith(e);
  });
}

function confidenceFor(spec: Spec, tier: "primary" | "alias", value: number, unit: string): Confidence {
  const inBand = value >= spec.min && value <= spec.max;
  if (!inBand) return "low";
  const um = unitMatches(spec, unit);
  if (tier === "primary" && um) return "high";
  if (tier === "primary" || um) return "medium";
  return "low";
}

const CONF_RANK: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

// ===========================================================================
// Stage 1: text extraction via unpdf
// ===========================================================================

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
    `[lab-pdf-parser] text: matched ${best.size} biomarkers (high=${highConf} medium=${medConf} low=${lowConf})`,
    best.size > 0 ? Array.from(best.keys()).join(",") : "(none)",
  );
  return Array.from(best.values());
}

// ===========================================================================
// Stage 2: Claude vision fallback
// ===========================================================================

function buildClaudePrompt(): string {
  const keyList = SPECS.map((s) => `  - ${s.key}: ${s.desc || s.key}`).join("\n");
  return `You are extracting biomarker values from a lab report PDF. The PDF may be a scan, a photo converted to PDF, or a text-layer PDF.

Return ONLY a JSON array. Do not include markdown fences, prose, or any text other than the JSON.

Each object must have exactly these fields:
  "key": one of the canonical keys listed below (string)
  "value": the patient's numeric reading (number, no units, no commas, no flags)
  "unit": the unit as printed on the report (string, may be empty)
  "raw_name": the test name exactly as printed (string)
  "confidence": "high" | "medium" | "low" - your confidence in this extraction

Canonical keys (map test names to these):
${keyList}

Mapping rules (examples):
  "Testosterone", "Testosterone Total", "Testosterone, Total", "Total Testosterone" -> testosterone_total
  "Cortisol", "Cortisol AM", "Morning Cortisol", "Waking Cortisol" -> cortisol_am
  "DHEA-S", "DHEAS", "DHEA Sulfate", "Dehydroepiandrosterone Sulfate" -> dhea_s
  "Vitamin D", "25-OH Vitamin D", "25-Hydroxy Vitamin D", "Calcidiol" -> vitamin_d
  "hs-CRP", "High Sensitivity CRP", "C-Reactive Protein" -> hs_crp
  "LDL", "LDL-C", "LDL Cholesterol", "LDL Calc" -> ldl

Skip any value labeled "Below Detection Limit", "BDL", "Unable to Calculate", "Not Detected", "<LOQ", "<LOD", "TNP".
Skip ratios (e.g., "Cholesterol/HDL Ratio", "LDL/HDL Ratio", "Albumin/Globulin Ratio").
Skip reference ranges - only the patient's ACTUAL value, not the lab's reference interval.
Skip tests that don't match any canonical key above.

If the PDF is unreadable or contains no recognizable biomarkers, return [].
`;
}

let PROMPT_CACHE: string | null = null;
function claudePrompt(): string {
  if (PROMPT_CACHE === null) PROMPT_CACHE = buildClaudePrompt();
  return PROMPT_CACHE;
}

const CLAUDE_MODEL = process.env.LAB_PDF_CLAUDE_MODEL || "claude-haiku-4-5-20251001";

interface ClaudeBiomarker {
  key: string;
  value: number;
  unit?: string;
  raw_name?: string;
  confidence?: Confidence;
}

function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

async function claudeExtractBiomarkers(bytes: Uint8Array): Promise<ExtractedBiomarker[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision fallback skipped: ANTHROPIC_API_KEY not configured");
    return [];
  }
  if (bytes.length > 30 * 1024 * 1024) {
    // eslint-disable-next-line no-console
    console.warn(`[lab-pdf-parser] vision fallback skipped: pdf too large (${bytes.length} bytes)`);
    return [];
  }

  let raw = "";
  try {
    const client = new Anthropic({ apiKey });
    const base64 = Buffer.from(bytes).toString("base64");
    const message = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: claudePrompt() },
          ],
        },
      ],
    });
    for (const block of message.content) {
      if (block.type === "text") {
        raw += block.text;
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] vision call failed:", (err as Error)?.message || "unknown");
    return [];
  }

  const arrText = extractFirstJsonArray(raw);
  if (!arrText) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision response did not contain a JSON array");
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrText);
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision response JSON was malformed");
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const knownKeys = new Set<string>(BIOMARKER_KEYS);
  const best = new Map<string, ExtractedBiomarker>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Partial<ClaudeBiomarker> & Record<string, unknown>;
    const key = typeof obj.key === "string" ? obj.key.toLowerCase() : "";
    if (!knownKeys.has(key)) continue;
    const value = typeof obj.value === "number" && Number.isFinite(obj.value) ? obj.value : NaN;
    if (!Number.isFinite(value)) continue;
    const spec = SPEC_BY_KEY[key];
    if (!spec) continue;
    if (value < spec.min || value > spec.max) continue;
    const claudeConf: Confidence =
      obj.confidence === "high" || obj.confidence === "medium" || obj.confidence === "low"
        ? obj.confidence
        : "medium";
    const candidate: ExtractedBiomarker = {
      key,
      value,
      unit: typeof obj.unit === "string" ? obj.unit : "",
      raw_name: typeof obj.raw_name === "string" ? obj.raw_name : key,
      raw_line: typeof obj.raw_name === "string" ? obj.raw_name : "",
      confidence: claudeConf,
      tier: "vision",
    };
    const existing = best.get(key);
    if (!existing || CONF_RANK[candidate.confidence] > CONF_RANK[existing.confidence]) {
      best.set(key, candidate);
    }
  }

  let h = 0, m = 0, l = 0;
  for (const e of best.values()) {
    if (e.confidence === "high") h += 1;
    else if (e.confidence === "medium") m += 1;
    else l += 1;
  }
  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] vision: matched ${best.size} biomarkers (high=${h} medium=${m} low=${l})`,
    best.size > 0 ? Array.from(best.keys()).join(",") : "(none)",
  );
  return Array.from(best.values());
}

// ===========================================================================
// Orchestration
// ===========================================================================

export interface ParsePdfResult {
  ok: boolean;
  biomarkers: Record<string, number>;
  confidence: Record<string, Confidence>;
  details: ExtractedBiomarker[];
  text_chars: number;
  extraction_mode: ExtractionMode;
  reason?: string;
}

const MIN_TEXT_CHARS_FOR_REGEX = 100;

export async function parsePdfBiomarkers(bytes: Uint8Array): Promise<ParsePdfResult> {
  const text = await extractTextFromPdf(bytes);
  let details: ExtractedBiomarker[] = [];
  let mode: ExtractionMode = "none";

  if (text && text.length >= MIN_TEXT_CHARS_FOR_REGEX) {
    details = extractBiomarkersFromText(text);
    if (details.length > 0) mode = "text";
  }

  // Vision fallback: triggered when text extraction was sparse OR
  // the regex stage matched nothing meaningful.
  if (details.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[lab-pdf-parser] text stage matched ${details.length}; falling back to vision (text_chars=${text.length})`,
    );
    const visionDetails = await claudeExtractBiomarkers(bytes);
    if (visionDetails.length > 0) {
      details = visionDetails;
      mode = "vision";
    }
  }

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
    extraction_mode: mode,
    ...(details.length === 0 ? { reason: "no_patterns_matched" } : {}),
  };
}

export function parseBiomarkers(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of extractBiomarkersFromText(text)) out[d.key] = d.value;
  return out;
}
