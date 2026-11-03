import type { AlertSeverity } from "../alerts/rules";
import { isActiveStaff, type Actor } from "../logic";
import type { ClinicStore } from "../store";

/**
 * Staff follow-up call list. Built from open home reading alerts, care gaps, and upcoming
 * appointments. CareIQ does not book visits and has no video; staff call from their own phones.
 */

export type CallOutcome = "reached" | "left_message" | "no_answer" | "wrong_number" | "declined" | "other";
export const CALL_OUTCOMES: { id: CallOutcome; label: string; closes: boolean }[] = [
  { id: "reached", label: "Reached", closes: true },
  { id: "left_message", label: "Left a message", closes: false },
  { id: "no_answer", label: "No answer", closes: false },
  { id: "wrong_number", label: "Wrong number", closes: false },
  { id: "declined", label: "Declined", closes: true },
  { id: "other", label: "Other", closes: false },
];

export interface CallRecord {
  id: string;
  clinicId: string;
  patientId: string;
  staffId: string;
  calledAt: string;
  outcome: CallOutcome;
  note: string;
}

export interface FollowUpCallStore {
  addCall(c: Omit<CallRecord, "id">): Promise<CallRecord>;
  listCalls(clinicId: string): Promise<CallRecord[]>;
}

export class MemoryFollowUpCallStore implements FollowUpCallStore {
  rows: CallRecord[] = [];
  async addCall(c: Omit<CallRecord, "id">) { const r = { ...c, id: `call-${this.rows.length + 1}` }; this.rows.push(r); return r; }
  async listCalls(clinicId: string) { return this.rows.filter((r) => r.clinicId === clinicId); }
}

export interface AlertSignal { patientId: string; severity: AlertSeverity; status: "new" | "acknowledged" | "resolved"; createdAt: string; guidance: string }
export interface GapSignal { patientId: string; gapsDue: string[] }
export interface AppointmentSignal { patientId: string; date: string; visitType: string; reachable: boolean; optedOut: boolean }

export type Priority = 1 | 2 | 3;
export const PRIORITY_LABEL: Record<Priority, string> = { 1: "Call today", 2: "Call soon", 3: "Routine" };

export interface FollowUpRow {
  patientId: string;
  priority: Priority;
  reasons: { kind: "alert" | "appointment" | "care_gap"; text: string; priority: Priority }[];
  /** Newest trigger time, ISO date or timestamp. A closing call after it marks the row done. */
  triggeredAt: string;
  lastCall: (Omit<CallRecord, "clinicId" | "staffId"> & { staffName: string }) | null;
  done: boolean;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a.slice(0, 10)}T00:00:00Z`) - Date.parse(`${b.slice(0, 10)}T00:00:00Z`)) / 86400000);

export function buildFollowUpList(input: {
  today: string;
  alerts: AlertSignal[];
  gaps: GapSignal[];
  appointments: AppointmentSignal[];
  calls: CallRecord[];
  staffNames?: Record<string, string>;
  /** Calls older than this many days no longer close a row. */
  callWindowDays?: number;
}): FollowUpRow[] {
  const rows = new Map<string, FollowUpRow>();
  const row = (pid: string) => {
    let r = rows.get(pid);
    if (!r) { r = { patientId: pid, priority: 3, reasons: [], triggeredAt: "", lastCall: null, done: false }; rows.set(pid, r); }
    return r;
  };
  const add = (pid: string, kind: FollowUpRow["reasons"][number]["kind"], text: string, priority: Priority, at: string) => {
    const r = row(pid);
    r.reasons.push({ kind, text, priority });
    if (priority < r.priority) r.priority = priority;
    if (at > r.triggeredAt) r.triggeredAt = at;
  };

  for (const a of input.alerts) {
    if (a.status === "resolved") continue;
    const p: Priority = a.severity === "critical" ? 1 : a.severity === "high" ? 2 : 3;
    const label = a.severity === "critical" ? "Critical home reading" : a.severity === "high" ? "High home reading" : "Home reading past the clinic threshold";
    add(a.patientId, "alert", `${label}. ${a.guidance}`, p, a.createdAt);
  }
  const gapsBy = new Map(input.gaps.filter((g) => g.gapsDue.length).map((g) => [g.patientId, g.gapsDue]));
  for (const ap of input.appointments) {
    const days = dayDiff(ap.date, input.today);
    if (days < 0 || days > 14) continue;
    if (!ap.reachable || ap.optedOut) {
      const why = ap.optedOut ? "opted out of texts" : "no reachable phone or no reminders wanted";
      if (days <= 7) add(ap.patientId, "appointment", `Visit ${ap.date} (${ap.visitType}): reminders cannot reach them (${why}). Call to confirm.`, days <= 3 ? 2 : 3, input.today);
    }
    const gaps = gapsBy.get(ap.patientId);
    if (gaps) add(ap.patientId, "appointment", `Visit ${ap.date}: plan for open care gaps at the visit.`, 3, input.today);
  }
  for (const [pid, gaps] of gapsBy) add(pid, "care_gap", `Care gaps due: ${gaps.join("; ")}`, 3, `${input.today.slice(0, 4)}-01-01`);

  const window = input.callWindowDays ?? 14;
  const closes = new Set(CALL_OUTCOMES.filter((o) => o.closes).map((o) => o.id));
  const callsBy = new Map<string, CallRecord[]>();
  for (const c of input.calls) callsBy.set(c.patientId, [...(callsBy.get(c.patientId) || []), c]);
  for (const r of rows.values()) {
    const calls = (callsBy.get(r.patientId) || []).sort((a, b) => b.calledAt.localeCompare(a.calledAt));
    const last = calls[0];
    if (last) {
      r.lastCall = { id: last.id, patientId: last.patientId, calledAt: last.calledAt, outcome: last.outcome, note: last.note, staffName: input.staffNames?.[last.staffId] || "Clinic staff" };
      const recent = dayDiff(input.today, last.calledAt) <= window;
      // A closing call clears the row unless something new (for example a new alert) came in after it.
      r.done = recent && closes.has(last.outcome) && last.calledAt >= r.triggeredAt;
    }
    r.reasons.sort((a, b) => a.priority - b.priority);
  }
  return [...rows.values()].sort((a, b) =>
    Number(a.done) - Number(b.done) || a.priority - b.priority || a.patientId.localeCompare(b.patientId));
}

export type FollowUpAuditEvent = { action: "clinic.followups.viewed" | "clinic.followups.call_logged"; count: number; actorRole: string; outcome?: CallOutcome };

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export interface FollowUpDeps {
  clinicStore: ClinicStore;
  calls: FollowUpCallStore;
  audit: (e: FollowUpAuditEvent) => Promise<void>;
  /** Loads the three signal sources for the actor's clinic. */
  signals: (clinicId: string, today: string) => Promise<{ alerts: AlertSignal[]; gaps: GapSignal[]; appointments: AppointmentSignal[] }>;
  now: () => Date;
}

async function activeStaff(deps: FollowUpDeps, actor: Actor | null) {
  if (!actor || !isActiveStaff(actor)) return null;
  const me = await deps.clinicStore.getStaff(actor.staffId);
  if (!me || me.revoked_at || me.clinic_id !== actor.clinicId) return null;
  return { actor, me };
}

export async function viewFollowUps(deps: FollowUpDeps, actor: Actor | null, today: string): Promise<{ ok: true; data: { rows: FollowUpRow[]; open: number; outcomes: typeof CALL_OUTCOMES } } | Fail> {
  const s = await activeStaff(deps, actor);
  if (!s) return fail(403, "clinic staff only");
  const [sig, calls, staff] = await Promise.all([deps.signals(s.me.clinic_id, today), deps.calls.listCalls(s.me.clinic_id), deps.clinicStore.listStaff(s.me.clinic_id)]);
  const rows = buildFollowUpList({ today, ...sig, calls, staffNames: Object.fromEntries(staff.map((x) => [x.id, x.display_name])) });
  const open = rows.filter((r) => !r.done).length;
  await deps.audit({ action: "clinic.followups.viewed", count: open, actorRole: s.me.role });
  return { ok: true, data: { rows, open, outcomes: CALL_OUTCOMES } };
}

export async function logFollowUpCall(deps: FollowUpDeps, actor: Actor | null, input: { patientId: unknown; outcome: unknown; note: unknown }, today: string): Promise<{ ok: true; data: { id: string } } | Fail> {
  const s = await activeStaff(deps, actor);
  if (!s) return fail(403, "clinic staff only");
  const pid = typeof input.patientId === "string" ? input.patientId.trim() : "";
  if (!pid || pid.length > 64) return fail(400, "patient id is required");
  const outcome = CALL_OUTCOMES.find((o) => o.id === input.outcome)?.id;
  if (!outcome) return fail(400, "outcome must be one of " + CALL_OUTCOMES.map((o) => o.id).join(", "));
  const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
  // Only patients on this clinic's follow-up list can be logged.
  const sig = await deps.signals(s.me.clinic_id, today);
  const known = new Set([...sig.alerts.map((a) => a.patientId), ...sig.gaps.map((g) => g.patientId), ...sig.appointments.map((a) => a.patientId)]);
  if (!known.has(pid)) return fail(404, "patient is not on this clinic's follow-up list");
  const rec = await deps.calls.addCall({ clinicId: s.me.clinic_id, patientId: pid, staffId: s.me.id, calledAt: deps.now().toISOString(), outcome, note });
  await deps.audit({ action: "clinic.followups.call_logged", count: 1, actorRole: s.me.role, outcome });
  return { ok: true, data: { id: rec.id } };
}
