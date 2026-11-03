import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson } from "@/lib/crypto";
import { buildSyncSources, type SyncSource, type WearableRowMeta } from "@/lib/sync-status";
import { isWithingsEnabled } from "@/lib/withings/flag";

/** Rows scanned per request. Enough to list every source a patient uses. */
const ROW_LIMIT = 200;

/**
 * Builds the per-source "last synced" list for one patient from
 * timestamps CareIQ already stores. Values are not returned, only the
 * source name and the time CareIQ last received data from it.
 */
export async function loadSyncSources(
  sb: SupabaseClient,
  patientId: string,
  historyUpdatedAt: string | null,
): Promise<SyncSource[]> {
  const rows: WearableRowMeta[] = [];
  const { data } = await sb
    .from("wearable_data")
    .select("device_type, uploaded_at, data_encrypted")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false })
    .limit(ROW_LIMIT);
  for (const row of (data ?? []) as Array<{ device_type?: string; uploaded_at?: string; data_encrypted?: string }>) {
    let device: string | null = null;
    // The column falls back to "generic" when the live check rejects a
    // newer label. The real device name lives in the encrypted summary.
    if ((row.device_type === "generic" || !row.device_type) && row.data_encrypted) {
      try {
        device = decryptJson<{ device?: string }>(row.data_encrypted, `wearable:${patientId}`).device ?? null;
      } catch {
        device = null;
      }
    }
    rows.push({ device_type: row.device_type ?? null, uploaded_at: row.uploaded_at ?? null, device });
  }

  const extra: SyncSource[] = [];
  if (historyUpdatedAt) {
    extra.push({
      source: "manual",
      label: "Health history and entered readings",
      kind: "manual",
      last_synced_at: historyUpdatedAt,
    });
  }
  if (isWithingsEnabled()) {
    // The table only exists once migration 0023 is applied. Errors are ignored.
    const { data: conn, error } = await sb
      .from("withings_connections")
      .select("last_synced_at, status")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (!error && conn && (conn as { status?: string }).status === "active") {
      extra.push({
        source: "withings",
        label: "Withings (connected)",
        kind: "connected",
        last_synced_at: (conn as { last_synced_at?: string | null }).last_synced_at ?? null,
      });
    }
  }
  return buildSyncSources(rows, extra);
}
