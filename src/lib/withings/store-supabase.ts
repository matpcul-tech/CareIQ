import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { isDeviceTypeCheckError, type DailyMetric } from "@/lib/wearable/model";
import type { WithingsConnection, WithingsStore } from "./sync";

interface TokenPlaintext { access_token: string; refresh_token: string }

interface Row {
  patient_id: string;
  withings_userid: string;
  tokens_encrypted: string;
  scope: string;
  access_expires_at: string;
  status: WithingsConnection["status"];
  last_measure_update: number | null;
}

export function tokenAad(patientId: string): string {
  return `withings:${patientId}`;
}

/** AES-256-GCM via src/lib/crypto.ts. Tokens never touch the table in plaintext. */
export function encryptTokens(patientId: string, t: TokenPlaintext): string {
  return encryptJson({ access_token: t.access_token, refresh_token: t.refresh_token }, tokenAad(patientId));
}

export function decryptTokens(patientId: string, blob: string): TokenPlaintext {
  return decryptJson<TokenPlaintext>(blob, tokenAad(patientId));
}

function fromRow(row: Row): WithingsConnection {
  const t = decryptTokens(row.patient_id, row.tokens_encrypted);
  return {
    patientId: row.patient_id,
    withingsUserId: row.withings_userid,
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    scope: row.scope,
    accessExpiresAt: Date.parse(row.access_expires_at),
    lastMeasureUpdate: row.last_measure_update == null ? null : Number(row.last_measure_update),
    status: row.status,
  };
}

export function supabaseWithingsStore(sb: SupabaseClient): WithingsStore {
  return {
    async findByWithingsUser(userid) {
      const { data, error } = await sb
        .from("withings_connections")
        .select("patient_id, withings_userid, tokens_encrypted, scope, access_expires_at, status, last_measure_update")
        .eq("withings_userid", userid)
        .maybeSingle();
      if (error || !data) return null;
      return fromRow(data as Row);
    },
    async saveConnection(conn) {
      const { error } = await sb.from("withings_connections").upsert({
        patient_id: conn.patientId,
        withings_userid: conn.withingsUserId,
        tokens_encrypted: encryptTokens(conn.patientId, { access_token: conn.accessToken, refresh_token: conn.refreshToken }),
        scope: conn.scope,
        access_expires_at: new Date(conn.accessExpiresAt).toISOString(),
        status: conn.status,
        last_measure_update: conn.lastMeasureUpdate,
        updated_at: new Date().toISOString(),
      }, { onConflict: "patient_id" });
      if (error) throw new Error("withings connection save failed");
    },
    async markSynced(patientId, f) {
      const patch: Record<string, unknown> = {
        last_measure_update: f.lastMeasureUpdate,
        last_notified_at: f.notifiedAt,
        updated_at: f.notifiedAt,
      };
      if (f.syncedAt) patch.last_synced_at = f.syncedAt;
      const { error } = await sb.from("withings_connections").update(patch).eq("patient_id", patientId);
      if (error) throw new Error("withings sync mark failed");
    },
    async setStatus(patientId, status) {
      await sb.from("withings_connections").update({ status, updated_at: new Date().toISOString() }).eq("patient_id", patientId);
    },
    async insertWearable(patientId, metrics: DailyMetric[]) {
      const encrypted = encryptJson(
        {
          device: "withings",
          sourceFormat: "json",
          metrics,
          ingestedAt: new Date().toISOString(),
          origin: "withings_notify",
        },
        `wearable:${patientId}`,
      );
      const first = await sb.from("wearable_data").insert({ patient_id: patientId, data_encrypted: encrypted, device_type: "withings" });
      if (!first.error) return;
      if (isDeviceTypeCheckError(first.error)) {
        const second = await sb.from("wearable_data").insert({ patient_id: patientId, data_encrypted: encrypted, device_type: "generic" });
        if (!second.error) return;
      }
      throw new Error("wearable insert failed");
    },
  };
}
