import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import type { ClinicKeyStore } from "@/lib/e2e-clinic-server";

export function supabaseClinicKeyStore(): ClinicKeyStore {
  const sb = getServiceClient();
  const staff = new SupabaseClinicStore();
  return {
    async getStaff(id) { return staff.getStaff(id); },
    async getLatestKey(clinicId) {
      const { data, error } = await sb.from("clinic_keys")
        .select("clinic_id, version, public_jwk, custody_mode, passphrase_sealed, recovery_sealed")
        .eq("clinic_id", clinicId).order("version", { ascending: false }).limit(1).maybeSingle();
      if (error) throw new Error("db error");
      return data ?? null;
    },
    async insertKey(clinicId, k, createdBy) {
      const { error } = await sb.from("clinic_keys").insert({ ...k, clinic_id: clinicId, created_by_staff: createdBy });
      if (error) throw new Error("db error");
    },
  };
}
