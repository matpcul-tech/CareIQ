import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { isAiEnabled } from "@/lib/ai-flag";
import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";
import { assertTextOnlyModelPayload } from "@/lib/model-outbound";
import { detectPii, redactIdentifiers, replaceKnownNames } from "@/lib/shield-redact";

/**
 * Lab PDF parser.
 *
 * Text extraction uses unpdf (pure JS / WASM, no native dependencies).
 * Recognizable lab rows become canonical biomarker keys on the server.
 *
 * If that match finds nothing and the PDF has enough real text, a model
 * fallback may run on Shield-redacted text only. The fallback is off
 * unless LAB_PDF_MODEL_FALLBACK_ENABLED is the exact string "true"
 * and CAREIQ_AI_ENABLED is the exact string "true".
 * Unset, empty, and any other value keep it off. Missing either flag
 * keeps regex parsing, then manual entry.
 *
 * Scanned or image-only PDFs are never sent to a model, even when the
 * flag is on. Those pages cannot be redacted reliably. Raw PDF bytes,
 * base64 documents, and page images are never attached.
 *
 * Output (back-compat with /api/onboard/upload):
 *   biomarkers       Record<key, number>
 *   confidence       Record<key, "high"|"medium"|"low">
 *   details          ExtractedBiomarker[]
 *   text_chars       number
 *   extraction_mode  "text" | "redacted_text" | "none"
 *   reason?          string
 *   user_message?    string
 */

export type Confidence = "high" | "medium" | "low";
export type ExtractionMode = "text" | "redacted_text" | "none";

export interface ExtractedBiomarker {
  key: string;
  value: number;
  unit: string;
  raw_name: string;
  raw_line: string;
  confidence: Confidence;
  tier: "primary" | "alias" | "model";
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
  { key: "fasting_glucose",
    primary: ["fasting glucose", "glucose fasting", "glucose, fasting", "glucose plasma fasting"],
    aliases: ["glucose", "plasma glucose", "blood glucose", "blood sugar"],
    units: ["mg/dl"], min: 30, max: 600 },
  { key: "fasting_insulin",
    primary: ["fasting insulin", "insulin fasting", "insulin, fasting"],
    aliases: ["insulin"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"], min: 0, max: 200 },
  { key: "homa_ir",
    primary: ["homa-ir", "homa ir", "homair"],
    aliases: ["insulin resistance index", "homa index", "insulin resistance"],
    units: [], min: 0, max: 50 },
  { key: "a1c",
    primary: ["hemoglobin a1c", "hba1c", "a1c", "a1c, ngsp"],
    aliases: ["glycated hemoglobin", "glycohemoglobin"],
    units: ["%"], min: 3, max: 20 },
  { key: "uric_acid",
    primary: ["uric acid"],
    aliases: ["urate", "serum uric acid"],
    units: ["mg/dl"], min: 0.5, max: 20 },
  { key: "ldl",
    primary: ["ldl cholesterol", "ldl-c", "ldl chol", "ldl calc", "ldl cholesterol calc", "ldl-cholesterol"],
    aliases: ["ldl", "low density lipoprotein", "low-density lipoprotein"],
    units: ["mg/dl"], min: 5, max: 600 },
  { key: "hdl",
    primary: ["hdl cholesterol", "hdl-c", "hdl chol", "hdl-cholesterol"],
    aliases: ["hdl", "high density lipoprotein", "high-density lipoprotein"],
    units: ["mg/dl"], min: 5, max: 200 },
  { key: "total_cholesterol",
    primary: ["cholesterol total", "total cholesterol", "cholesterol, total"],
    aliases: ["cholesterol", "serum cholesterol"],
    units: ["mg/dl"], min: 30, max: 600 },
  { key: "triglycerides",
    primary: ["triglycerides", "triglycerides serum"],
    aliases: ["trig", "triglyceride", "tg"],
    units: ["mg/dl"], min: 5, max: 4000 },
  { key: "vldl",
    primary: ["vldl cholesterol", "vldl-c", "vldl chol", "vldl cholesterol calc"],
    aliases: ["vldl", "very low density lipoprotein", "very-low-density lipoprotein"],
    units: ["mg/dl"], min: 1, max: 100 },
  { key: "apob",
    primary: ["apolipoprotein b", "apo b", "apob", "apo-b"],
    aliases: [],
    units: ["mg/dl"], min: 10, max: 400 },
  { key: "lpa",
    primary: ["lipoprotein a", "lp a", "lp(a)", "lipoprotein(a)", "lipoprotein little a"],
    aliases: ["lpa"],
    units: ["nmol/l", "mg/dl"], min: 0, max: 1000 },
  { key: "hs_crp",
    primary: [
      "hs-crp", "hscrp", "hs crp",
      "high sensitivity crp", "high-sensitivity crp",
      "c-reactive protein high sensitivity",
      "c-reactive protein, high sensitivity",
      "c-reactive protein hs",
    ],
    aliases: ["c-reactive protein", "crp", "c reactive protein"],
    units: ["mg/l"], min: 0, max: 200 },
  { key: "homocysteine",
    primary: ["homocysteine"],
    aliases: ["hcy"],
    units: ["umol/l", "µmol/l", "mcmol/l"], min: 1, max: 100 },
  { key: "egfr",
    primary: ["egfr", "estimated gfr", "gfr estimated", "egfr non-african american", "egfr if non-african american"],
    aliases: ["glomerular filtration rate", "gfr"],
    units: ["ml/min", "ml/min/1.73", "ml/min/1.73m2"], min: 1, max: 200 },
  { key: "creatinine",
    primary: ["creatinine"],
    aliases: ["creat", "serum creatinine"],
    units: ["mg/dl"], min: 0.1, max: 15 },
  { key: "bun",
    primary: ["bun", "urea nitrogen", "blood urea nitrogen", "urea nitrogen (bun)"],
    aliases: ["urea"],
    units: ["mg/dl"], min: 1, max: 200 },
  { key: "alt",
    primary: ["alt", "alt (sgpt)", "sgpt", "alanine aminotransferase", "alanine transaminase"],
    aliases: ["alanine aminotransferase alt"],
    units: ["u/l", "iu/l"], min: 1, max: 1000 },
  { key: "ast",
    primary: ["ast", "ast (sgot)", "sgot", "aspartate aminotransferase", "aspartate transaminase"],
    aliases: ["aspartate aminotransferase ast"],
    units: ["u/l", "iu/l"], min: 1, max: 1000 },
  { key: "albumin",
    primary: ["albumin"],
    aliases: ["alb", "serum albumin"],
    units: ["g/dl"], min: 1, max: 7 },
  { key: "bilirubin",
    primary: ["bilirubin total", "total bilirubin", "bilirubin, total"],
    aliases: ["bilirubin", "t bili", "tbili"],
    units: ["mg/dl"], min: 0, max: 30 },
  { key: "wbc",
    primary: ["wbc", "white blood cell count", "white blood cells"],
    aliases: ["leukocytes", "leukocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"], min: 1, max: 50 },
  { key: "rbc",
    primary: ["rbc", "red blood cell count", "red blood cells"],
    aliases: ["erythrocytes", "erythrocyte count"],
    units: ["m/ul", "10^6/ul", "x10e6/ul"], min: 2, max: 8 },
  { key: "hemoglobin",
    primary: ["hemoglobin", "hgb", "hb"],
    aliases: ["haemoglobin"],
    units: ["g/dl"], min: 5, max: 25 },
  { key: "hematocrit",
    primary: ["hematocrit", "hct"],
    aliases: ["haematocrit", "pcv", "packed cell volume"],
    units: ["%"], min: 15, max: 65 },
  { key: "platelets",
    primary: ["platelets", "platelet count", "plt"],
    aliases: ["thrombocytes", "thrombocyte count"],
    units: ["k/ul", "10^3/ul", "x10e3/ul", "thou/ul"], min: 50, max: 1000 },
  { key: "ferritin",
    primary: ["ferritin"],
    aliases: ["serum ferritin"],
    units: ["ng/ml"], min: 1, max: 5000 },
  { key: "vitamin_b12",
    primary: ["vitamin b12", "vitamin b-12", "b12 serum", "b12, serum", "b12"],
    aliases: ["cobalamin"],
    units: ["pg/ml"], min: 50, max: 5000 },
  { key: "testosterone_total",
    primary: ["testosterone total", "total testosterone", "testosterone, total"],
    aliases: ["testosterone", "serum testosterone"],
    units: ["ng/dl"], min: 5, max: 2000 },
  { key: "testosterone_free",
    primary: ["testosterone free", "free testosterone", "testosterone, free"],
    aliases: [],
    units: ["pg/ml", "ng/dl"], min: 0.1, max: 100 },
  { key: "dhea_s",
    primary: ["dhea-s", "dhea sulfate", "dheas", "dhea-sulfate", "dhea sulfated", "dhea-sulphate"],
    aliases: ["dehydroepiandrosterone sulfate", "dehydroepiandrosterone-sulfate", "dehydroepiandrosterone sulphate"],
    units: ["ug/dl", "mcg/dl", "µg/dl"], min: 1, max: 1500 },
  { key: "cortisol_am",
    primary: [
      "cortisol am", "cortisol, am",
      "morning cortisol", "waking cortisol",
      "cortisol morning", "diurnal cortisol am",
      "a.m. cortisol", "am cortisol",
    ],
    aliases: ["cortisol", "serum cortisol"],
    units: ["ug/dl", "mcg/dl", "µg/dl"], min: 0.5, max: 60 },
  { key: "igf1",
    primary: ["igf-1", "igf 1", "igf1", "insulin-like growth factor 1", "insulin like growth factor 1", "insulin-like growth factor-1"],
    aliases: ["somatomedin c", "somatomedin-c"],
    units: ["ng/ml"], min: 10, max: 800 },
  { key: "tsh",
    primary: ["tsh", "tsh, 3rd generation", "tsh 3rd generation", "thyroid stimulating hormone", "thyrotropin"],
    aliases: ["thyroid-stimulating hormone"],
    units: ["uiu/ml", "miu/l", "µiu/ml", "mciu/ml"], min: 0, max: 100 },
  { key: "vitamin_d",
    primary: [
      "vitamin d 25-hydroxy", "25-hydroxy vitamin d", "vitamin d, 25-oh",
      "vitamin d 25-oh", "25-oh vitamin d", "25(oh)d", "25 hydroxy vitamin d",
    ],
    aliases: ["vitamin d", "calcidiol", "vit d"],
    units: ["ng/ml"], min: 1, max: 200 },
  { key: "omega3_index",
    primary: ["omega-3 index", "omega 3 index", "o3i"],
    aliases: ["omega-3 fatty acid index"],
    units: ["%"], min: 0.5, max: 20 },
];

function normalize(s: string): string {
  return s.toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ").trim();
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
const CODE_PREFIX = /^\s*\d{1,4}\s+(?=[A-Za-z])/;

// A value token: a plain number, optionally with a comparator (<, >, <=, >=)
// and optionally glued to a flag (92H, 5.9*). Tokens like "25-Hydroxy" or
// "A1c" are part of the test name, not values.
const VALUE_TOKEN = /^([<>]=?)?(\d{1,5}(?:\.\d{1,3})?)(H|L|HH|LL|A|\*)?$/;
// Abnormal flags that sit between the value and the unit or range.
const FLAG_TOKEN = /^(?:\(?(?:H|L|HH|LL|A|N|\*|\*H|\*L|High|Low|Abnormal|Abn|Critical)\)?)$/i;
// A reference range or bound, such as 70-99, 4.0-5.6, >39, <100, 0.45 - 4.5.
const RANGE_TOKEN = /^[<>]?=?\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?$|^-$/;
const UNIT_TOKEN = /^(?:%|[a-zA-Zµμ][\w%\/.\-µμ^]{0,30})$/;
const UNIT_HINT = /[\/%]|^(?:mg|g|ng|pg|ug|mcg|µg|u|iu|miu|uiu|µiu|mmol|umol|µmol|nmol|ml|k|m|thou|x10e\d|10\^\d)/i;

interface LineParse {
  name: string;
  value: number;
  unit: string;
  raw_line: string;
}

function isValueToken(tok: string): RegExpExecArray | null {
  return VALUE_TOKEN.exec(tok);
}

function findUnit(rest: string[]): string {
  // Unit right after the value (after any flags), or later on the line
  // after the reference range (Quest style: 102 H 65-99 mg/dL).
  for (const tok of rest) {
    if (FLAG_TOKEN.test(tok) || RANGE_TOKEN.test(tok)) continue;
    if (UNIT_TOKEN.test(tok) && UNIT_HINT.test(tok)) return tok;
    // Any other word means we left the value, flag, unit, range columns.
    break;
  }
  for (const tok of rest) {
    if (UNIT_TOKEN.test(tok) && UNIT_HINT.test(tok) && /[\/%]/.test(tok)) return tok;
  }
  return "";
}

function parseLine(originalLine: string): LineParse | null {
  const line = originalLine.trim();
  if (!line) return null;
  for (const re of SKIP_LINE_PATTERNS) if (re.test(line)) return null;
  let body = line.replace(CODE_PREFIX, "");
  body = body.replace(DATE_RE, " ");
  // Column layouts often separate fields with tabs or runs of spaces, and
  // some reports put the range in "70 - 99" form. Normalize both.
  body = body.replace(/(\d)\s+-\s+(\d)/g, "$1-$2");
  const tokens = body.split(/\s+/).filter(Boolean);
  let idx = -1;
  for (let i = 1; i < tokens.length; i++) {
    if (isValueToken(tokens[i])) { idx = i; break; }
  }
  if (idx < 1) return null;
  // Names that end in a number (IGF 1, TSH 3rd gen handled by synonyms):
  // if the next token is also a value and the longer name is a known
  // synonym, take the longer name.
  // Labcorp style test codes ("Glucose 01 92 mg/dL") are zero padded.
  if (/^0\d$/.test(tokens[idx]) && idx + 1 < tokens.length && isValueToken(tokens[idx + 1])) {
    tokens.splice(idx, 1);
  } else if (idx + 1 < tokens.length && isValueToken(tokens[idx + 1])) {
    const longer = tokens.slice(0, idx + 1).join(" ").replace(/:$/, "");
    const norm = normalizeForMatch(longer);
    if (SYNONYMS.some((syn) => syn.pattern === norm)) idx += 1;
  }
  const m = isValueToken(tokens[idx])!;
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return null;
  const nameRaw = tokens.slice(0, idx).join(" ").replace(/[:\s]+$/, "").trim();
  if (!nameRaw || nameRaw.length < 2) return null;
  if (NAME_REJECT.test(nameRaw)) return null;
  const unit = findUnit(tokens.slice(idx + 1));
  return { name: nameRaw, value, unit, raw_line: line };
}

function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/,\s*(serum|plasma|whole blood|blood)\b.*$/i, "")
    .replace(/,/g, " ")
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

export async function extractTextFromPdf(bytes: Uint8Array): Promise<string> {
  try {
    const mod = await import("unpdf");
    const pdf = await mod.getDocumentProxy(bytes);
    // Keep line breaks. mergePages: true flattens the whole document onto
    // one line, which hides every lab row from the line parser.
    const result = await mod.extractText(pdf, { mergePages: false });
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

const LAB_TEXT_MODEL = "claude-sonnet-4-20250514";

export const LAB_PDF_MODEL_FALLBACK_FLAG = "LAB_PDF_MODEL_FALLBACK_ENABLED";

export const LAB_PDF_MANUAL_ENTRY_MESSAGE =
  "We could not read lab values from this PDF automatically. Enter your results manually. The file was not sent to a model.";

const MIN_TEXT_CHARS_FOR_REGEX = 100;

const REDACTED_TEXT_PROMPT =
  "Extract lab results from the redacted text below. Return ONLY a JSON object with biomarker names as keys and numeric values as values. Use these exact key names where applicable: cortisol_am, dhea_s, testosterone_total, testosterone_free, estradiol, estrone, estriol, ldl, hdl, total_cholesterol, triglycerides, a1c, fasting_glucose, tsh, vitamin_d, cortisol, creatinine, egfr, wbc, rbc, hemoglobin, ferritin, vitamin_b12, hs_crp, homocysteine, apob, lpa, fasting_insulin, igf1, omega3_index. Skip values marked Below Detection Limit or Unable to Calculate. Return only the JSON, no other text.\n\nRedacted lab text:\n";

/**
 * Fail closed. Only the exact string "true" enables the redacted-text
 * model fallback. Unset, empty, "false", "1", "yes", and any other value
 * are off.
 */
export function labPdfModelFallbackEnabled(
  env: Record<string, string | undefined>,
): boolean {
  return env[LAB_PDF_MODEL_FALLBACK_FLAG] === "true";
}

export function redactLabTextForModel(text: string, knownNames: string[] = []): string {
  return redactIdentifiers(replaceKnownNames(text, knownNames));
}

export interface LabModelTextRequest {
  model: string;
  max_tokens: number;
  messages: Array<{ role: "user"; content: string }>;
}

export interface LabModelClient {
  createMessage(body: LabModelTextRequest): Promise<{
    content: Array<{ type: string; text?: string }>;
  }>;
}

export interface ParsePdfOptions {
  env?: Record<string, string | undefined>;
  knownNames?: string[];
  modelClient?: LabModelClient;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
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
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function coerceNumeric(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (!trimmed) return null;
    if (/^[<>]/.test(trimmed)) return null;
    if (!/^-?\d/.test(trimmed)) return null;
    const n = parseFloat(trimmed);
    if (Number.isFinite(n)) return n;
    return null;
  }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const inner = (v as Record<string, unknown>).value;
    if (inner !== undefined) return coerceNumeric(inner);
  }
  return null;
}

function biomarkersFromModelJson(raw: string): ExtractedBiomarker[] {
  const trimmed = raw.trim();
  const objText = extractFirstJsonObject(trimmed);
  if (!objText) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] model response did not contain a JSON object");
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(objText);
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] model response JSON was malformed");
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] model response was not a flat object");
    return [];
  }

  const knownKeys = new Set<string>(BIOMARKER_KEYS);
  const out: ExtractedBiomarker[] = [];
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = k.toLowerCase().trim();
    if (!key || !knownKeys.has(key)) {
      if (key) dropped.push("unknown");
      continue;
    }
    const num = coerceNumeric(v);
    if (num === null) {
      dropped.push("non-numeric");
      continue;
    }
    out.push({
      key,
      value: num,
      unit: "",
      raw_name: k,
      raw_line: "",
      confidence: "medium",
      tier: "model",
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] model: matched ${out.length} biomarkers; dropped ${dropped.length}`,
    out.length > 0 ? `kept=${out.map((o) => o.key).join(",")}` : "",
    dropped.length > 0 ? `dropped=${dropped.length}` : "",
  );
  return out;
}

function textCouldContainPdfPayload(text: string, bytes: Uint8Array): boolean {
  if (text.includes("%PDF-")) return true;
  if (!bytes || bytes.length === 0) return false;
  const encodedLength = Math.ceil(bytes.length / 3) * 4;
  if (text.length < encodedLength) return false;
  return text.includes(Buffer.from(bytes).toString("base64"));
}

function defaultModelClient(apiKey: string): LabModelClient {
  const client = new Anthropic({ apiKey });
  return {
    async createMessage(body) {
      assertTextOnlyModelPayload(body);
      for (const message of body.messages) {
        if (typeof message.content !== "string") {
          throw new Error("refusing non-text model content");
        }
      }
      const message = await client.messages.create({
        model: body.model,
        max_tokens: body.max_tokens,
        messages: body.messages.map((item) => ({
          role: item.role,
          content: item.content,
        })),
      });
      return {
        content: message.content.map((block) =>
          block.type === "text" ? { type: block.type, text: block.text } : { type: block.type },
        ),
      };
    },
  };
}

export interface ParsePdfResult {
  ok: boolean;
  biomarkers: Record<string, number>;
  confidence: Record<string, Confidence>;
  details: ExtractedBiomarker[];
  text_chars: number;
  extraction_mode: ExtractionMode;
  reason?: string;
  user_message?: string;
}

function resultFromDetails(
  details: ExtractedBiomarker[],
  textChars: number,
  mode: ExtractionMode,
): ParsePdfResult {
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
    text_chars: textChars,
    extraction_mode: mode,
  };
}

function manualEntryResult(textChars: number, reason: string): ParsePdfResult {
  // eslint-disable-next-line no-console
  console.log(`[lab-pdf-parser] model fallback skipped (${reason}, text_chars=${textChars})`);
  return {
    ok: false,
    biomarkers: {},
    confidence: {},
    details: [],
    text_chars: textChars,
    extraction_mode: "none",
    reason,
    user_message: LAB_PDF_MANUAL_ENTRY_MESSAGE,
  };
}

export async function parsePdfBiomarkers(
  bytes: Uint8Array,
  options: ParsePdfOptions = {},
): Promise<ParsePdfResult> {
  // unpdf transfers the underlying ArrayBuffer to a worker and detaches it.
  // Extract from a copy so the caller can still encrypt the original file.
  // The copy is never attached to a model request.
  const extractBytes = new Uint8Array(bytes.byteLength);
  extractBytes.set(bytes);

  const text = await extractTextFromPdf(extractBytes);
  const textChars = text.length;

  if (textChars >= MIN_TEXT_CHARS_FOR_REGEX) {
    const details = extractBiomarkersFromText(text);
    if (details.length > 0) {
      return resultFromDetails(details, textChars, "text");
    }
  }

  // Not enough text to redact reliably. Do not call a model, even when
  // the fallback flag is on. Page images are not rendered or uploaded.
  if (textChars < MIN_TEXT_CHARS_FOR_REGEX) {
    return manualEntryResult(textChars, "image_only_manual_entry");
  }

  const env = options.env ?? process.env;
  if (!labPdfModelFallbackEnabled(env)) {
    return manualEntryResult(textChars, "model_fallback_disabled");
  }

  const redacted = redactLabTextForModel(text, options.knownNames ?? []);
  if (!redacted.trim() || detectPii(redacted).severity === "CRITICAL") {
    return manualEntryResult(textChars, "redaction_incomplete");
  }
  if (textCouldContainPdfPayload(redacted, bytes)) {
    return manualEntryResult(textChars, "redaction_incomplete");
  }

  const request: LabModelTextRequest = {
    model: LAB_TEXT_MODEL,
    max_tokens: 4096,
    messages: [{ role: "user", content: REDACTED_TEXT_PROMPT + redacted }],
  };
  try {
    assertTextOnlyModelPayload(request);
  } catch {
    return manualEntryResult(textChars, "redaction_incomplete");
  }

  if (!isAiEnabled(env)) {
    return manualEntryResult(textChars, "ai_disabled");
  }

  const apiKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!options.modelClient && !apiKey) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] model fallback skipped: ANTHROPIC_API_KEY not configured");
    return manualEntryResult(textChars, "model_fallback_unavailable");
  }

  let raw = "";
  try {
    const client = options.modelClient ?? defaultModelClient(apiKey as string);
    // eslint-disable-next-line no-console
    console.log(
      `[lab-pdf-parser] model fallback: sending redacted text (${redacted.length} chars) to ${LAB_TEXT_MODEL}`,
    );
    const message = await client.createMessage(request);
    for (const block of message.content) {
      if (block.type === "text" && typeof block.text === "string") raw += block.text;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[lab-pdf-parser] model fallback failed:",
      ((err as Error)?.message || "unknown").slice(0, 180),
    );
    return manualEntryResult(textChars, "model_fallback_unavailable");
  }

  const details = biomarkersFromModelJson(raw);
  if (details.length === 0) {
    return manualEntryResult(textChars, "no_patterns_matched");
  }
  return resultFromDetails(details, textChars, "redacted_text");
}

export function parseBiomarkers(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of extractBiomarkersFromText(text)) out[d.key] = d.value;
  return out;
}
