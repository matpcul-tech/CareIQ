import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";

/**
 * Lab PDF parser.
 *
 * Two-stage extraction with NO native dependencies (Vercel-safe):
 *   1. Text extraction via unpdf (pure JS / WASM). Fast, free.
 *      Line-by-line synonym matcher converts recognizable lab rows
 *      into canonical biomarker key + value pairs.
 *   2. Claude vision fallback. Triggered when stage 1 yields
 *      < 100 chars of text OR matches zero biomarkers. The raw PDF
 *      bytes are base64-encoded and sent directly to Claude as a
 *      document-type content block; Anthropic's API accepts PDFs
 *      natively, no client-side image conversion required.
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

const VISION_MODEL = "claude-sonnet-4-20250514";

const VISION_PROMPT =
  "Extract all lab results from this document. Return ONLY a JSON object with biomarker names as keys and numeric values as values. Use these exact key names where applicable: cortisol_am, dhea_s, testosterone_total, testosterone_free, estradiol, estrone, estriol, ldl, hdl, total_cholesterol, triglycerides, a1c, fasting_glucose, tsh, vitamin_d, cortisol, creatinine, egfr, wbc, rbc, hemoglobin, ferritin, vitamin_b12, hs_crp, homocysteine, apob, lpa, fasting_insulin, igf1, omega3_index. Skip values marked Below Detection Limit or Unable to Calculate. Return only the JSON, no other text.";

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

async function claudeExtractBiomarkers(bytes: Uint8Array): Promise<ExtractedBiomarker[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision skipped: ANTHROPIC_API_KEY not configured");
    return [];
  }
  if (!bytes || bytes.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision skipped: pdf bytes empty");
    return [];
  }
  if (bytes.length > 30 * 1024 * 1024) {
    // eslint-disable-next-line no-console
    console.warn(`[lab-pdf-parser] vision skipped: pdf too large (${bytes.length} bytes)`);
    return [];
  }

  let raw = "";
  try {
    const client = new Anthropic({ apiKey });
    const base64 = Buffer.from(bytes).toString("base64");
    if (!base64) {
      // eslint-disable-next-line no-console
      console.warn("[lab-pdf-parser] vision skipped: base64 empty after encode");
      return [];
    }
    // eslint-disable-next-line no-console
    console.log(`[lab-pdf-parser] vision: sending ${bytes.length} bytes (base64=${base64.length} chars) to ${VISION_MODEL}`);
    const message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64 },
            },
            { type: "text", text: VISION_PROMPT },
          ],
        },
      ],
    });
    for (const block of message.content) {
      if (block.type === "text") raw += block.text;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] vision call failed:", (err as Error)?.message || "unknown");
    return [];
  }

  const trimmed = raw.trim();
  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] vision raw response (${trimmed.length} chars):`,
    trimmed.length > 800 ? trimmed.slice(0, 800) + "...[truncated]" : trimmed,
  );

  const objText = extractFirstJsonObject(trimmed);
  if (!objText) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision response did not contain a JSON object");
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(objText);
  } catch {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision response JSON was malformed");
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision response was not a flat object");
    return [];
  }

  const out: ExtractedBiomarker[] = [];
  const dropped: string[] = [];
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    const key = k.toLowerCase().trim();
    if (!key) continue;
    const num = coerceNumeric(v);
    if (num === null) {
      const tag = typeof v === "string" ? `"${(v as string).slice(0, 24)}"` : typeof v;
      dropped.push(`${key}=${tag}`);
      continue;
    }
    out.push({
      key,
      value: num,
      unit: "",
      raw_name: k,
      raw_line: "",
      confidence: "medium",
      tier: "vision",
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] vision: matched ${out.length} biomarkers; dropped ${dropped.length}`,
    out.length > 0 ? `kept=${out.map((o) => o.key).join(",")}` : "",
    dropped.length > 0 ? `dropped=${dropped.slice(0, 12).join(";")}` : "",
  );
  return out;
}

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
  // Defensive copy: unpdf transfers the underlying ArrayBuffer to a
  // pdfjs-dist worker, leaving the caller's Uint8Array detached. Copy
  // BEFORE running unpdf so the vision fallback still has the bytes.
  const visionBytes = new Uint8Array(bytes.byteLength);
  visionBytes.set(bytes);

  const text = await extractTextFromPdf(bytes);
  let details: ExtractedBiomarker[] = [];
  let mode: ExtractionMode = "none";

  if (text && text.length >= MIN_TEXT_CHARS_FOR_REGEX) {
    details = extractBiomarkersFromText(text);
    if (details.length > 0) mode = "text";
  }

  if (details.length === 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[lab-pdf-parser] text stage matched 0; falling back to vision (text_chars=${text.length}, vision_bytes=${visionBytes.length})`,
    );
    const visionDetails = await claudeExtractBiomarkers(visionBytes);
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
