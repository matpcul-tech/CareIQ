import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import type { E2eStore } from "@/lib/e2e-server";

function check(error: unknown) {
  if (error) throw new Error("db error");
}

export function supabaseE2eStore(): E2eStore {
  const sb = getServiceClient();
  return {
    async getUserKey(patientId) {
      const { data, error } = await sb.from("user_keys").select("active_dek_id, recovery_confirmed_at, public_jwk, recovery_sealed").eq("patient_id", patientId).maybeSingle();
      check(error);
      return data;
    },
    async getWraps(patientId, dekId) {
      const { data, error } = await sb.from("key_wraps").select("recipient_type, recipient_id, dek_id, wrapped_dek").eq("patient_id", patientId).eq("dek_id", dekId);
      check(error);
      return data ?? [];
    },
    async getClinicPublicKey(patientId) {
      const { data: link } = await sb.from("clinic_patients").select("clinic_id").eq("patient_id", patientId).limit(1).maybeSingle();
      if (!link?.clinic_id) return null;
      const { data } = await sb.from("clinic_keys").select("clinic_id, public_jwk").eq("clinic_id", link.clinic_id).order("version", { ascending: false }).limit(1).maybeSingle();
      return data ?? null;
    },
    async enroll(patientId, b) {
      check((await sb.from("user_keys").insert({
        patient_id: patientId, public_jwk: b.public_jwk, recovery_sealed: b.recovery,
        recovery_confirmed_at: b.recovery_confirmed_at, active_dek_id: b.dek_id,
      })).error);
      check((await sb.from("key_wraps").insert(b.wraps.map((w) => ({ ...w, patient_id: patientId })))).error);
      if (b.clinic_consent?.granted) {
        check((await sb.from("key_consents").upsert({ patient_id: patientId, clinic_id: b.clinic_consent.clinic_id, withdrawn_at: null }, { onConflict: "patient_id,clinic_id" })).error);
      }
    },
    async saveEntry(patientId, e) {
      check((await sb.from("patient_e2e_entries").upsert({ ...e, patient_id: patientId, updated_at: new Date().toISOString() })).error);
    },
    async withdraw(patientId, w) {
      const now = new Date().toISOString();
      check((await sb.from("key_wraps").insert(w.wraps.map((x) => ({ ...x, patient_id: patientId })))).error);
      for (const e of w.entries) check((await sb.from("patient_e2e_entries").update({ dek_id: e.dek_id, envelope: e.envelope, updated_at: now }).eq("id", e.id).eq("patient_id", patientId)).error);
      check((await sb.from("user_keys").update({ active_dek_id: w.new_dek_id, updated_at: now }).eq("patient_id", patientId)).error);
      check((await sb.from("key_wraps").delete().eq("patient_id", patientId).eq("dek_id", w.old_dek_id)).error);
      check((await sb.from("key_consents").update({ withdrawn_at: now }).eq("patient_id", patientId).eq("clinic_id", w.clinic_id)).error);
    },
  };
}
