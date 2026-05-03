import "server-only";

import { z } from "zod";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export const emailSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(5)
    .max(254)
    .email()
    .regex(/^[^\s<>"']+$/, "invalid characters"),
});
export type EmailInput = z.infer<typeof emailSchema>;

const NAME_REGEX = /^[\p{L}\p{M} '\-.]{1,80}$/u;
const COMMUNITY_REGEX = /^[\p{L}\p{M} '\-.()/]{1,120}$/u;

export const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).regex(NAME_REGEX, "invalid characters"),
  lastName: z.string().trim().min(1).max(80).regex(NAME_REGEX, "invalid characters"),
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .refine((s) => {
      const d = new Date(s + "T00:00:00Z");
      if (Number.isNaN(d.getTime())) return false;
      const year = d.getUTCFullYear();
      return year >= 1900 && year <= new Date().getUTCFullYear();
    }, "invalid date"),
  communityAffiliation: z
    .string()
    .trim()
    .max(120)
    .regex(COMMUNITY_REGEX, "invalid characters")
    .optional()
    .or(z.literal("")),
});
export type ProfileInput = z.infer<typeof profileSchema>;

export const CHRONIC_CONDITIONS = [
  "diabetes",
  "hypertension",
  "heart_disease",
  "obesity",
  "asthma",
  "kidney_disease",
  "cancer",
  "other",
] as const;
export type ChronicCondition = (typeof CHRONIC_CONDITIONS)[number];

// Free-text bounded to 2000 chars; rejects ASCII control chars except \t \n \r
const FREE_TEXT = z
  .string()
  .trim()
  .max(2000)
  .regex(
    /^[^\x00-\x08\x0B\x0C\x0E-\x1F]*$/,
    "control characters not allowed",
  );

export const healthHistorySchema = z.object({
  chronicConditions: z.array(z.enum(CHRONIC_CONDITIONS)).max(8),
  medications: FREE_TEXT.optional().default(""),
  allergies: FREE_TEXT.optional().default(""),
  familyHistory: FREE_TEXT.optional().default(""),
});
export type HealthHistoryInput = z.infer<typeof healthHistorySchema>;

/**
 * Manual lab values typed in by the patient on the data-upload step. Every
 * field is optional. Bounds are clinically generous so unusual but real
 * readings still pass; obviously-bogus values (negative, absurdly high)
 * are rejected.
 */
export const manualLabsSchema = z.object({
  a1c:            z.number().min(0).max(25).optional(),
  ldl:            z.number().min(0).max(1000).optional(),
  hdl:            z.number().min(0).max(300).optional(),
  fastingGlucose: z.number().min(0).max(1000).optional(),
  bpSystolic:     z.number().int().min(40).max(300).optional(),
  bpDiastolic:    z.number().int().min(20).max(200).optional(),
  triglycerides:  z.number().min(0).max(3000).optional(),
  egfr:           z.number().min(0).max(250).optional(),
});
export type ManualLabsInput = z.infer<typeof manualLabsSchema>;

export const ALLOWED_LAB_TYPES = ["pdf", "png", "jpg", "heic"] as const;
export type LabFileType = (typeof ALLOWED_LAB_TYPES)[number];

export const ALLOWED_WEARABLE_TYPES = ["csv", "json", "xml"] as const;
export type WearableFileType = (typeof ALLOWED_WEARABLE_TYPES)[number];

/**
 * Magic-byte detection. Identifies files by content signature, not extension.
 */
export function detectFileType(bytes: Uint8Array): {
  category: "lab" | "wearable" | null;
  type: LabFileType | WearableFileType | null;
} {
  if (bytes.length < 8) return { category: null, type: null };

  // PDF: %PDF-
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return { category: "lab", type: "pdf" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { category: "lab", type: "png" };
  }
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { category: "lab", type: "jpg" };
  }
  // HEIC/HEIF: 'ftyp' box at offset 4 with HEIC family brand
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (
      brand === "heic" ||
      brand === "heix" ||
      brand === "heim" ||
      brand === "heis" ||
      brand === "hevc" ||
      brand === "hevx" ||
      brand === "mif1"
    ) {
      return { category: "lab", type: "heic" };
    }
  }

  const head = utf8Head(bytes, 256).trim();
  if (!head) return { category: null, type: null };
  if (head.startsWith("<?xml") || head.startsWith("<")) {
    return { category: "wearable", type: "xml" };
  }
  if (head.startsWith("{") || head.startsWith("[")) {
    return { category: "wearable", type: "json" };
  }
  if (looksLikeCsv(head)) {
    return { category: "wearable", type: "csv" };
  }
  return { category: null, type: null };
}

function utf8Head(bytes: Uint8Array, max: number): string {
  const slice = bytes.subarray(0, Math.min(bytes.length, max));
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] === 0) return ""; // NUL means binary, not text
  }
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch {
    return "";
  }
}

function looksLikeCsv(head: string): boolean {
  const firstLine = head.split(/\r?\n/)[0] || "";
  if (firstLine.length === 0 || firstLine.length > 4096) return false;
  const hasDelim = /[,;\t]/.test(firstLine);
  // Reject ASCII control chars (except tab); Unicode printable allowed
  const onlyPrintable = !/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(firstLine);
  return hasDelim && onlyPrintable;
}

export interface ValidatedFile {
  category: "lab" | "wearable";
  type: LabFileType | WearableFileType;
  bytes: Uint8Array;
}

export function validateUpload(bytes: Uint8Array, expected: "lab" | "wearable"): ValidatedFile {
  if (!bytes || bytes.length === 0) {
    throw new ValidationError("empty file");
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new ValidationError("file exceeds 10MB limit");
  }
  const detected = detectFileType(bytes);
  if (!detected.category || !detected.type) {
    throw new ValidationError("file format not recognized");
  }
  if (detected.category !== expected) {
    throw new ValidationError("file does not match upload zone");
  }
  return { category: detected.category, type: detected.type, bytes };
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Strips metadata from images/PDFs where possible. Goal: no PHI in metadata.
 */
export function stripMetadata(bytes: Uint8Array, type: LabFileType): Uint8Array {
  switch (type) {
    case "jpg":
      return stripJpegMetadata(bytes);
    case "png":
      return stripPngMetadata(bytes);
    case "pdf":
      return stripPdfMetadata(bytes);
    case "heic":
      return stripHeicMetadata(bytes);
    default:
      return bytes;
  }
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xd8 || marker === 0xd9) {
      out.push(0xff, marker);
      i += 2;
      if (marker === 0xd9) break;
      continue;
    }
    if (marker === 0xda) {
      for (let j = i; j < bytes.length; j++) out.push(bytes[j]);
      break;
    }
    if (i + 4 >= bytes.length) break;
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3];
    const segEnd = i + 2 + segLen;
    const isMetadata =
      (marker >= 0xe0 && marker <= 0xef) || // APPn
      marker === 0xfe; // COM
    if (!isMetadata) {
      for (let j = i; j < segEnd && j < bytes.length; j++) out.push(bytes[j]);
    }
    i = segEnd;
  }
  return new Uint8Array(out);
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "sBIT"]);
  if (bytes.length < 8) return bytes;
  const out: number[] = [];
  for (let i = 0; i < 8; i++) out.push(bytes[i]);
  let i = 8;
  while (i + 8 <= bytes.length) {
    const len =
      (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
    const chunkEnd = i + 8 + len + 4;
    if (chunkEnd > bytes.length) break;
    if (KEEP.has(type)) {
      for (let j = i; j < chunkEnd; j++) out.push(bytes[j]);
    }
    i = chunkEnd;
    if (type === "IEND") break;
  }
  return new Uint8Array(out);
}

function stripPdfMetadata(bytes: Uint8Array): Uint8Array {
  // Best effort: remove embedded XMP packets. Full PDF rewriting is out of scope.
  const text = new TextDecoder("latin1").decode(bytes);
  const cleaned = text.replace(
    /<\?xpacket begin=[\s\S]*?<\?xpacket end="[wr]"\?>/g,
    "",
  );
  if (cleaned === text) return bytes;
  // latin1 round-trip preserves bytes 1:1
  const out = new Uint8Array(cleaned.length);
  for (let i = 0; i < cleaned.length; i++) out[i] = cleaned.charCodeAt(i) & 0xff;
  return out;
}

function stripHeicMetadata(bytes: Uint8Array): Uint8Array {
  // HEIC structured metadata stripping requires a full ISO BMFF parser.
  // Files are encrypted at rest immediately after upload, minimizing exposure.
  return bytes;
}
