/**
 * Patient key enrollment, recovery, health entry encryption, and clinic consent
 * (design doc phase 2 tables plus the first part of phase 4 patient flows).
 *
 * Owner decisions this code follows (design section 12, approved 2026-11-02):
 * - Clinic gets a wrap of the patient data key only with patient consent at enrollment.
 *   The patient can withdraw it; withdrawal rotates the data key.
 * - Solo patients are allowed but must confirm their recovery code before any health data.
 * - Only the LE8 band and alert severity may be stored unencrypted. No raw values.
 * - Lost keys are unrecoverable by anyone, including CareIQ.
 */
import {
  buildAad, decryptJson, encryptJson, exportPublicJwk, generateDataKey, generateRecipientKeyPair,
  importPublicJwk, unwrapDataKey, wrapDataKey, type Envelope, type WrappedKey,
} from "./core";
import type { KeyStore } from "./keystore";
import { generateRecoveryCode, openWithRecoveryCode, recoveryCodesMatch, sealWithRecoveryCode, type SealedRecovery } from "./recovery";

export const ENTRY_TABLE = "patient_e2e_entries";
export type RecipientType = "patient" | "clinic" | "family";
export type Le8Band = "high" | "moderate" | "low";
export type AlertSeverity = "critical" | "high" | "informational";
const LE8_BANDS: readonly Le8Band[] = ["high", "moderate", "low"];
const SEVERITIES: readonly AlertSeverity[] = ["critical", "high", "informational"];

export class RecoveryNotConfirmedError extends Error {
  constructor() {
    super("Save and confirm your recovery code before entering health data");
    this.name = "RecoveryNotConfirmedError";
  }
}

export function accountKeyId(patientId: string): string {
  return `uak:${patientId}`;
}

export function wrapContext(dekId: string, type: RecipientType, recipientId: string): string {
  return `key_wraps:${dekId}:${type}:${recipientId}`;
}

export interface Recipient {
  type: RecipientType;
  id: string;
  publicJwk: JsonWebKey;
}

export interface KeyWrapRow {
  dek_id: string;
  recipient_type: RecipientType;
  recipient_id: string;
  wrapped_dek: WrappedKey;
}

export interface PendingEnrollment {
  patientId: string;
  /** Shown once to the patient. Never sent to the server. */
  recoveryCode: string;
  accountPublicJwk: JsonWebKey;
  sealedRecovery: SealedRecovery;
  /** Non-extractable copy for this device. */
  accountPrivate: CryptoKey;
}

export interface ClinicConsentChoice {
  clinicId: string;
  publicJwk: JsonWebKey;
  consent: boolean;
}

export interface EnrollmentBundle {
  patient_id: string;
  public_jwk: JsonWebKey;
  recovery: SealedRecovery;
  dek_id: string;
  wraps: KeyWrapRow[];
  clinic_consent: { clinic_id: string; granted: boolean } | null;
  recovery_confirmed_at: string;
}

async function toNonExtractable(priv: CryptoKey): Promise<CryptoKey> {
  const jwk = await crypto.subtle.exportKey("jwk", priv);
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey", "deriveBits"]);
}

/** Step 1: create the account key and recovery code. Nothing is saved yet. */
export async function startEnrollment(patientId: string, opts: { iterations?: number } = {}): Promise<PendingEnrollment> {
  if (!patientId) throw new Error("patientId required");
  const pair = await generateRecipientKeyPair(true);
  const recoveryCode = generateRecoveryCode();
  const sealedRecovery = await sealWithRecoveryCode(pair.privateKey, recoveryCode, patientId, opts.iterations);
  return {
    patientId,
    recoveryCode,
    accountPublicJwk: await exportPublicJwk(pair.publicKey),
    sealedRecovery,
    accountPrivate: await toNonExtractable(pair.privateKey),
  };
}

async function wrapTo(dek: CryptoKey, dekId: string, recipients: Recipient[]): Promise<KeyWrapRow[]> {
  const rows: KeyWrapRow[] = [];
  for (const r of recipients) {
    rows.push({
      dek_id: dekId,
      recipient_type: r.type,
      recipient_id: r.id,
      wrapped_dek: await wrapDataKey(dek, await importPublicJwk(r.publicJwk), wrapContext(dekId, r.type, r.id)),
    });
  }
  return rows;
}

/**
 * Step 2: the patient types the recovery code back. Only then is a data key created
 * and wrapped to the patient, the clinic (only with consent), and family members.
 */
export async function finishEnrollment(
  pending: PendingEnrollment,
  typedCode: string,
  opts: { keystore: KeyStore; clinic?: ClinicConsentChoice; family?: Array<{ id: string; publicJwk: JsonWebKey }>; now?: Date },
): Promise<{ bundle: EnrollmentBundle; dek: CryptoKey }> {
  if (!recoveryCodesMatch(pending.recoveryCode, typedCode)) throw new RecoveryNotConfirmedError();
  const dekId = crypto.randomUUID();
  const dek = await generateDataKey();
  const recipients: Recipient[] = [{ type: "patient", id: pending.patientId, publicJwk: pending.accountPublicJwk }];
  if (opts.clinic?.consent) recipients.push({ type: "clinic", id: opts.clinic.clinicId, publicJwk: opts.clinic.publicJwk });
  for (const f of opts.family ?? []) recipients.push({ type: "family", id: f.id, publicJwk: f.publicJwk });
  const wraps = await wrapTo(dek, dekId, recipients);
  await opts.keystore.put(accountKeyId(pending.patientId), pending.accountPrivate);
  return {
    dek,
    bundle: {
      patient_id: pending.patientId,
      public_jwk: pending.accountPublicJwk,
      recovery: pending.sealedRecovery,
      dek_id: dekId,
      wraps,
      clinic_consent: opts.clinic ? { clinic_id: opts.clinic.clinicId, granted: opts.clinic.consent } : null,
      recovery_confirmed_at: (opts.now ?? new Date()).toISOString(),
    },
  };
}

/** Gate for any health data form while the flag is on. */
export function assertCanEnterHealthData(status: { recovery_confirmed_at?: string | null } | null | undefined): void {
  if (!status?.recovery_confirmed_at) throw new RecoveryNotConfirmedError();
}

/** New device or cleared browser: unlock the account key with the recovery code and keep it on this device. */
export async function recoverAccount(patientId: string, recovery: SealedRecovery, code: string, keystore: KeyStore): Promise<CryptoKey> {
  const priv = await openWithRecoveryCode(recovery, code, patientId);
  await keystore.put(accountKeyId(patientId), priv);
  return priv;
}

/** Unwrap the data key for one recipient. Throws if the wrap is for someone else or was tampered with. */
export async function unlockDataKey(wrap: KeyWrapRow, recipientPrivate: CryptoKey): Promise<CryptoKey> {
  return unwrapDataKey(wrap.wrapped_dek, recipientPrivate, wrapContext(wrap.dek_id, wrap.recipient_type, wrap.recipient_id));
}

export interface EntryRow {
  id: string;
  patient_id: string;
  category: string;
  dek_id: string;
  envelope: Envelope;
  le8_band: Le8Band | null;
  alert_severity: AlertSeverity | null;
}

function entryAad(row: { id: string; patient_id: string; category: string }): string {
  return buildAad({ table: `${ENTRY_TABLE}.${row.category}`, rowId: row.id, patientId: row.patient_id });
}

/** Encrypt one new health entry on the device. Only band and severity stay readable, and only from fixed lists. */
export async function encryptHealthEntry(input: {
  patientId: string;
  category: string;
  dekId: string;
  dek: CryptoKey;
  data: unknown;
  le8Band?: Le8Band | null;
  alertSeverity?: AlertSeverity | null;
  id?: string;
}): Promise<EntryRow> {
  if (!/^[a-z_]{2,32}$/.test(input.category)) throw new Error("invalid category");
  if (input.le8Band != null && !LE8_BANDS.includes(input.le8Band)) throw new Error("invalid LE8 band");
  if (input.alertSeverity != null && !SEVERITIES.includes(input.alertSeverity)) throw new Error("invalid alert severity");
  const base = { id: input.id ?? crypto.randomUUID(), patient_id: input.patientId, category: input.category };
  return {
    ...base,
    dek_id: input.dekId,
    envelope: await encryptJson(input.dek, input.dekId, input.data, entryAad(base)),
    le8_band: input.le8Band ?? null,
    alert_severity: input.alertSeverity ?? null,
  };
}

export async function decryptHealthEntry<T>(row: EntryRow, dek: CryptoKey): Promise<T> {
  if (row.envelope.kid !== row.dek_id) throw new Error("entry key id mismatch");
  return decryptJson<T>(dek, row.envelope, entryAad(row));
}

/** Add the clinic wrap later, if the patient grants consent after enrollment. */
export async function grantClinicConsent(dek: CryptoKey, dekId: string, clinic: { clinicId: string; publicJwk: JsonWebKey }): Promise<KeyWrapRow> {
  const [row] = await wrapTo(dek, dekId, [{ type: "clinic", id: clinic.clinicId, publicJwk: clinic.publicJwk }]);
  return row;
}

/**
 * Patient withdraws clinic consent. The data key is rotated: a new key is wrapped only to the
 * patient and remaining family, and every entry is re-encrypted under it, so an old clinic wrap
 * (even one cached before deletion) cannot open anything written or rewritten afterward.
 */
export async function withdrawClinicConsent(input: {
  patientId: string;
  patientPublicJwk: JsonWebKey;
  oldDek: CryptoKey;
  oldDekId: string;
  entries: EntryRow[];
  family?: Array<{ id: string; publicJwk: JsonWebKey }>;
}): Promise<{ dekId: string; dek: CryptoKey; wraps: KeyWrapRow[]; entries: EntryRow[]; deleteWrapsForDekId: string }> {
  const dekId = crypto.randomUUID();
  const dek = await generateDataKey();
  const recipients: Recipient[] = [{ type: "patient", id: input.patientId, publicJwk: input.patientPublicJwk }];
  for (const f of input.family ?? []) recipients.push({ type: "family", id: f.id, publicJwk: f.publicJwk });
  const wraps = await wrapTo(dek, dekId, recipients);
  const entries: EntryRow[] = [];
  for (const e of input.entries) {
    if (e.dek_id !== input.oldDekId) throw new Error("entry uses a different data key");
    const data = await decryptHealthEntry<unknown>(e, input.oldDek);
    entries.push(await encryptHealthEntry({
      id: e.id, patientId: e.patient_id, category: e.category, dekId, dek, data,
      le8Band: e.le8_band, alertSeverity: e.alert_severity,
    }));
  }
  return { dekId, dek, wraps, entries, deleteWrapsForDekId: input.oldDekId };
}
