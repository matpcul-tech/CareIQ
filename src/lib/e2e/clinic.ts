/**
 * Clinic key custody (design doc section 4, option (a) with optional (c), approved 2026-11-02).
 *
 * - The clinic root key (CRK) is an ECDH P-256 key pair made on the admin's device.
 * - Its private part is sealed twice: under the admin passphrase (PBKDF2-SHA-256, 600k) and under
 *   a 24-word recovery key (BIP39 words for 32 random bytes) that is printed once.
 * - Optionally the recovery key is split 2 of 3 with the audited `shamir-secret-sharing` library.
 * - Only the public key and the two sealed blobs reach the server. Lost passphrase plus lost
 *   recovery key (or fewer than 2 shares) means the clinic data cannot be opened by anyone, including CareIQ.
 */
import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { combine, split } from "shamir-secret-sharing";
import { b64, deriveKeyFromPassphrase, exportPublicJwk, generateRecipientKeyPair, openPrivateKey, sealPrivateKey, unb64, type Envelope } from "./core";

export type CustodyMode = "passphrase" | "passphrase_split_2of3";
export const CLINIC_PASSPHRASE_MIN = 12;
export const SHARE_COUNT = 3;
export const SHARE_THRESHOLD = 2;
export const LOST_KEYS_NOTICE =
  "If the passphrase and the recovery key (or 2 of the 3 shares) are all lost, your clinic's encrypted records cannot be opened by anyone, including CareIQ.";

export interface SealedPassphrase { v: 1; salt: string; iterations: number; sealed: Envelope }
export interface SealedRecoveryKey { v: 1; salt: string; sealed: Envelope }

export interface ClinicKeyRecord {
  clinic_id: string;
  version: number;
  public_jwk: JsonWebKey;
  custody_mode: CustodyMode;
  passphrase_sealed: SealedPassphrase;
  recovery_sealed: SealedRecoveryKey;
}

export interface NewClinicKey {
  record: ClinicKeyRecord;
  /** 24 words. Shown and printed once, never sent to the server. */
  recoveryKey: string;
  /** Present only in split mode. Each share goes to a different holder. Never sent to the server. */
  shares: string[] | null;
  /** Non-extractable private key for this session. */
  clinicPrivate: CryptoKey;
}

export function custodyAad(clinicId: string, version: number, kind: "passphrase" | "recovery"): string {
  return `clinic_keys:${kind}:${clinicId}:${version}`;
}

function checkPassphrase(p: string) {
  if (typeof p !== "string" || p.length < CLINIC_PASSPHRASE_MIN) throw new Error(`Passphrase must be at least ${CLINIC_PASSPHRASE_MIN} characters`);
}

async function keyFromEntropy(entropy: Uint8Array, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new Uint8Array(entropy), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: new TextEncoder().encode("careiq/clinic-recovery/v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
  );
}

export function normalizeRecoveryKey(words: string): string {
  return words.toLowerCase().trim().split(/\s+/).join(" ");
}

export function isValidRecoveryKey(words: string): boolean {
  const n = normalizeRecoveryKey(words);
  return n.split(" ").length === 24 && validateMnemonic(n, wordlist);
}

export function encodeShare(share: Uint8Array): string {
  return (Array.from(share, (b) => b.toString(16).padStart(2, "0")).join("").match(/.{1,6}/g) ?? []).join("-").toUpperCase();
}

export function decodeShare(text: string): Uint8Array {
  const hex = text.replace(/[\s-]/g, "").toLowerCase();
  if (!/^([0-9a-f]{2})+$/.test(hex)) throw new Error("Share is not well formed");
  return Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16)));
}

/** Split a recovery key into 3 shares; any 2 rebuild it. */
export async function splitRecoveryKey(words: string): Promise<string[]> {
  if (!isValidRecoveryKey(words)) throw new Error("Recovery key is not valid");
  const shares = await split(mnemonicToEntropy(normalizeRecoveryKey(words), wordlist), SHARE_COUNT, SHARE_THRESHOLD);
  return shares.map(encodeShare);
}

/** Rebuild the recovery key from at least 2 shares. */
export async function combineShares(shares: string[]): Promise<string> {
  if (shares.length < SHARE_THRESHOLD) throw new Error("At least 2 shares are needed");
  const entropy = await combine(shares.map(decodeShare));
  if (entropy.length !== 32) throw new Error("Shares do not match");
  const words = entropyToMnemonic(entropy, wordlist);
  return words;
}

/** Run on the admin's device during clinic setup. */
export async function createClinicKey(input: {
  clinicId: string; passphrase: string; split?: boolean; version?: number; iterations?: number;
}): Promise<NewClinicKey> {
  checkPassphrase(input.passphrase);
  const version = input.version ?? 1;
  const pair = await generateRecipientKeyPair(true);
  const entropy = crypto.getRandomValues(new Uint8Array(32));
  const recoveryKey = entropyToMnemonic(entropy, wordlist);

  const pSalt = crypto.getRandomValues(new Uint8Array(16));
  const pKey = await deriveKeyFromPassphrase(input.passphrase, pSalt, input.iterations);
  const rSalt = crypto.getRandomValues(new Uint8Array(16));
  const rKey = await keyFromEntropy(entropy, rSalt);

  const record: ClinicKeyRecord = {
    clinic_id: input.clinicId,
    version,
    public_jwk: await exportPublicJwk(pair.publicKey),
    custody_mode: input.split ? "passphrase_split_2of3" : "passphrase",
    passphrase_sealed: {
      v: 1, salt: b64(pSalt), iterations: input.iterations ?? 600_000,
      sealed: await sealPrivateKey(pair.privateKey, pKey, custodyAad(input.clinicId, version, "passphrase")),
    },
    recovery_sealed: {
      v: 1, salt: b64(rSalt),
      sealed: await sealPrivateKey(pair.privateKey, rKey, custodyAad(input.clinicId, version, "recovery")),
    },
  };
  const shares = input.split ? await splitRecoveryKey(recoveryKey) : null;
  const clinicPrivate = await openPrivateKey(record.passphrase_sealed.sealed, pKey, custodyAad(input.clinicId, version, "passphrase"), false);
  entropy.fill(0);
  return { record, recoveryKey, shares, clinicPrivate };
}

/** Daily unlock with the admin passphrase. Throws on a wrong passphrase. */
export async function unlockWithPassphrase(rec: ClinicKeyRecord, passphrase: string): Promise<CryptoKey> {
  checkPassphrase(passphrase);
  const key = await deriveKeyFromPassphrase(passphrase, unb64(rec.passphrase_sealed.salt), rec.passphrase_sealed.iterations);
  return openPrivateKey(rec.passphrase_sealed.sealed, key, custodyAad(rec.clinic_id, rec.version, "passphrase"), false);
}

/** Recovery with the 24 words. Returns an extractable key so a new passphrase can be set. */
export async function unlockWithRecoveryKey(rec: ClinicKeyRecord, words: string): Promise<CryptoKey> {
  if (!isValidRecoveryKey(words)) throw new Error("Recovery key is not valid");
  const entropy = mnemonicToEntropy(normalizeRecoveryKey(words), wordlist);
  const key = await keyFromEntropy(entropy, unb64(rec.recovery_sealed.salt));
  return openPrivateKey(rec.recovery_sealed.sealed, key, custodyAad(rec.clinic_id, rec.version, "recovery"), true);
}

export async function unlockWithShares(rec: ClinicKeyRecord, shares: string[]): Promise<CryptoKey> {
  return unlockWithRecoveryKey(rec, await combineShares(shares));
}

/** After recovery: seal the same private key under a new passphrase. */
export async function resealWithPassphrase(rec: ClinicKeyRecord, extractablePrivate: CryptoKey, passphrase: string, iterations?: number): Promise<SealedPassphrase> {
  checkPassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKeyFromPassphrase(passphrase, salt, iterations);
  return { v: 1, salt: b64(salt), iterations: iterations ?? 600_000, sealed: await sealPrivateKey(extractablePrivate, key, custodyAad(rec.clinic_id, rec.version, "passphrase")) };
}

/** The admin must type words back before the key is saved, so we know it was written down. */
export function recoveryKeyConfirmed(shown: string, typed: string): boolean {
  const a = normalizeRecoveryKey(shown), b = normalizeRecoveryKey(typed);
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
