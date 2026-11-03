import type { Appointment, ReminderTemplate } from "./engine";

export interface ReminderLog {
  appointmentId: string;
  phoneHash: string;
  sendOn: string;
  channel: "sms" | "voice";
  status: "sent" | "failed";
  at: string;
}

/**
 * Storage for imported appointments, reminder sends, opt outs, and clinic templates.
 * The Supabase store encrypts each appointment (phone and details) with src/lib/crypto.ts.
 * Opt outs and send logs hold only a keyed phone hash, never the number.
 */
export interface ReminderStore {
  saveAppointments(clinicId: string, rows: Appointment[], mode: "replace" | "upsert"): Promise<number>;
  listAppointments(clinicId: string): Promise<Appointment[]>;
  listOptOutHashes(): Promise<Set<string>>;
  setOptOut(phoneHash: string, optedOut: boolean, at: string): Promise<void>;
  listLogs(clinicId: string): Promise<ReminderLog[]>;
  addLog(clinicId: string, log: ReminderLog): Promise<void>;
  getTemplates(clinicId: string): Promise<Record<string, ReminderTemplate>>;
  setTemplate(clinicId: string, language: string, template: ReminderTemplate): Promise<void>;
}

export class MemoryReminderStore implements ReminderStore {
  appts = new Map<string, Map<string, Appointment>>();
  optOuts = new Set<string>();
  logs = new Map<string, ReminderLog[]>();
  templates = new Map<string, Record<string, ReminderTemplate>>();
  async saveAppointments(clinicId: string, rows: Appointment[], mode: "replace" | "upsert") {
    const cur = mode === "replace" ? new Map<string, Appointment>() : new Map(this.appts.get(clinicId) || []);
    for (const r of rows) cur.set(r.appointmentId, structuredClone(r));
    this.appts.set(clinicId, cur);
    return rows.length;
  }
  async listAppointments(clinicId: string) {
    return [...(this.appts.get(clinicId) || new Map()).values()].map((a) => structuredClone(a));
  }
  async listOptOutHashes() { return new Set(this.optOuts); }
  async setOptOut(h: string, optedOut: boolean) { if (optedOut) this.optOuts.add(h); else this.optOuts.delete(h); }
  async listLogs(clinicId: string) { return [...(this.logs.get(clinicId) || [])]; }
  async addLog(clinicId: string, log: ReminderLog) { this.logs.set(clinicId, [...(this.logs.get(clinicId) || []), log]); }
  async getTemplates(clinicId: string) { return { ...(this.templates.get(clinicId) || {}) }; }
  async setTemplate(clinicId: string, language: string, template: ReminderTemplate) {
    this.templates.set(clinicId, { ...(this.templates.get(clinicId) || {}), [language]: template });
  }
}
