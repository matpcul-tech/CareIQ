import "server-only";

import { decryptJson, encryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import type { PanelPatient } from "./measures";
import type { UdsPanelStore } from "./panel-store";

const TABLE = "clinic_uds_panel";

function aad(clinicId: string, externalId: string): string {
  return `uds_panel:${clinicId}:${externalId}`;
}

/**
 * Service role access only, after the caller is checked as active clinic staff.
 * RLS is enabled and forced with no policies, so anon and patient sessions read nothing.
 * The patient payload (birth date, diagnoses, readings, exclusion flags) is AES-256-GCM
 * encrypted with AAD bound to the clinic and patient row.
 */
export class SupabaseUdsPanelStore implements UdsPanelStore {
  async replacePanel(clinicId: string, patients: PanelPatient[]): Promise<number> {
    const sb = getServiceClient();
    const del = await sb.from(TABLE).delete().eq("clinic_id", clinicId);
    if (del.error) throw new Error("uds panel store unavailable");
    const rows = patients.map((p) => ({
      clinic_id: clinicId,
      external_id: p.patientId,
      payload_encrypted: encryptJson(p, aad(clinicId, p.patientId)),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await sb.from(TABLE).insert(rows.slice(i, i + 500));
      if (error) throw new Error("uds panel store unavailable");
    }
    return rows.length;
  }

  async listPanel(clinicId: string): Promise<PanelPatient[]> {
    const { data, error } = await getServiceClient()
      .from(TABLE)
      .select("external_id,payload_encrypted")
      .eq("clinic_id", clinicId);
    if (error) throw new Error("uds panel store unavailable");
    return (data || []).map((row: { external_id: string; payload_encrypted: string }) =>
      decryptJson<PanelPatient>(row.payload_encrypted, aad(clinicId, row.external_id)),
    );
  }
}
