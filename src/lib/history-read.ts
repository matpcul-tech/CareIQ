import "server-only";

import { decryptJson } from "@/lib/crypto";
import { toSavedHistory, type SavedHistory } from "@/lib/history-form";
import { getServiceClient } from "@/lib/supabase-server";

/**
 * Loads and decrypts the signed-in patient's own health history for the edit form.
 * The caller passes the patient id from the server session, never from the request.
 * Returns only the fields the form edits. Null when there is no record or it cannot be read.
 */
export async function loadSavedHistory(patientId: string): Promise<SavedHistory | null> {
  if (!patientId) return null;
  try {
    const { data, error } = await getServiceClient()
      .from("health_history")
      .select("data_encrypted")
      .eq("patient_id", patientId)
      .maybeSingle();
    if (error || !data?.data_encrypted) return null;
    return toSavedHistory(decryptJson<Record<string, unknown>>(data.data_encrypted, `history:${patientId}`));
  } catch {
    return null;
  }
}
