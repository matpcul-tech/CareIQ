/**
 * Create the first clinic admin and send their sign-in invite.
 *
 * Required:
 *   CLINIC_BOOTSTRAP_ENABLED=1
 *   CLINIC_BOOTSTRAP_EMAIL
 *   CLINIC_BOOTSTRAP_CLINIC_NAME   (unless CLINIC_BOOTSTRAP_CLINIC_ID is set)
 *   SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY      (SUPABASE_SERVICE_KEY still works)
 *   ENCRYPTION_KEY
 *   NEXT_PUBLIC_SITE_URL
 *
 * Optional:
 *   CLINIC_BOOTSTRAP_DISPLAY_NAME
 *   CLINIC_BOOTSTRAP_CLINIC_ID     add the admin to this clinic instead of creating one
 *   CLINIC_BOOTSTRAP_RESEND=1      send another invite when the email is already bound
 *   RESEND_API_KEY                 sends the link to /auth/callback. Without it,
 *                                  Supabase Auth sends the invite email.
 *
 * The script prints the clinic id. It does not print the service key or the email.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hashEmailWithKey } from "../src/lib/email-hash";
import { bootstrapClinicAdmin } from "../src/lib/clinic/bootstrap-admin";
import { deliverStaffInvite, sendStaffLinkEmail, type StaffAuthAdmin } from "../src/lib/clinic/staff-mail";
import type { StaffRole } from "../src/lib/clinic/logic";
import type { StaffInsertExtras } from "../src/lib/clinic/store";
import { resolveServiceRoleKey } from "../src/lib/supabase-env";

function encryptionKey(): Buffer {
  const raw = (process.env.ENCRYPTION_KEY || "").trim();
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes");
  }
  return key;
}

function supabaseUrl(): string {
  return (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
}

async function main() {
  const url = supabaseUrl();
  const key = resolveServiceRoleKey();
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (!site) throw new Error("NEXT_PUBLIC_SITE_URL is required");

  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const store = new ScriptClinicStore(sb);
  const redirectTo = `${site}/auth/callback`;
  const result = await bootstrapClinicAdmin(store, {
    enabled: process.env.CLINIC_BOOTSTRAP_ENABLED === "1",
    email: process.env.CLINIC_BOOTSTRAP_EMAIL || "",
    emailHash: hashEmailWithKey(process.env.CLINIC_BOOTSTRAP_EMAIL || "", encryptionKey()),
    clinicName: process.env.CLINIC_BOOTSTRAP_CLINIC_NAME || "",
    displayName: process.env.CLINIC_BOOTSTRAP_DISPLAY_NAME || "Clinic admin",
    clinicId: process.env.CLINIC_BOOTSTRAP_CLINIC_ID || null,
    resend: process.env.CLINIC_BOOTSTRAP_RESEND === "1",
  }, async (email) => {
    const sendLink = process.env.RESEND_API_KEY
      ? (link: string) => sendStaffLinkEmail(email, link)
      : undefined;
    return deliverStaffInvite(sb.auth.admin as unknown as StaffAuthAdmin, email, redirectTo, sendLink);
  });

  if (!result.ok) {
    console.error(result.error);
    if (result.clinicId) console.error(`clinic_id: ${result.clinicId}`);
    process.exitCode = 1;
    return;
  }
  console.log(`clinic_id: ${result.clinicId}`);
  console.log(`staff_id: ${result.staffId}`);
  console.log(result.created ? "admin created" : result.resent ? "invite resent" : "admin already exists");
}

class ScriptClinicStore {
  constructor(private sb: SupabaseClient) {}

  async findStaffByEmailHash(emailHash: string) {
    if (!emailHash) return null;
    const { data, error } = await this.sb
      .from("clinic_staff")
      .select("id,clinic_id,role,display_name,phone,revoked_at,email_hash,auth_user_id,is_admin")
      .eq("email_hash", emailHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: String(data.id),
      clinic_id: String(data.clinic_id),
      role: data.role as StaffRole,
      display_name: String(data.display_name),
      phone: data.phone ? String(data.phone) : null,
      revoked_at: data.revoked_at ? String(data.revoked_at) : null,
      email_hash: data.email_hash ? String(data.email_hash) : null,
      auth_user_id: data.auth_user_id ? String(data.auth_user_id) : null,
      is_admin: data.is_admin === true,
    };
  }

  async createClinic(name: string) {
    const { data, error } = await this.sb.from("clinics").insert({ name }).select("id,name").single();
    if (error || !data) throw new Error(error?.message || "clinic insert failed");
    return { id: String(data.id), name: String(data.name) };
  }

  async addStaff(clinicId: string, role: StaffRole, displayName: string, phone?: string | null, extras?: StaffInsertExtras) {
    const { data, error } = await this.sb
      .from("clinic_staff")
      .insert({
        clinic_id: clinicId,
        role,
        display_name: displayName,
        phone: phone || null,
        email_hash: extras?.email_hash || null,
        auth_user_id: extras?.auth_user_id || null,
        is_admin: extras?.is_admin === true,
      })
      .select("id,clinic_id,role,display_name,phone,revoked_at,email_hash,auth_user_id,is_admin")
      .single();
    if (error || !data) throw new Error(error?.message || "staff insert failed");
    return {
      id: String(data.id),
      clinic_id: String(data.clinic_id),
      role: data.role as StaffRole,
      display_name: String(data.display_name),
      phone: data.phone ? String(data.phone) : null,
      revoked_at: data.revoked_at ? String(data.revoked_at) : null,
      email_hash: data.email_hash ? String(data.email_hash) : null,
      auth_user_id: data.auth_user_id ? String(data.auth_user_id) : null,
      is_admin: data.is_admin === true,
    };
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : "bootstrap failed";
  console.error(message);
  process.exitCode = 1;
});
