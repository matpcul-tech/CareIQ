/**
 * Clinic alert queue: storage interface, memory store, and staff actions.
 * Only severity (and an optional LE8 band) is stored unencrypted with the alert. The reading,
 * rule, patient id, and notes are encrypted by the Supabase store (src/lib/crypto.ts).
 * Workflow fields (status, staff id, timestamps) are plain so the queue can be sorted.
 * General guidance for the care team, not a diagnosis.
 */

import { isActiveStaff, type Actor, type HomeReading, type Thresholds } from "../logic";
import type { ClinicStore, PatientRecord } from "../store";
import { evaluateReading, RULE_TEXT, SEVERITY_ORDER, type AlertRule, type AlertSeverity } from "./rules";

export type AlertStatus = "new" | "acknowledged" | "resolved";

/** Encrypted at rest. */
export interface AlertPayload {
  patientExternalId: string;
  readingKind: "bp" | "glucose";
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
  recordedOn: string;
  rule: AlertRule;
}

export interface AlertNote {
  at: string;
  staffId: string;
  action: "acknowledged" | "resolved";
  text: string;
}

export interface QueueAlert {
  id: string;
  clinicId: string;
  clinicPatientId: string;
  severity: AlertSeverity;
  le8Band: string | null;
  status: AlertStatus;
  createdAt: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  payload: AlertPayload;
  notes: AlertNote[];
}

export interface AlertQueueStore {
  create(alert: Omit<QueueAlert, "id">): Promise<QueueAlert>;
  list(clinicId: string): Promise<QueueAlert[]>;
  get(id: string): Promise<QueueAlert | null>;
  update(id: string, patch: Partial<Pick<QueueAlert, "status" | "acknowledgedBy" | "acknowledgedAt" | "resolvedBy" | "resolvedAt" | "notes">>): Promise<QueueAlert | null>;
}

export class MemoryAlertQueueStore implements AlertQueueStore {
  rows: QueueAlert[] = [];
  async create(alert: Omit<QueueAlert, "id">): Promise<QueueAlert> {
    const row = { ...structuredClone(alert), id: crypto.randomUUID() };
    this.rows.push(row);
    return structuredClone(row);
  }
  async list(clinicId: string) {
    return this.rows.filter((r) => r.clinicId === clinicId).map((r) => structuredClone(r));
  }
  async get(id: string) {
    const r = this.rows.find((x) => x.id === id);
    return r ? structuredClone(r) : null;
  }
  async update(id: string, patch: Parameters<AlertQueueStore["update"]>[1]) {
    const r = this.rows.find((x) => x.id === id);
    if (!r) return null;
    Object.assign(r, structuredClone(patch));
    return structuredClone(r);
  }
}

export type AlertAuditEvent = {
  action: "clinic.alert.created" | "clinic.alert.acknowledged" | "clinic.alert.resolved" | "clinic.alert.listed";
  alertId: string | null;
  severity: AlertSeverity | null;
  actorRole: string;
  success: boolean;
};
export type AlertAudit = (event: AlertAuditEvent) => Promise<void>;

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };
const fail = (status: number, error: string) => ({ ok: false as const, status, error });

/**
 * Called after a home reading is saved for a linked patient. Creates at most one alert,
 * and skips it when the same rule already has an open alert for that patient.
 */
export async function raiseAlertForReading(
  clinicStore: ClinicStore,
  queue: AlertQueueStore,
  audit: AlertAudit,
  input: { patient: PatientRecord; reading: HomeReading & { id?: string }; thresholds: Thresholds; nowIso: string },
): Promise<QueueAlert | null> {
  const history = await clinicStore.listReadings(input.patient.id);
  const hit = evaluateReading(input.reading, history, input.thresholds);
  if (!hit) return null;
  const open = (await queue.list(input.patient.clinic_id)).filter(
    (a) => a.clinicPatientId === input.patient.id && a.status !== "resolved" && a.payload.rule === hit.rule,
  );
  if (open.length > 0 && hit.severity !== "critical") return null;
  const alert = await queue.create({
    clinicId: input.patient.clinic_id,
    clinicPatientId: input.patient.id,
    severity: hit.severity,
    le8Band: null,
    status: "new",
    createdAt: input.nowIso,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    payload: {
      patientExternalId: input.patient.external_id,
      readingKind: input.reading.kind,
      systolic: input.reading.systolic ?? null,
      diastolic: input.reading.diastolic ?? null,
      glucose: input.reading.glucose ?? null,
      recordedOn: input.reading.recorded_on,
      rule: hit.rule,
    },
    notes: [],
  });
  await audit({ action: "clinic.alert.created", alertId: alert.id, severity: alert.severity, actorRole: "system", success: true });
  return alert;
}

export interface QueueItem {
  id: string;
  severity: AlertSeverity;
  status: AlertStatus;
  patientId: string;
  readingType: "bp" | "glucose";
  reading: string;
  recordedOn: string;
  createdAt: string;
  rule: AlertRule;
  guidance: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  notes: (AlertNote & { staffName: string })[];
}

/** Open alerts first, then severity (critical first), then oldest first. */
export function sortQueue<T extends { status: AlertStatus; severity: AlertSeverity; createdAt: string }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    Number(a.status === "resolved") - Number(b.status === "resolved") ||
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    a.createdAt.localeCompare(b.createdAt),
  );
}

function toItem(a: QueueAlert, names: Record<string, string> = {}): QueueItem {
  const p = a.payload;
  const who = (id: string | null) => (id ? names[id] || "Clinic staff" : null);
  return {
    id: a.id,
    severity: a.severity,
    status: a.status,
    patientId: p.patientExternalId,
    readingType: p.readingKind,
    reading: p.readingKind === "bp" ? `${p.systolic}/${p.diastolic} mmHg` : `${p.glucose} mg/dL`,
    recordedOn: p.recordedOn,
    createdAt: a.createdAt,
    rule: p.rule,
    guidance: RULE_TEXT[p.rule],
    acknowledgedBy: who(a.acknowledgedBy),
    acknowledgedAt: a.acknowledgedAt,
    resolvedBy: who(a.resolvedBy),
    resolvedAt: a.resolvedAt,
    notes: a.notes.map((n) => ({ ...n, staffName: who(n.staffId) || "Clinic staff" })),
  };
}

export async function listAlertQueue(
  queue: AlertQueueStore,
  audit: AlertAudit,
  actor: Actor,
  opts: { includeResolved?: boolean; staffNames?: Record<string, string> } = {},
): Promise<Result<{ items: QueueItem[]; open: number }>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const all = (await queue.list(actor.clinicId)).filter((a) => a.clinicId === actor.clinicId);
  const items = sortQueue(all.filter((a) => opts.includeResolved || a.status !== "resolved")).map((a) => toItem(a, opts.staffNames));
  await audit({ action: "clinic.alert.listed", alertId: null, severity: null, actorRole: actor.role, success: true });
  return { ok: true, data: { items, open: all.filter((a) => a.status !== "resolved").length } };
}

export async function updateAlertStatus(
  queue: AlertQueueStore,
  audit: AlertAudit,
  actor: Actor,
  input: { alertId: string; action: "acknowledge" | "resolve"; note?: string; nowIso: string; staffNames?: Record<string, string> },
): Promise<Result<QueueItem>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const alert = await queue.get(input.alertId);
  if (!alert || alert.clinicId !== actor.clinicId) return fail(404, "alert not found");
  const note = (input.note || "").trim();
  if (note.length > 500) return fail(400, "note is longer than 500 characters");
  if (alert.status === "resolved") return fail(409, "alert is already resolved");
  if (input.action === "acknowledge" && alert.status !== "new") return fail(409, "alert is already acknowledged");
  if (input.action === "resolve" && !note) return fail(400, "a note is required to resolve");
  const notes = note
    ? [...alert.notes, { at: input.nowIso, staffId: actor.staffId, action: input.action === "acknowledge" ? "acknowledged" as const : "resolved" as const, text: note }]
    : alert.notes;
  const patch = input.action === "acknowledge"
    ? { status: "acknowledged" as const, acknowledgedBy: actor.staffId, acknowledgedAt: input.nowIso, notes }
    : {
        status: "resolved" as const,
        resolvedBy: actor.staffId,
        resolvedAt: input.nowIso,
        acknowledgedBy: alert.acknowledgedBy ?? actor.staffId,
        acknowledgedAt: alert.acknowledgedAt ?? input.nowIso,
        notes,
      };
  const updated = await queue.update(alert.id, patch);
  if (!updated) return fail(404, "alert not found");
  await audit({
    action: input.action === "acknowledge" ? "clinic.alert.acknowledged" : "clinic.alert.resolved",
    alertId: alert.id,
    severity: alert.severity,
    actorRole: actor.role,
    success: true,
  });
  return { ok: true, data: toItem(updated, input.staffNames) };
}

export const noAudit: AlertAudit = async () => {};
