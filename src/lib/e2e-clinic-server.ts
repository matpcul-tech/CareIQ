/**
 * Server side of clinic key custody. Stores the clinic public key and the two sealed copies of the
 * private key (passphrase and recovery key). Never sees the passphrase, recovery words, or shares.
 * Every handler returns 404 while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is off.
 */
import type { Actor } from "@/lib/clinic/logic";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import { clinicKeySchema } from "@/lib/e2e/schema";
import type { z } from "zod";

export type ClinicKeyInput = Omit<z.infer<typeof clinicKeySchema>, "recovery_confirmed">;
export type Result = { status: number; body: Record<string, unknown> };

export interface ClinicKeyStore {
  /** Staff record lookup so only an active admin of the same clinic can create or read sealed keys. */
  getStaff(staffId: string): Promise<{ clinic_id: string; is_admin?: boolean | null; revoked_at?: string | null } | null>;
  getLatestKey(clinicId: string): Promise<(ClinicKeyInput & { clinic_id: string }) | null>;
  insertKey(clinicId: string, k: ClinicKeyInput, createdBy: string): Promise<void>;
}

const NOT_FOUND: Result = { status: 404, body: { error: "not found" } };

async function staffOf(actor: Actor | null, store: ClinicKeyStore) {
  if (!actor || actor.kind !== "staff") return null;
  const me = await store.getStaff(actor.staffId);
  if (!me || me.revoked_at || me.clinic_id !== actor.clinicId) return null;
  return me;
}

/** GET: any active staff sees whether the clinic key exists; only an admin gets the sealed blobs to unlock. */
export async function handleClinicKeyStatus(actor: Actor | null, store: ClinicKeyStore, env?: Record<string, string | undefined>): Promise<Result> {
  if (!isClientEncEnabled(env ?? process.env)) return NOT_FOUND;
  const me = await staffOf(actor, store);
  if (!me) return { status: 403, body: { error: "clinic staff only" } };
  const key = await store.getLatestKey(me.clinic_id);
  if (!key) return { status: 200, body: { clinic_id: me.clinic_id, has_key: false, admin: Boolean(me.is_admin) } };
  const base = { clinic_id: me.clinic_id, has_key: true, admin: Boolean(me.is_admin), version: key.version, public_jwk: key.public_jwk, custody_mode: key.custody_mode };
  return { status: 200, body: me.is_admin ? { ...base, passphrase_sealed: key.passphrase_sealed, recovery_sealed: key.recovery_sealed } : base };
}

/** POST: the clinic admin saves the first clinic key after confirming the printed recovery key. */
export async function handleClinicKeyCreate(actor: Actor | null, raw: unknown, store: ClinicKeyStore, env?: Record<string, string | undefined>): Promise<Result> {
  if (!isClientEncEnabled(env ?? process.env)) return NOT_FOUND;
  const me = await staffOf(actor, store);
  if (!me || !me.is_admin || actor?.kind !== "staff") return { status: 403, body: { error: "clinic admin only" } };
  const p = clinicKeySchema.safeParse(raw);
  if (!p.success) return { status: 400, body: { error: "invalid clinic key" } };
  const existing = await store.getLatestKey(me.clinic_id);
  if (existing) return { status: 409, body: { error: "clinic key already set up" } };
  if (p.data.version !== 1) return { status: 400, body: { error: "first clinic key must be version 1" } };
  const { recovery_confirmed: _c, ...k } = p.data;
  await store.insertKey(me.clinic_id, k, actor.staffId);
  return { status: 200, body: { ok: true } };
}

export class MemoryClinicKeyStore implements ClinicKeyStore {
  staff = new Map<string, { clinic_id: string; is_admin?: boolean; revoked_at?: string | null }>();
  keys: Array<ClinicKeyInput & { clinic_id: string; created_by: string }> = [];
  async getStaff(id: string) { return this.staff.get(id) ?? null; }
  async getLatestKey(clinicId: string) {
    const k = this.keys.filter((x) => x.clinic_id === clinicId).sort((a, b) => b.version - a.version)[0];
    if (!k) return null;
    const { created_by: _c, ...rest } = k;
    return rest;
  }
  async insertKey(clinicId: string, k: ClinicKeyInput, createdBy: string) { this.keys.push({ ...k, clinic_id: clinicId, created_by: createdBy }); }
}
