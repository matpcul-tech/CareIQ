import type { Actor, StaffRole } from "./logic";
import type { ClinicStore, StaffRecord } from "./store";

const STORED_ROLES = new Set<StaffRole>(["provider", "ma", "chw", "care_manager", "front_desk"]);

export function isStaffRole(value: string): value is StaffRole {
  return STORED_ROLES.has(value as StaffRole);
}

/**
 * Invite roles are provider, care manager, and front desk.
 * Stored values are provider, care_manager, and front_desk.
 * Existing ma and chw rows stay valid. They are not invite choices.
 */
export function parseInviteRole(value: unknown): StaffRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "provider") return "provider";
  if (normalized === "care_manager") return "care_manager";
  if (normalized === "front_desk") return "front_desk";
  return null;
}

export function staffMayReceiveSignInLink(staff: StaffRecord | null): boolean {
  return Boolean(staff && !staff.revoked_at && isStaffRole(staff.role));
}

/**
 * A staff session comes only from a clinic_staff row.
 * user_metadata and app_metadata are ignored. Patients can edit
 * user_metadata, so it must never grant provider or staff access.
 */
export async function bindStaffOnSignIn(
  store: ClinicStore,
  input: {
    emailHash: string | null;
    authUserId: string | null;
    userMetadata?: Record<string, unknown> | null;
    appMetadata?: Record<string, unknown> | null;
  },
): Promise<Extract<Actor, { kind: "staff" }> | null> {
  void input.userMetadata;
  void input.appMetadata;
  if (!input.emailHash || !input.authUserId) return null;
  const staff = await store.findStaffByEmailHash(input.emailHash);
  if (!staffMayReceiveSignInLink(staff) || !staff) return null;
  const bound = await store.bindStaffAuth(staff.id, input.authUserId);
  if (!bound) return null;
  return {
    kind: "staff",
    clinicId: staff.clinic_id,
    staffId: staff.id,
    role: staff.role,
  };
}

/**
 * Re-read the staff row on every clinic request.
 * A token for another clinic, a changed role, or a revoked row does not pass.
 */
export async function enforceStaffClinic(store: ClinicStore, actor: Actor | null): Promise<Actor | null> {
  if (!actor || actor.kind !== "staff") return actor;
  const staff = await store.getStaff(actor.staffId);
  if (!staff || staff.revoked_at || staff.clinic_id !== actor.clinicId || staff.role !== actor.role) {
    return { ...actor, revoked: true };
  }
  return actor;
}
