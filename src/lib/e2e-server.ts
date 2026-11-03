/**
 * Server side of on-device encryption for patients. Stores public keys, sealed and wrapped keys,
 * and ciphertext only. Every handler returns 404 while the client encryption flag is off.
 */
import { isClientEncEnabled } from "@/lib/e2e/flag";
import { enrollSchema, entrySchema, withdrawSchema } from "@/lib/e2e/schema";
import type { z } from "zod";

export type Result = { status: number; body: Record<string, unknown> };
type Enroll = z.infer<typeof enrollSchema>;
type Entry = z.infer<typeof entrySchema>;
type Withdraw = z.infer<typeof withdrawSchema>;

export interface E2eStore {
  getUserKey(patientId: string): Promise<{ active_dek_id: string; recovery_confirmed_at: string; public_jwk: unknown; recovery_sealed: unknown } | null>;
  getWraps(patientId: string, dekId: string): Promise<Array<{ recipient_type: string; recipient_id: string; dek_id: string; wrapped_dek: unknown }>>;
  getClinicPublicKey(patientId: string): Promise<{ clinic_id: string; public_jwk: unknown } | null>;
  enroll(patientId: string, b: Enroll): Promise<void>;
  saveEntry(patientId: string, e: Entry): Promise<void>;
  listEntries(patientId: string, dekId: string): Promise<Array<Entry & { patient_id: string }>>;
  withdraw(patientId: string, w: Withdraw): Promise<void>;
}

const NOT_FOUND: Result = { status: 404, body: { error: "not found" } };
const env = (e?: Record<string, string | undefined>) => isClientEncEnabled(e ?? process.env);

export async function handleStatus(patientId: string | null, store: E2eStore, e?: Record<string, string | undefined>): Promise<Result> {
  if (!env(e)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const key = await store.getUserKey(patientId);
  const clinic = await store.getClinicPublicKey(patientId);
  if (!key) return { status: 200, body: { patient_id: patientId, enrolled: false, clinic } };
  const wraps = await store.getWraps(patientId, key.active_dek_id);
  return {
    status: 200,
    body: {
      patient_id: patientId, enrolled: true, clinic,
      public_jwk: key.public_jwk, recovery: key.recovery_sealed,
      recovery_confirmed_at: key.recovery_confirmed_at, dek_id: key.active_dek_id,
      wraps: wraps.filter((w) => w.recipient_type === "patient"),
    },
  };
}

export async function handleEnroll(patientId: string | null, raw: unknown, store: E2eStore, e?: Record<string, string | undefined>): Promise<Result> {
  if (!env(e)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const p = enrollSchema.safeParse(raw);
  if (!p.success) return { status: 400, body: { error: "invalid enrollment" } };
  if (await store.getUserKey(patientId)) return { status: 409, body: { error: "already enrolled" } };
  const b = p.data;
  if (!b.wraps.some((w) => w.recipient_type === "patient" && w.recipient_id === patientId)) return { status: 400, body: { error: "patient wrap required" } };
  if (b.wraps.some((w) => w.dek_id !== b.dek_id)) return { status: 400, body: { error: "wrap key id mismatch" } };
  const clinicWraps = b.wraps.filter((w) => w.recipient_type === "clinic");
  const consented = b.clinic_consent?.granted ? b.clinic_consent.clinic_id : null;
  if (clinicWraps.some((w) => w.recipient_id !== consented)) return { status: 400, body: { error: "clinic wrap without consent" } };
  await store.enroll(patientId, b);
  return { status: 200, body: { ok: true } };
}

export async function handleEntry(patientId: string | null, raw: unknown, store: E2eStore, e?: Record<string, string | undefined>): Promise<Result> {
  if (!env(e)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const p = entrySchema.safeParse(raw);
  if (!p.success) return { status: 400, body: { error: "invalid entry" } };
  const key = await store.getUserKey(patientId);
  if (!key?.recovery_confirmed_at) return { status: 403, body: { error: "save your recovery code first" } };
  if (p.data.dek_id !== key.active_dek_id || p.data.envelope.kid !== key.active_dek_id) return { status: 409, body: { error: "stale data key" } };
  await store.saveEntry(patientId, p.data);
  return { status: 200, body: { ok: true } };
}

export async function handleWithdraw(patientId: string | null, raw: unknown, store: E2eStore, e?: Record<string, string | undefined>): Promise<Result> {
  if (!env(e)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const p = withdrawSchema.safeParse(raw);
  if (!p.success) return { status: 400, body: { error: "invalid request" } };
  const w = p.data;
  const key = await store.getUserKey(patientId);
  if (!key || key.active_dek_id !== w.old_dek_id) return { status: 409, body: { error: "stale data key" } };
  if (w.wraps.some((x) => x.dek_id !== w.new_dek_id || x.recipient_type === "clinic")) return { status: 400, body: { error: "invalid wraps" } };
  if (!w.wraps.some((x) => x.recipient_type === "patient" && x.recipient_id === patientId)) return { status: 400, body: { error: "patient wrap required" } };
  if (w.entries.some((x) => x.dek_id !== w.new_dek_id || x.envelope.kid !== w.new_dek_id)) return { status: 400, body: { error: "entries not rotated" } };
  await store.withdraw(patientId, w);
  return { status: 200, body: { ok: true } };
}

/** GET entries: the patient's own ciphertext rows under the active data key. Decrypt happens on the device. */
export async function handleListEntries(patientId: string | null, store: E2eStore, e?: Record<string, string | undefined>): Promise<Result> {
  if (!env(e)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const key = await store.getUserKey(patientId);
  if (!key) return { status: 200, body: { entries: [] } };
  return { status: 200, body: { entries: await store.listEntries(patientId, key.active_dek_id) } };
}
