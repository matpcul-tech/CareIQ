import "server-only";

import { decryptJson, encryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import type { AlertNote, AlertPayload, AlertQueueStore, QueueAlert } from "./queue";

const TABLE = "clinic_alert_queue";

interface Row {
  id: string;
  clinic_id: string;
  clinic_patient_id: string;
  severity: QueueAlert["severity"];
  le8_band: string | null;
  status: QueueAlert["status"];
  created_at: string;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  payload_encrypted: string;
  notes_encrypted: string | null;
}

const payloadAad = (r: { id?: string; clinic_id: string; clinic_patient_id: string }) =>
  `clinic_alert:${r.clinic_id}:${r.clinic_patient_id}`;
const notesAad = (id: string) => `clinic_alert_notes:${id}`;

function fromRow(r: Row): QueueAlert {
  return {
    id: r.id,
    clinicId: r.clinic_id,
    clinicPatientId: r.clinic_patient_id,
    severity: r.severity,
    le8Band: r.le8_band,
    status: r.status,
    createdAt: r.created_at,
    acknowledgedBy: r.acknowledged_by,
    acknowledgedAt: r.acknowledged_at,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at,
    payload: decryptJson<AlertPayload>(r.payload_encrypted, payloadAad(r)),
    notes: r.notes_encrypted ? decryptJson<AlertNote[]>(r.notes_encrypted, notesAad(r.id)) : [],
  };
}

/**
 * Service role only, after the route checks the caller is active clinic staff.
 * RLS is enabled and forced with no policies. Only severity and le8_band are health
 * fields stored in plain text; reading values, rule, patient id, and notes are AES-256-GCM.
 */
export class SupabaseAlertQueueStore implements AlertQueueStore {
  async create(alert: Omit<QueueAlert, "id">): Promise<QueueAlert> {
    const base = { clinic_id: alert.clinicId, clinic_patient_id: alert.clinicPatientId };
    const { data, error } = await getServiceClient().from(TABLE).insert({
      ...base,
      severity: alert.severity,
      le8_band: alert.le8Band,
      status: alert.status,
      created_at: alert.createdAt,
      payload_encrypted: encryptJson(alert.payload, payloadAad(base)),
      notes_encrypted: null,
    }).select("*").single();
    if (error || !data) throw new Error("alert queue unavailable");
    return fromRow(data as Row);
  }

  async list(clinicId: string): Promise<QueueAlert[]> {
    const { data, error } = await getServiceClient().from(TABLE).select("*").eq("clinic_id", clinicId).limit(2000);
    if (error) throw new Error("alert queue unavailable");
    return (data as Row[] || []).map(fromRow);
  }

  async get(id: string): Promise<QueueAlert | null> {
    const { data, error } = await getServiceClient().from(TABLE).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error("alert queue unavailable");
    return data ? fromRow(data as Row) : null;
  }

  async update(id: string, patch: Parameters<AlertQueueStore["update"]>[1]): Promise<QueueAlert | null> {
    const row: Record<string, unknown> = {};
    if (patch.status) row.status = patch.status;
    if (patch.acknowledgedBy !== undefined) row.acknowledged_by = patch.acknowledgedBy;
    if (patch.acknowledgedAt !== undefined) row.acknowledged_at = patch.acknowledgedAt;
    if (patch.resolvedBy !== undefined) row.resolved_by = patch.resolvedBy;
    if (patch.resolvedAt !== undefined) row.resolved_at = patch.resolvedAt;
    if (patch.notes) row.notes_encrypted = encryptJson(patch.notes, notesAad(id));
    const { data, error } = await getServiceClient().from(TABLE).update(row).eq("id", id).select("*").maybeSingle();
    if (error) throw new Error("alert queue unavailable");
    return data ? fromRow(data as Row) : null;
  }
}
