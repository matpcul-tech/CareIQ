/**
 * Patient recovery code (design section 7).
 * 160 random bits shown as 32 Crockford base32 characters in 8 groups of 4.
 * The code derives (PBKDF2-SHA-256) a key that seals the patient's account private key.
 * The server only ever stores the sealed copy and the salt. Nobody, including CareIQ,
 * can recover data if the code and every enrolled device are lost.
 */
import { b64, deriveKeyFromPassphrase, openPrivateKey, sealPrivateKey, unb64, type Envelope } from "./core";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32, no I L O U
export const RECOVERY_CODE_CHARS = 32;

export function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return formatRecoveryCode(out);
}

/** Uppercase, drop spaces and hyphens, map look-alike letters (O to 0, I and L to 1). */
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
}

export function formatRecoveryCode(raw: string): string {
  const n = normalizeRecoveryCode(raw);
  return (n.match(/.{1,4}/g) ?? []).join("-");
}

export function isWellFormedRecoveryCode(input: string): boolean {
  const n = normalizeRecoveryCode(input);
  return n.length === RECOVERY_CODE_CHARS && [...n].every((c) => ALPHABET.includes(c));
}

/** Constant-shape comparison of a typed code against the one shown. */
export function recoveryCodesMatch(shown: string, typed: string): boolean {
  const a = normalizeRecoveryCode(shown);
  const b = normalizeRecoveryCode(typed);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface SealedRecovery {
  v: 1;
  salt: string;
  iterations: number;
  sealed: Envelope;
}

export function recoveryAad(patientId: string): string {
  return `user_keys:recovery:${patientId}:1`;
}

export async function sealWithRecoveryCode(
  accountPrivate: CryptoKey,
  code: string,
  patientId: string,
  iterations?: number,
): Promise<SealedRecovery> {
  if (!isWellFormedRecoveryCode(code)) throw new Error("Recovery code is not well formed");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassphrase(normalizeRecoveryCode(code), salt, iterations);
  const sealed = await sealPrivateKey(accountPrivate, key, recoveryAad(patientId));
  return { v: 1, salt: b64(salt), iterations: iterations ?? 600_000, sealed };
}

/** Opens the account private key as non-extractable. Throws on a wrong code or wrong patient. */
export async function openWithRecoveryCode(rec: SealedRecovery, code: string, patientId: string): Promise<CryptoKey> {
  if (!isWellFormedRecoveryCode(code)) throw new Error("Recovery code is not well formed");
  const key = await deriveKeyFromPassphrase(normalizeRecoveryCode(code), unb64(rec.salt), rec.iterations);
  return openPrivateKey(rec.sealed, key, recoveryAad(patientId), false);
}
