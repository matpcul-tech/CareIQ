import "server-only";

import { z } from "zod";
import { CLEARABLE_KEYS } from "./history-form";

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
  // Optional self-reported sex. Used by the Shield decrypt endpoint to
  // resolve sex-dependent biomarker thresholds (testosterone, ferritin,
  // hemoglobin, etc.). When unset, sex-dependent biomarkers fall back to
  // the union of male + female normal ranges with optimal cleared.
  sex: z.enum(["male", "female"]).optional(),
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

const mepaSchema = z.object({
  oliveOilPerDay: z.number().min(0).max(40).optional(),
  leafyVegetablesPerWeek: z.number().min(0).max(100).optional(),
  otherVegetablesPerDay: z.number().min(0).max(40).optional(),
  berriesPerWeek: z.number().min(0).max(100).optional(),
  otherFruitPerDay: z.number().min(0).max(40).optional(),
  redMeatPerWeek: z.number().min(0).max(100).optional(),
  fishPerWeek: z.number().min(0).max(100).optional(),
  chickenPerWeek: z.number().min(0).max(100).optional(),
  cheesePerWeek: z.number().min(0).max(100).optional(),
  butterPerWeek: z.number().min(0).max(100).optional(),
  beansPerWeek: z.number().min(0).max(100).optional(),
  wholeGrainsPerDay: z.number().min(0).max(40).optional(),
  sweetsPerWeek: z.number().min(0).max(100).optional(),
  nutsPerWeek: z.number().min(0).max(100).optional(),
  fastFoodPerWeek: z.number().min(0).max(50).optional(),
  alcoholPerDay: z.number().min(0).max(40).optional(),
});

export const le8AnswersSchema = z.object({
  mepa: mepaSchema.optional(),
  moderateMinutesPerWeek: z.number().min(0).max(5000).optional(),
  vigorousMinutesPerWeek: z.number().min(0).max(5000).optional(),
  nicotine: z.enum([
    "never",
    "quit_5y_or_more",
    "quit_1_to_under_5y",
    "quit_under_1y_or_nds",
    "current_smoker",
  ]).optional(),
  livesWithIndoorSmoker: z.boolean().optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  lipidTreated: z.boolean().optional(),
  bpTreated: z.boolean().optional(),
});
export type Le8AnswersInput = z.infer<typeof le8AnswersSchema>;

export const healthHistorySchema = z.object({
  chronicConditions: z.array(z.enum(CHRONIC_CONDITIONS)).max(8),
  medications: FREE_TEXT.optional().default(""),
  allergies: FREE_TEXT.optional().default(""),
  familyHistory: FREE_TEXT.optional().default(""),
  le8: le8AnswersSchema.optional(),
  /** Saved Heart Health answers the person explicitly removed. */
  clearLe8: z.array(z.string().refine((k) => (CLEARABLE_KEYS as readonly string[]).includes(k))).max(CLEARABLE_KEYS.length).optional(),
});
export type HealthHistoryInput = z.infer<typeof healthHistorySchema>;

// ---------------------------------------------------------------------------
// Biomarker entry shape used by the new structured `biomarkers` blob.
// ---------------------------------------------------------------------------
const biomarkerSourceSchema = z.enum(["lab", "wearable", "self_reported"]);

export const biomarkerEntrySchema = z.object({
  value: z.number().finite().optional(),
  date_collected: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD")
    .optional(),
  source: biomarkerSourceSchema.optional(),
});
export type BiomarkerEntryInput = z.infer<typeof biomarkerEntrySchema>;

// We accept any string key here; the route handler filters down to known
// biomarker keys before persisting (see manual-labs route). This avoids a
// circular import between validate.ts and biomarker-ranges.ts.
export const biomarkersBlobSchema = z
  .record(z.string().min(1).max(64), biomarkerEntrySchema)
  .optional();
export type BiomarkersBlobInput = z.infer<typeof biomarkersBlobSchema>;

/**
 * Manual lab values. Accepts BOTH the legacy flat shape (camelCase keys
 * directly on the body) AND the new structured `biomarkers` shape. The
 * onboard manual-labs route merges both into the encrypted blob: legacy
 * keys land under `manualLabs`, structured entries land under `biomarkers`.
 */
export const manualLabsSchema = z.object({
  // Legacy flat fields. Kept until the OnboardClient lab form fully migrates
  // to the structured shape. Existing pilot writes still flow through these.
  a1c:            z.number().min(0).max(25).optional(),
  ldl:            z.number().min(0).max(1000).optional(),
  hdl:            z.number().min(0).max(300).optional(),
  fastingGlucose: z.number().min(0).max(1000).optional(),
  bpSystolic:     z.number().int().min(40).max(300).optional(),
  bpDiastolic:    z.number().int().min(20).max(200).optional(),
  triglycerides:  z.number().min(0).max(3000).optional(),
  egfr:           z.number().min(0).max(250).optional(),
  totalCholesterol: z.number().min(0).max(1000).optional(),
  weight:         z.number().min(50).max(700).optional(),
  height:         z.number().min(36).max(96).optional(),
  // New structured biomarker entries, keyed by canonical biomarker key.
  biomarkers: biomarkersBlobSchema,
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
