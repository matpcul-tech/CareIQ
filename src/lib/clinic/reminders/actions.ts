/**
 * Appointment reminder actions. Staff only, clinic scoped. Import and template changes are
 * clinic admin only. CareIQ does not book visits; the clinic EHR is the system of record.
 */

import { isActiveStaff, type Actor } from "../logic";
import type { ClinicStore } from "../store";
import { evaluateCareGapPanel } from "../uds/care-gaps";
import { calendarYearPeriod, isIsoDate } from "../uds/measures";
import type { UdsPanelStore } from "../uds/panel-store";
import { DEFAULT_TEMPLATES, planReminders, type Appointment, type PlannedReminder, type ReminderTemplate } from "./engine";
import type { ReminderStore } from "./store";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export type ReminderAuditEvent = {
  action: "clinic.appointments.imported" | "clinic.reminders.viewed" | "clinic.reminders.dispatched" | "clinic.reminders.template" | "clinic.reminders.inbound";
  count: number;
  actorRole: string;
};
export type ReminderAudit = (e: ReminderAuditEvent) => Promise<void>;

export interface ReminderDeps {
  clinicStore: ClinicStore;
  panelStore: UdsPanelStore;
  store: ReminderStore;
  audit: ReminderAudit;
  hashPhone: (e164: string) => string;
}

export interface SendingState {
  enabled: boolean;
  configured: boolean;
  message: string;
}

export function sendingState(flagOn: boolean, twilioConfigured: boolean): SendingState {
  if (!twilioConfigured) return { enabled: false, configured: false, message: "Reminders are queued but not sent: text service not set up." };
  if (!flagOn) return { enabled: false, configured: true, message: "Reminders are queued but not sent: sending is turned off." };
  return { enabled: true, configured: true, message: "Reminders are sent at the scheduled day." };
}

async function requireAdmin(deps: ReminderDeps, actor: Actor) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const s = await deps.clinicStore.getStaff(actor.staffId);
  if (!s || s.revoked_at || !s.is_admin || s.clinic_id !== actor.clinicId) return fail(403, "clinic admin only");
  return null;
}

function sanitize(raw: unknown): Appointment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const appointmentId = s(r.appointmentId, 64);
  const patientId = s(r.patientId, 64);
  const date = s(r.date, 10);
  const time = s(r.time, 5);
  if (!appointmentId || !patientId || !isIsoDate(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const phone = typeof r.phone === "string" && /^\+\d{8,15}$/.test(r.phone) ? r.phone : null;
  const pref = r.contactPreference === "voice" || r.contactPreference === "none" ? r.contactPreference : "text";
  const language = /^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(String(r.language || "")) ? String(r.language) : "en";
  return {
    appointmentId, patientId, date, time,
    provider: s(r.provider, 60), location: s(r.location, 60), visitType: s(r.visitType, 40) || "clinic",
    phone, language, contactPreference: pref, careGapConsent: r.careGapConsent === true,
  };
}

export async function importAppointments(deps: ReminderDeps, actor: Actor, rows: unknown, mode: unknown): Promise<Result<{ imported: number; mode: string }>> {
  const denied = await requireAdmin(deps, actor);
  if (denied) return denied;
  if (!Array.isArray(rows)) return fail(400, "appointments must be a list");
  if (rows.length > 10000) return fail(413, "up to 10000 appointments per import");
  const m = mode === "upsert" ? "upsert" : "replace";
  const clean: Appointment[] = [];
  const seen = new Set<string>();
  for (const raw of rows) {
    const a = sanitize(raw);
    if (!a) return fail(400, "an appointment row is not valid");
    if (seen.has(a.appointmentId)) return fail(400, "duplicate appointment id");
    seen.add(a.appointmentId);
    clean.push(a);
  }
  const imported = await deps.store.saveAppointments((actor as Extract<Actor, { kind: "staff" }>).clinicId, clean, m);
  await deps.audit({ action: "clinic.appointments.imported", count: imported, actorRole: (actor as Extract<Actor, { kind: "staff" }>).role });
  return { ok: true, data: { imported, mode: m } };
}

export async function setReminderTemplate(deps: ReminderDeps, actor: Actor, language: unknown, template: unknown): Promise<Result<{ language: string }>> {
  const denied = await requireAdmin(deps, actor);
  if (denied) return denied;
  const lang = String(language || "").toLowerCase();
  if (!/^[a-z]{2,3}$/.test(lang)) return fail(400, "language must be a 2 or 3 letter code");
  const t = template as Record<string, unknown> | null;
  const fields = ["sms", "voice", "gapPrefix", "stop", "help"] as const;
  if (!t || fields.some((f) => typeof t[f] !== "string" || (t[f] as string).length > 400)) return fail(400, "template needs sms, voice, gapPrefix, stop, and help text");
  if (!/STOP/.test(String(t.stop))) return fail(400, "the opt out line must include the word STOP");
  const clean = Object.fromEntries(fields.map((f) => [f, String(t[f])])) as unknown as ReminderTemplate;
  await deps.store.setTemplate((actor as Extract<Actor, { kind: "staff" }>).clinicId, lang, clean);
  await deps.audit({ action: "clinic.reminders.template", count: 1, actorRole: (actor as Extract<Actor, { kind: "staff" }>).role });
  return { ok: true, data: { language: lang } };
}

export interface ReminderOverview {
  today: string;
  sending: SendingState;
  languages: string[];
  upcoming: {
    appointmentId: string;
    patientId: string;
    date: string;
    time: string;
    provider: string;
    location: string;
    visitType: string;
    contactPreference: string;
    language: string;
    reachable: boolean;
    optedOut: boolean;
    reminders: Pick<PlannedReminder, "sendOn" | "offsetDays" | "channel" | "status" | "body" | "includesGapLine" | "languageFallback">[];
    sentCount: number;
  }[];
  staffCalls: { appointmentId: string; patientId: string; date: string; reason: string }[];
  optOutCount: number;
}

/** Builds the plan from imported appointments, panel care gaps, opt outs, and the send log. */
export async function buildPlan(deps: ReminderDeps, clinicId: string, today: string, clinicName: string) {
  const appts = await deps.store.listAppointments(clinicId);
  const optHashes = await deps.store.listOptOutHashes();
  const logs = (await deps.store.listLogs(clinicId)).filter((l) => l.status === "sent");
  const templates = await deps.store.getTemplates(clinicId);
  const panel = await deps.panelStore.listPanel(clinicId);
  const gapRows = evaluateCareGapPanel(panel, calendarYearPeriod(Number(today.slice(0, 4)))).rows;
  const gapsByPatient: Record<string, string[]> = {};
  for (const r of gapRows) {
    gapsByPatient[r.patientId] = Object.entries(r.measures).filter(([, m]) => m?.needsOutreach).map(([id]) => id);
  }
  // Plan on keyed phone hashes so caps and opt outs never need the number in plain text.
  const hashToPhone = new Map<string, string>();
  const hashed = appts.map((a) => {
    if (!a.phone) return a;
    const h = deps.hashPhone(a.phone);
    hashToPhone.set(h, a.phone);
    return { ...a, phone: h };
  });
  const plan = planReminders({
    appointments: hashed,
    today,
    options: { clinicName, templates },
    gapsByPatient,
    optedOutPhones: optHashes,
    sent: logs.map((l) => ({ phone: l.phoneHash, sentOn: l.sendOn })),
  });
  return { appts: hashed, plan, optHashes, logs, hashToPhone, templates };
}

export async function reminderOverview(
  deps: ReminderDeps,
  actor: Actor,
  input: { today: string; clinicName: string; sending: SendingState; horizonDays?: number },
): Promise<Result<ReminderOverview>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const { appts, plan, optHashes, logs, templates } = await buildPlan(deps, actor.clinicId, input.today, input.clinicName);
  const horizon = new Date(Date.parse(`${input.today}T00:00:00Z`) + (input.horizonDays ?? 30) * 86400000).toISOString().slice(0, 10);
  const upcoming = appts
    .filter((a) => a.date >= input.today && a.date <= horizon)
    .sort((x, y) => `${x.date} ${x.time}`.localeCompare(`${y.date} ${y.time}`))
    .map((a) => ({
      appointmentId: a.appointmentId,
      patientId: a.patientId,
      date: a.date,
      time: a.time,
      provider: a.provider,
      location: a.location,
      visitType: a.visitType,
      contactPreference: a.contactPreference,
      language: a.language,
      reachable: !!a.phone && a.contactPreference !== "none",
      optedOut: !!a.phone && optHashes.has(a.phone),
      reminders: plan.filter((p) => p.appointmentId === a.appointmentId).map(({ sendOn, offsetDays, channel, status, body, includesGapLine, languageFallback }) => ({ sendOn, offsetDays, channel, status, body, includesGapLine, languageFallback })),
      sentCount: logs.filter((l) => a.phone && l.phoneHash === a.phone).length,
    }));
  const staffCalls = upcoming
    .filter((u) => !u.reachable || u.optedOut)
    .map((u) => ({
      appointmentId: u.appointmentId,
      patientId: u.patientId,
      date: u.date,
      reason: u.optedOut ? "Opted out of texts" : u.contactPreference === "none" ? "Asked for no reminders" : "No reachable phone",
    }));
  await deps.audit({ action: "clinic.reminders.viewed", count: upcoming.length, actorRole: actor.role });
  return {
    ok: true,
    data: {
      today: input.today,
      sending: input.sending,
      languages: [...new Set([...Object.keys(DEFAULT_TEMPLATES), ...Object.keys(templates)])],
      upcoming,
      staffCalls,
      optOutCount: upcoming.filter((u) => u.optedOut).length,
    },
  };
}

export type Sender = (channel: "sms" | "voice", to: string, body: string) => Promise<boolean>;

/**
 * Sends today's queued reminders. When sending is off, nothing is sent and nothing is logged;
 * the result is the dry run list staff can review.
 */
export async function dispatchToday(
  deps: ReminderDeps,
  actor: Actor,
  input: { today: string; clinicName: string; sending: SendingState; nowIso: string; localHour: number; send: Sender | null },
): Promise<Result<{ sent: number; failed: number; dryRun: number; message: string }>> {
  const denied = await requireAdmin(deps, actor);
  if (denied) return denied;
  const clinicId = (actor as Extract<Actor, { kind: "staff" }>).clinicId;
  const { appts, plan, hashToPhone } = await buildPlan(deps, clinicId, input.today, input.clinicName);
  const due = plan.filter((p) => p.status === "queued" && p.sendOn === input.today && p.channel !== "staff");
  if (!input.sending.enabled || !input.send) {
    return { ok: true, data: { sent: 0, failed: 0, dryRun: due.length, message: input.sending.message } };
  }
  if (input.localHour < 8 || input.localHour >= 21) {
    return { ok: true, data: { sent: 0, failed: 0, dryRun: due.length, message: "Outside 8 AM to 9 PM clinic time. Nothing sent." } };
  }
  let sent = 0;
  let failed = 0;
  for (const p of due) {
    const a = appts.find((x) => x.appointmentId === p.appointmentId);
    const hash = a?.phone || "";
    const to = hashToPhone.get(hash);
    if (!to) continue;
    const ok = await input.send(p.channel as "sms" | "voice", to, p.body);
    await deps.store.addLog(clinicId, { appointmentId: p.appointmentId, phoneHash: hash, sendOn: p.sendOn, channel: p.channel as "sms" | "voice", status: ok ? "sent" : "failed", at: input.nowIso });
    if (ok) sent++; else failed++;
  }
  await deps.audit({ action: "clinic.reminders.dispatched", count: sent, actorRole: (actor as Extract<Actor, { kind: "staff" }>).role });
  return { ok: true, data: { sent, failed, dryRun: 0, message: `${sent} sent, ${failed} failed.` } };
}
