import "server-only";

import { decryptJson, encryptJson, hashEmail } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import type { CallOutcome, CallRecord, FollowUpCallStore } from "./logic";

type Payload = { patientId: string; note: string };
const aad = (clinicId: string, id: string) => `clinic_followup_call:${clinicId}:${id}`;

/** Patient id and note are encrypted. The keyed patient hash allows lookups without plain ids. */
export class SupabaseFollowUpCallStore implements FollowUpCallStore {
  private sb() { return getServiceClient(); }

  async addCall(c: Omit<CallRecord, "id">): Promise<CallRecord> {
    const id = crypto.randomUUID();
    const { error } = await this.sb().from("clinic_followup_calls").insert({
      id, clinic_id: c.clinicId, patient_key: hashEmail(`followup:${c.clinicId}:${c.patientId}`), staff_id: c.staffId,
      called_at: c.calledAt, outcome: c.outcome, payload_encrypted: encryptJson({ patientId: c.patientId, note: c.note } satisfies Payload, aad(c.clinicId, id)),
    });
    if (error) throw new Error(error.message);
    return { ...c, id };
  }

  async listCalls(clinicId: string): Promise<CallRecord[]> {
    const since = new Date(Date.now() - 400 * 86400000).toISOString();
    const { data, error } = await this.sb().from("clinic_followup_calls")
      .select("id,clinic_id,staff_id,called_at,outcome,payload_encrypted")
      .eq("clinic_id", clinicId).gte("called_at", since).order("called_at", { ascending: false }).limit(5000);
    if (error) throw new Error(error.message);
    return (data || []).map((r) => {
      const p = decryptJson<Payload>(String(r.payload_encrypted), aad(clinicId, String(r.id)));
      return { id: String(r.id), clinicId, patientId: p.patientId, staffId: String(r.staff_id), calledAt: String(r.called_at), outcome: r.outcome as CallOutcome, note: p.note };
    });
  }
}
