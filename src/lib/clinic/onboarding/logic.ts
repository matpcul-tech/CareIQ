import type { Actor, StaffRole } from "../logic";
import { parseInviteRole } from "../staff-auth";
import type { ClinicStore } from "../store";
import { hashToken, INVITE_LINK_DAYS, looksLikeToken, newToken } from "./tokens";

export interface InviteLink {
  id: string;
  clinic_id: string;
  role: StaffRole;
  is_admin: boolean;
  created_by: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface OnboardingStore {
  /** Atomically marks an unused, unexpired setup token used. Returns true only for the first caller. */
  consumeSetupToken(tokenHash: string, nowIso: string): Promise<boolean>;
  /** Releases a consumed setup token when clinic creation failed after consuming it. */
  releaseSetupToken(tokenHash: string): Promise<void>;
  createInvite(row: Omit<InviteLink, "id" | "used_at" | "revoked_at" | "created_at"> & { token_hash: string; created_at: string }): Promise<InviteLink>;
  /** Atomically marks an unused, unexpired, unrevoked invite used and returns it. */
  consumeInvite(tokenHash: string, nowIso: string): Promise<InviteLink | null>;
  releaseInvite(tokenHash: string): Promise<void>;
  listInvites(clinicId: string): Promise<InviteLink[]>;
  revokeInvite(clinicId: string, id: string, nowIso: string): Promise<boolean>;
}

export type OnboardingAuditEvent = {
  action: "clinic.setup.redeemed" | "clinic.setup.failed" | "clinic.invite_link.created" | "clinic.invite_link.redeemed" | "clinic.invite_link.failed" | "clinic.invite_link.revoked";
  success: boolean;
  role?: string;
  reason?: string;
};

export interface OnboardingDeps {
  clinicStore: ClinicStore;
  store: OnboardingStore;
  audit: (e: OnboardingAuditEvent) => Promise<void>;
  hashEmail: (email: string) => string;
  now: () => Date;
}

type Ok<T> = { ok: true; data: T };
type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

/** Same message for unknown, used, and expired so the response does not reveal which. */
export const TOKEN_INVALID = "This link is not valid. It may have expired or already been used.";

function cleanName(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function cleanEmail(v: unknown): string {
  const e = typeof v === "string" ? v.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : "";
}

export async function redeemSetupToken(
  deps: OnboardingDeps,
  input: { token: unknown; clinicName: unknown; adminName: unknown; adminEmail: unknown; adminRole: unknown },
): Promise<Ok<{ clinicId: string; staffId: string }> | Fail> {
  const clinicName = cleanName(input.clinicName, 120);
  const adminName = cleanName(input.adminName, 80);
  const email = cleanEmail(input.adminEmail);
  const role = parseInviteRole(input.adminRole ?? "provider");
  if (!looksLikeToken(input.token)) {
    await deps.audit({ action: "clinic.setup.failed", success: false, reason: "token" });
    return fail(400, TOKEN_INVALID);
  }
  if (!clinicName) return fail(400, "Clinic name is required.");
  if (!adminName) return fail(400, "Your name is required.");
  if (!email) return fail(400, "A valid work email is required.");
  if (!role) return fail(400, "Role must be provider, care manager, or front desk.");
  const emailHash = deps.hashEmail(email);
  // Check before consuming so a typo does not burn the token.
  if (await deps.clinicStore.findStaffByEmailHash(emailHash)) return fail(409, "That email is already on a clinic staff list.");
  const tokenHash = hashToken(input.token);
  if (!(await deps.store.consumeSetupToken(tokenHash, deps.now().toISOString()))) {
    await deps.audit({ action: "clinic.setup.failed", success: false, reason: "token" });
    return fail(400, TOKEN_INVALID);
  }
  try {
    const clinic = await deps.clinicStore.createClinic(clinicName);
    const staff = await deps.clinicStore.addStaff(clinic.id, role, adminName, null, { email_hash: emailHash, is_admin: true });
    await deps.audit({ action: "clinic.setup.redeemed", success: true, role });
    return { ok: true, data: { clinicId: clinic.id, staffId: staff.id } };
  } catch {
    await deps.store.releaseSetupToken(tokenHash);
    await deps.audit({ action: "clinic.setup.failed", success: false, reason: "store" });
    return fail(503, "Could not create the clinic. The setup link still works; try again.");
  }
}

async function requireAdmin(deps: OnboardingDeps, actor: Actor | null) {
  if (!actor || actor.kind !== "staff") return null;
  const me = await deps.clinicStore.getStaff(actor.staffId);
  if (!me || me.revoked_at || !me.is_admin || me.clinic_id !== actor.clinicId) return null;
  return me;
}

export async function createInviteLink(
  deps: OnboardingDeps,
  actor: Actor | null,
  input: { role: unknown; admin: unknown },
): Promise<Ok<{ token: string; expiresAt: string; id: string }> | Fail> {
  const me = await requireAdmin(deps, actor);
  if (!me) return fail(403, "clinic admin only");
  const role = parseInviteRole(input.role);
  if (!role) return fail(400, "Role must be provider, care manager, or front desk.");
  const token = newToken();
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + INVITE_LINK_DAYS * 86400000).toISOString();
  const row = await deps.store.createInvite({
    clinic_id: me.clinic_id, role, is_admin: input.admin === true, created_by: me.id,
    expires_at: expiresAt, token_hash: hashToken(token), created_at: now.toISOString(),
  });
  await deps.audit({ action: "clinic.invite_link.created", success: true, role: input.admin === true ? "admin" : "staff" });
  return { ok: true, data: { token, expiresAt, id: row.id } };
}

export async function listInviteLinks(deps: OnboardingDeps, actor: Actor | null): Promise<Ok<{ invites: InviteLink[] }> | Fail> {
  const me = await requireAdmin(deps, actor);
  if (!me) return fail(403, "clinic admin only");
  return { ok: true, data: { invites: await deps.store.listInvites(me.clinic_id) } };
}

export async function revokeInviteLink(deps: OnboardingDeps, actor: Actor | null, id: unknown): Promise<Ok<{ revoked: true }> | Fail> {
  const me = await requireAdmin(deps, actor);
  if (!me) return fail(403, "clinic admin only");
  if (typeof id !== "string" || !id) return fail(400, "invite id is required");
  if (!(await deps.store.revokeInvite(me.clinic_id, id, deps.now().toISOString()))) return fail(404, "invite not found or already used");
  await deps.audit({ action: "clinic.invite_link.revoked", success: true });
  return { ok: true, data: { revoked: true } };
}

export async function redeemInviteLink(
  deps: OnboardingDeps,
  input: { token: unknown; displayName: unknown; email: unknown },
): Promise<Ok<{ role: StaffRole; admin: boolean }> | Fail> {
  const name = cleanName(input.displayName, 80);
  const email = cleanEmail(input.email);
  if (!looksLikeToken(input.token)) {
    await deps.audit({ action: "clinic.invite_link.failed", success: false, reason: "token" });
    return fail(400, TOKEN_INVALID);
  }
  if (!name) return fail(400, "Your name is required.");
  if (!email) return fail(400, "A valid work email is required.");
  const emailHash = deps.hashEmail(email);
  if (await deps.clinicStore.findStaffByEmailHash(emailHash)) return fail(409, "That email is already on a clinic staff list.");
  const tokenHash = hashToken(input.token);
  const invite = await deps.store.consumeInvite(tokenHash, deps.now().toISOString());
  if (!invite) {
    await deps.audit({ action: "clinic.invite_link.failed", success: false, reason: "token" });
    return fail(400, TOKEN_INVALID);
  }
  try {
    await deps.clinicStore.addStaff(invite.clinic_id, invite.role, name, null, { email_hash: emailHash, is_admin: invite.is_admin });
  } catch {
    await deps.store.releaseInvite(tokenHash);
    return fail(503, "Could not add you to the clinic. The invite link still works; try again.");
  }
  await deps.audit({ action: "clinic.invite_link.redeemed", success: true, role: invite.is_admin ? "admin" : "staff" });
  return { ok: true, data: { role: invite.role, admin: invite.is_admin } };
}

export class MemoryOnboardingStore implements OnboardingStore {
  setup = new Map<string, { expires_at: string; used_at: string | null }>();
  invites: (InviteLink & { token_hash: string })[] = [];

  addSetupToken(tokenHash: string, expiresAt: string) { this.setup.set(tokenHash, { expires_at: expiresAt, used_at: null }); }

  async consumeSetupToken(h: string, now: string) {
    const t = this.setup.get(h);
    if (!t || t.used_at || t.expires_at <= now) return false;
    t.used_at = now;
    return true;
  }
  async releaseSetupToken(h: string) { const t = this.setup.get(h); if (t) t.used_at = null; }
  async createInvite(row: Omit<InviteLink, "id" | "used_at" | "revoked_at"> & { token_hash: string }) {
    const r = { ...row, id: `inv-${this.invites.length + 1}`, used_at: null, revoked_at: null };
    this.invites.push(r);
    return r;
  }
  async consumeInvite(h: string, now: string) {
    const r = this.invites.find((i) => i.token_hash === h);
    if (!r || r.used_at || r.revoked_at || r.expires_at <= now) return null;
    r.used_at = now;
    return r;
  }
  async releaseInvite(h: string) { const r = this.invites.find((i) => i.token_hash === h); if (r) r.used_at = null; }
  async listInvites(clinicId: string) { return this.invites.filter((i) => i.clinic_id === clinicId).map(({ token_hash: _h, ...rest }) => rest); }
  async revokeInvite(clinicId: string, id: string, now: string) {
    const r = this.invites.find((i) => i.id === id && i.clinic_id === clinicId && !i.used_at && !i.revoked_at);
    if (!r) return false;
    r.revoked_at = now;
    return true;
  }
}
