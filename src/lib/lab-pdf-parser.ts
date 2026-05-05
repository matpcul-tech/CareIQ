import "server-only";

import Anthropic from "@anthropic-ai/sdk";

/**
 * Lab PDF parser.
 *
 * Single path: rasterize every page of the PDF to a PNG, send those
 * images to Claude vision (claude-sonnet-4-20250514), parse a flat
 * JSON object of biomarker_key -> numeric value back from the
 * response. Text extraction is intentionally skipped because
 * malformed PDFs (broken zlib content streams, scans, image-only
 * exports) defeat any text-layer reader. Rendering uses pdfjs-dist's
 * page.render() pipeline with @napi-rs/canvas as the canvas backend
 * which works in Vercel's Node serverless runtime via a prebuilt
 * linux-x64 binding.
 *
 * Output (back-compat with /api/onboard/upload):
 *   biomarkers       Record<key, number>
 *   confidence       Record<key, "medium">  (vision results default)
 *   details          ExtractedBiomarker[]
 *   text_chars       0  (kept for response shape parity)
 *   extraction_mode  "vision" | "none"
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

const VISION_MODEL = "claude-sonnet-4-20250514";
const RENDER_SCALE = 1.5;
const MAX_PAGES = 12;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_BASE64_BYTES_PER_IMAGE = 5 * 1024 * 1024;

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

/**
 * Rasterize each PDF page to a base64-encoded PNG. Uses pdfjs-dist's
 * page rendering pipeline via unpdf's serverless-friendly document
 * loader, with @napi-rs/canvas as the canvas backend. Returns up to
 * MAX_PAGES base64 strings; pages that fail to render are skipped
 * (rendering one page does not block the others).
 *
 * Even when text extraction fails (broken flate streams, custom
 * encodings, scanned pages), pdfjs's renderer can usually still
 * paint pixels, and Claude can OCR the visible content.
 */
async function rasterizePdfPages(bytes: Uint8Array): Promise<string[]> {
  let unpdfMod: typeof import("unpdf");
  let canvasMod: typeof import("@napi-rs/canvas");
  try {
    unpdfMod = await import("unpdf");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] failed to load unpdf:", (err as Error)?.message);
    return [];
  }
  try {
    canvasMod = await import("@napi-rs/canvas");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] failed to load @napi-rs/canvas:", (err as Error)?.message);
    return [];
  }

  let pdf: Awaited<ReturnType<typeof unpdfMod.getDocumentProxy>>;
  try {
    pdf = await unpdfMod.getDocumentProxy(bytes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lab-pdf-parser] getDocumentProxy failed:", (err as Error)?.message);
    return [];
  }

  const numPages = Math.min(pdf.numPages, MAX_PAGES);
  // eslint-disable-next-line no-console
  console.log(`[lab-pdf-parser] rasterize: pdf has ${pdf.numPages} pages, rendering ${numPages}`);

  const pages: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: RENDER_SCALE });
      const width = Math.max(1, Math.ceil(viewport.width));
      const height = Math.max(1, Math.ceil(viewport.height));
      const canvas = canvasMod.createCanvas(width, height);
      const ctx = canvas.getContext("2d");
      // pdfjs's render() is typed to expect a DOM CanvasRenderingContext2D.
      // @napi-rs/canvas's SKRSContext2D implements the same surface area
      // pdfjs needs in practice; cast through unknown to satisfy TS strict.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const canvasContext = ctx as unknown as any;
      const renderTask = page.render({ canvasContext, viewport });
      await renderTask.promise;
      const png = canvas.toBuffer("image/png");
      const base64 = png.toString("base64");
      const approxBytes = (base64.length * 3) / 4;
      if (approxBytes > MAX_BASE64_BYTES_PER_IMAGE) {
        // eslint-disable-next-line no-console
        console.warn(
          `[lab-pdf-parser] page ${i} image too large (${approxBytes.toFixed(0)} bytes); skipping`,
        );
        continue;
      }
      pages.push(base64);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[lab-pdf-parser] page ${i} render failed:`, (err as Error)?.message);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`[lab-pdf-parser] rasterize: produced ${pages.length} page images`);
  return pages;
}

async function claudeExtractBiomarkersFromImages(images: string[]): Promise<ExtractedBiomarker[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision skipped: ANTHROPIC_API_KEY not configured");
    return [];
  }
  if (images.length === 0) {
    // eslint-disable-next-line no-console
    console.warn("[lab-pdf-parser] vision skipped: no rendered pages");
    return [];
  }

  const totalBase64 = images.reduce((s, b) => s + b.length, 0);
  // eslint-disable-next-line no-console
  console.log(
    `[lab-pdf-parser] vision: sending ${images.length} page image(s) (total base64=${totalBase64} chars) to ${VISION_MODEL}`,
  );

  let raw = "";
  try {
    const client = new Anthropic({ apiKey });
    const content: Anthropic.Messages.MessageCreateParams["messages"][number]["content"] = [
      ...images.map((data) => ({
        type: "image" as const,
        source: { type: "base64" as const, media_type: "image/png" as const, data },
      })),
      { type: "text" as const, text: VISION_PROMPT },
    ];
    const message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content }],
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

export async function parsePdfBiomarkers(bytes: Uint8Array): Promise<ParsePdfResult> {
  if (!bytes || bytes.length === 0) {
    return {
      ok: false,
      biomarkers: {},
      confidence: {},
      details: [],
      text_chars: 0,
      extraction_mode: "none",
      reason: "empty_pdf",
    };
  }
  if (bytes.length > MAX_PDF_BYTES) {
    return {
      ok: false,
      biomarkers: {},
      confidence: {},
      details: [],
      text_chars: 0,
      extraction_mode: "none",
      reason: "pdf_too_large",
    };
  }

  // Defensive copy: pdfjs-dist (via unpdf) transfers the underlying
  // ArrayBuffer to a worker, leaving the caller's Uint8Array detached.
  const safeBytes = new Uint8Array(bytes.byteLength);
  safeBytes.set(bytes);

  // Single path: rasterize PDF pages -> Claude vision.
  const pages = await rasterizePdfPages(safeBytes);
  if (pages.length === 0) {
    return {
      ok: false,
      biomarkers: {},
      confidence: {},
      details: [],
      text_chars: 0,
      extraction_mode: "none",
      reason: "render_failed",
    };
  }

  const details = await claudeExtractBiomarkersFromImages(pages);
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
    text_chars: 0,
    extraction_mode: details.length > 0 ? "vision" : "none",
    ...(details.length === 0 ? { reason: "vision_no_match" } : {}),
  };
}

/**
 * Back-compat stub. The previous text-extraction-based parser exported
 * a `parseBiomarkers(text)` function used by tests / debugging tools.
 * Vision-only extraction does not consume raw text, so this returns an
 * empty map for any string input. Kept to avoid breaking imports.
 */
export function parseBiomarkers(_text: string): Record<string, number> {
  void _text;
  return {};
}
