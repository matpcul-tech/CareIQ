import type { ClinicStore } from "./store";

export interface BootstrapAdminInput {
  enabled: boolean;
  email: string;
  emailHash: string;
  clinicName: string;
  displayName: string;
  clinicId?: string | null;
  resend: boolean;
}

export type BootstrapAdminResult =
  | { ok: true; created: boolean; clinicId: string; staffId: string; resent: boolean }
  | { ok: false; error: string; clinicId?: string };

type BootstrapStore = Pick<ClinicStore, "findStaffByEmailHash" | "createClinic" | "addStaff">;

/**
 * Create the first clinic admin. This does not read patient metadata and
 * does not grant access because an email belongs to a patient.
 * The operator must set the enabled flag. A second run for the same email
 * does not create another clinic.
 */
export async function bootstrapClinicAdmin(
  store: BootstrapStore,
  input: BootstrapAdminInput,
  send: (email: string) => Promise<{ ok: boolean }>,
): Promise<BootstrapAdminResult> {
  if (!input.enabled) return { ok: false, error: "CLINIC_BOOTSTRAP_ENABLED must be 1" };
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "CLINIC_BOOTSTRAP_EMAIL is not a valid email" };
  if (!input.emailHash) return { ok: false, error: "email hash is missing" };

  const existing = await store.findStaffByEmailHash(input.emailHash);
  if (existing) {
    if (existing.revoked_at) return { ok: false, error: "staff access is revoked", clinicId: existing.clinic_id };
    if (input.resend) {
      const sent = await send(email);
      if (!sent.ok) return { ok: false, error: "invite email was not sent", clinicId: existing.clinic_id };
      return { ok: true, created: false, clinicId: existing.clinic_id, staffId: existing.id, resent: true };
    }
    return { ok: true, created: false, clinicId: existing.clinic_id, staffId: existing.id, resent: false };
  }

  const clinicName = input.clinicName.trim();
  let clinicId = (input.clinicId || "").trim();
  if (!clinicId) {
    if (!clinicName) return { ok: false, error: "CLINIC_BOOTSTRAP_CLINIC_NAME is required" };
    const clinic = await store.createClinic(clinicName);
    clinicId = clinic.id;
  }
  const displayName = (input.displayName || "Clinic admin").trim().slice(0, 80) || "Clinic admin";
  const staff = await store.addStaff(clinicId, "provider", displayName, null, {
    email_hash: input.emailHash,
    is_admin: true,
  });
  const sent = await send(email);
  if (!sent.ok) {
    return { ok: false, error: "invite email was not sent", clinicId };
  }
  return { ok: true, created: true, clinicId, staffId: staff.id, resent: false };
}
