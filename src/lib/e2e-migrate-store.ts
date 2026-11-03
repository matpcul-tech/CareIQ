import "server-only";
import { getServiceClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";
import type { MigrateStore, MigrationAudit } from "@/lib/e2e-migrate-server";

function check(error: unknown) {
  if (error) throw new Error("db error");
}

/** Supabase store for the legacy migration. Every query is scoped to the signed-in patient id. */
export function supabaseMigrateStore(): MigrateStore {
  const sb = getServiceClient();
  return {
    async getUserKey(patientId) {
      const { data, error } = await sb.from("user_keys").select("active_dek_id, recovery_confirmed_at").eq("patient_id", patientId).maybeSingle();
      check(error);
      return data;
    },
    async listLegacy(patientId) {
      const pat = await sb.from("patients").select("profile_encrypted").eq("id", patientId).maybeSingle();
      check(pat.error);
      const hh = await sb.from("health_history").select("id, data_encrypted").eq("patient_id", patientId).order("updated_at", { ascending: false }).limit(1).maybeSingle();
      check(hh.error);
      const bl = await sb.from("biomarker_log").select("id, biomarker_key, date_collected, source, value_encrypted").eq("patient_id", patientId).order("created_at", { ascending: true }).limit(2000);
      check(bl.error);
      const wd = await sb.from("wearable_data").select("id, device_type, uploaded_at, data_encrypted").eq("patient_id", patientId).order("uploaded_at", { ascending: true }).limit(500);
      check(wd.error);
      return { profile: pat.data?.profile_encrypted ?? null, history: hh.data ?? null, biomarkers: bl.data ?? [], wearables: wd.data ?? [] };
    },
    async listLedger(patientId) {
      const { data, error } = await sb.from("e2e_legacy_migrations").select("source, source_id").eq("patient_id", patientId);
      check(error);
      return data ?? [];
    },
    async getEntries(patientId, ids) {
      const { data, error } = await sb.from("patient_e2e_entries")
        .select("id, patient_id, category, dek_id, envelope, le8_band, alert_severity").eq("patient_id", patientId).in("id", ids);
      check(error);
      return data ?? [];
    },
    async markMigrated(patientId, rows) {
      check((await sb.from("e2e_legacy_migrations").upsert(rows.map((r) => ({ ...r, patient_id: patientId })), { onConflict: "patient_id,source,source_id", ignoreDuplicates: true })).error);
    },
  };
}

export function migrationAudit(sessionId: string): MigrationAudit {
  return (e) => logAudit({ sessionId, action: e.action, dataType: "e2e_migration", success: e.success, metadata: e.metadata });
}
