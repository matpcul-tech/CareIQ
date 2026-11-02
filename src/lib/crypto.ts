import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { hashEmailWithKey } from "@/lib/email-hash";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96 bits, recommended for GCM
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not configured");
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "hex");
  } catch {
    throw new Error("ENCRYPTION_KEY must be hex encoded");
  }
  if (key.length !== KEY_LENGTH) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (256 bits)");
  }
  cachedKey = key;
  return key;
}

/**
 * Encrypts a UTF-8 string. Output format (base64):
 *   [12-byte IV][16-byte auth tag][ciphertext]
 * Each call produces a fresh random IV. Authenticity is enforced by GCM tag.
 */
export function encrypt(plaintext: string, aad?: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encrypt() requires a string input");
  }
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString("base64");
}

/**
 * Decrypts a value produced by encrypt(). Throws on tag mismatch (tampering).
 */
export function decrypt(payload: string, aad?: string): string {
  if (typeof payload !== "string" || payload.length === 0) {
    throw new Error("decrypt() requires a non-empty string");
  }
  const key = getKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("ciphertext too short");
  }
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/**
 * Encrypts arbitrary JSON-serializable values.
 */
export function encryptJson(value: unknown, aad?: string): string {
  return encrypt(JSON.stringify(value), aad);
}

/**
 * Decrypts a value produced by encryptJson(). Throws on tag mismatch.
 */
export function decryptJson<T = unknown>(payload: string, aad?: string): T {
  return JSON.parse(decrypt(payload, aad)) as T;
}

/**
 * Encrypts a binary buffer (used for file uploads at rest).
 */
export function encryptBuffer(plain: Buffer, aad?: string): Buffer {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  if (aad) cipher.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

/**
 * Decrypts a buffer produced by encryptBuffer().
 */
export function decryptBuffer(payload: Buffer, aad?: string): Buffer {
  if (payload.length < IV_LENGTH + TAG_LENGTH + 1) {
    throw new Error("ciphertext too short");
  }
  const key = getKey();
  const iv = payload.subarray(0, IV_LENGTH);
  const tag = payload.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ct = payload.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(tag);
  if (aad) decipher.setAAD(Buffer.from(aad, "utf8"));
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

/**
 * Deterministic SHA-256 hash for indexing fields like email without storing plaintext.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * HMAC-style email hash that uses ENCRYPTION_KEY as a pepper to resist
 * rainbow-table style lookups. Deterministic for equality checks.
 */
export function hashEmail(email: string): string {
  return hashEmailWithKey(email, getKey());
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
