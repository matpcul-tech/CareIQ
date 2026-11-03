import "server-only";

import { decryptJson, encryptJson, hashEmail } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import type { Appointment, ReminderTemplate } from "./engine";
import type { ReminderLog, ReminderStore } from "./store";

/** Keyed hash of a phone number. The number itself is never stored outside the encrypted payload. */
export function phoneHash(e164: string): string {
  return hashEmail(`phone:${e164}`);
}

const keyFor = (clinicId: string, appointmentId: string) => hashEmail(`appt:${clinicId}:${appointmentId}`);
const aad = (clinicId: string, key: string) => `clinic_appt:${clinicId}:${key}`;

/** Service role only, after the route checks the caller. RLS enabled and forced, no policies. */
export class SupabaseReminderStore implements ReminderStore {
  private sb() { return getServiceClient(); }

  async saveAppointments(clinicId: string, rows: Appointment[], mode: "replace" | "upsert") {
    if (mode === "replace") {
      const { error } = await this.sb().from("clinic_appointments").delete().eq("clinic_id", clinicId);
      if (error) throw new Error("appointment store unavailable");
    }
    const payload = rows.map((a) => {
      const key = keyFor(clinicId, a.appointmentId);
      return { clinic_id: clinicId, appointment_key: key, payload_encrypted: encryptJson(a, aad(clinicId, key)), updated_at: new Date().toISOString() };
    });
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await this.sb().from("clinic_appointments").upsert(payload.slice(i, i + 500), { onConflict: "clinic_id,appointment_key" });
      if (error) throw new Error("appointment store unavailable");
    }
    return rows.length;
  }

  async listAppointments(clinicId: string) {
    const { data, error } = await this.sb().from("clinic_appointments").select("appointment_key,payload_encrypted").eq("clinic_id", clinicId).limit(20000);
    if (error) throw new Error("appointment store unavailable");
    return (data || []).map((r: { appointment_key: string; payload_encrypted: string }) =>
      decryptJson<Appointment>(r.payload_encrypted, aad(clinicId, r.appointment_key)));
  }

  async listOptOutHashes() {
    const { data, error } = await this.sb().from("reminder_opt_outs").select("phone_hash");
    if (error) throw new Error("appointment store unavailable");
    return new Set((data || []).map((r: { phone_hash: string }) => r.phone_hash));
  }

  async setOptOut(h: string, optedOut: boolean, at: string) {
    const q = optedOut
      ? this.sb().from("reminder_opt_outs").upsert({ phone_hash: h, opted_out_at: at }, { onConflict: "phone_hash" })
      : this.sb().from("reminder_opt_outs").delete().eq("phone_hash", h);
    const { error } = await q;
    if (error) throw new Error("appointment store unavailable");
  }

  async listLogs(clinicId: string) {
    const { data, error } = await this.sb().from("clinic_reminder_log").select("*").eq("clinic_id", clinicId).limit(20000);
    if (error) throw new Error("appointment store unavailable");
    return (data || []).map((r: Record<string, string>) => ({
      appointmentId: r.appointment_key, phoneHash: r.phone_hash, sendOn: r.send_on, channel: r.channel as ReminderLog["channel"],
      status: r.status as ReminderLog["status"], at: r.created_at,
    }));
  }

  async addLog(clinicId: string, log: ReminderLog) {
    const { error } = await this.sb().from("clinic_reminder_log").insert({
      clinic_id: clinicId, appointment_key: keyFor(clinicId, log.appointmentId), phone_hash: log.phoneHash,
      send_on: log.sendOn, channel: log.channel, status: log.status, created_at: log.at,
    });
    if (error) throw new Error("appointment store unavailable");
  }

  async getTemplates(clinicId: string) {
    const { data, error } = await this.sb().from("clinic_reminder_templates").select("language,template").eq("clinic_id", clinicId);
    if (error) throw new Error("appointment store unavailable");
    return Object.fromEntries((data || []).map((r: { language: string; template: ReminderTemplate }) => [r.language, r.template]));
  }

  async setTemplate(clinicId: string, language: string, template: ReminderTemplate) {
    const { error } = await this.sb().from("clinic_reminder_templates").upsert({ clinic_id: clinicId, language, template }, { onConflict: "clinic_id,language" });
    if (error) throw new Error("appointment store unavailable");
  }
}
