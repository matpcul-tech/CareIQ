import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  listAlertQueue,
  MemoryAlertQueueStore,
  noAudit,
  raiseAlertForReading,
  sortQueue,
  updateAlertStatus,
  type AlertAuditEvent,
} from "../src/lib/clinic/alerts/queue";
import { evaluateReading } from "../src/lib/clinic/alerts/rules";
import { handleClinicHttp } from "../src/lib/clinic/http";
import { DEFAULT_THRESHOLDS, type HomeReading } from "../src/lib/clinic/logic";
import { MemoryClinicStore } from "../src/lib/clinic/store";

const T = DEFAULT_THRESHOLDS;
const bp = (s: number, d: number, on = "2026-11-02"): HomeReading => ({ kind: "bp", systolic: s, diastolic: d, glucose: null, recorded_on: on });
const glu = (g: number): HomeReading => ({ kind: "glucose", systolic: null, diastolic: null, glucose: g, recorded_on: "2026-11-02" });

test("BP at or above 180/120 is critical (either number)", () => {
  assert.deepEqual(evaluateReading(bp(180, 100), [], T), { rule: "bp_crisis", severity: "critical" });
  assert.deepEqual(evaluateReading(bp(150, 120), [], T), { rule: "bp_crisis", severity: "critical" });
  assert.notEqual(evaluateReading(bp(179, 119), [], T)?.rule, "bp_crisis");
});

test("repeated stage 2 BP within 7 days is high; a single one uses the clinic threshold", () => {
  assert.deepEqual(evaluateReading(bp(145, 85), [], T), { rule: "clinic_threshold", severity: "informational" });
  assert.deepEqual(evaluateReading(bp(145, 85), [bp(142, 91, "2026-10-30")], T), { rule: "bp_stage2_repeated", severity: "high" });
  // 7 days earlier is outside the window.
  assert.equal(evaluateReading(bp(145, 85), [bp(142, 91, "2026-10-26")], T)?.rule, "clinic_threshold");
  // A normal earlier reading does not count.
  assert.equal(evaluateReading(bp(145, 85), [bp(120, 70, "2026-11-01")], T)?.rule, "clinic_threshold");
  assert.equal(evaluateReading(bp(118, 76), [], T), null);
});

test("glucose under 54 is critical, over 300 is high, boundaries exact", () => {
  assert.deepEqual(evaluateReading(glu(53), [], T), { rule: "glucose_very_low", severity: "critical" });
  assert.equal(evaluateReading(glu(54), [], T)?.rule, "clinic_threshold"); // still at or under the clinic 70 low
  assert.deepEqual(evaluateReading(glu(301), [], T), { rule: "glucose_very_high", severity: "high" });
  assert.equal(evaluateReading(glu(300), [], T)?.rule, "clinic_threshold"); // over clinic 180 high
  assert.equal(evaluateReading(glu(110), [], T), null);
});

async function setup() {
  const store = new MemoryClinicStore();
  const queue = new MemoryAlertQueueStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const staff = await store.addStaff(clinic.id, "provider", "Dr Synthetic");
  const [patient] = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-0042", age: 61, has_diabetes: true, has_hypertension: true, last_a1c: null, last_a1c_date: null,
    bp_systolic: null, bp_diastolic: null, last_bp_date: null, next_visit_date: null, patient_id: "app-user-42",
  }]);
  const actor = { kind: "staff" as const, clinicId: clinic.id, staffId: staff.id, role: staff.role };
  return { store, queue, clinic, staff, patient, actor };
}

test("raise, list sorted by severity then age, acknowledge and resolve with who, when, and note", async () => {
  const { store, queue, patient, actor, staff } = await setup();
  const events: AlertAuditEvent[] = [];
  const audit = async (e: AlertAuditEvent) => { events.push(e); };
  const r1 = await store.addReading({ ...bp(150, 95), clinic_patient_id: patient.id });
  const a1 = await raiseAlertForReading(store, queue, audit, { patient, reading: r1, thresholds: T, nowIso: "2026-11-02T10:00:00Z" });
  const r2 = await store.addReading({ ...glu(48), clinic_patient_id: patient.id });
  const a2 = await raiseAlertForReading(store, queue, audit, { patient, reading: r2, thresholds: T, nowIso: "2026-11-02T11:00:00Z" });
  assert.equal(a1?.severity, "informational");
  assert.equal(a2?.severity, "critical");
  const list = await listAlertQueue(queue, audit, actor, { staffNames: { [staff.id]: "Dr Synthetic" } });
  assert.ok(list.ok);
  if (!list.ok) return;
  assert.deepEqual(list.data.items.map((i) => i.severity), ["critical", "informational"]);
  const top = list.data.items[0];
  assert.equal(top.patientId, "SYN-0042");
  assert.equal(top.readingType, "glucose");
  assert.equal(top.reading, "48 mg/dL");
  assert.equal(top.status, "new");

  assert.equal((await updateAlertStatus(queue, audit, actor, { alertId: a2!.id, action: "resolve", nowIso: "2026-11-02T12:00:00Z" })).ok, false); // note required
  const ack = await updateAlertStatus(queue, audit, actor, { alertId: a2!.id, action: "acknowledge", note: "Called patient", nowIso: "2026-11-02T12:00:00Z", staffNames: { [staff.id]: "Dr Synthetic" } });
  assert.ok(ack.ok && ack.data.status === "acknowledged" && ack.data.acknowledgedBy === "Dr Synthetic" && ack.data.acknowledgedAt === "2026-11-02T12:00:00Z");
  assert.equal((await updateAlertStatus(queue, audit, actor, { alertId: a2!.id, action: "acknowledge", nowIso: "x" })).ok, false);
  const res = await updateAlertStatus(queue, audit, actor, { alertId: a2!.id, action: "resolve", note: "Rechecked at 96", nowIso: "2026-11-02T13:00:00Z" });
  assert.ok(res.ok && res.data.status === "resolved" && res.data.resolvedAt === "2026-11-02T13:00:00Z" && res.data.notes.length === 2);
  assert.equal((await updateAlertStatus(queue, audit, actor, { alertId: a2!.id, action: "resolve", note: "again", nowIso: "x" })).ok, false);
  const after = await listAlertQueue(queue, noAudit, actor);
  assert.ok(after.ok && after.data.items.length === 1 && after.data.open === 1);
  assert.deepEqual(events.map((e) => e.action), [
    "clinic.alert.created", "clinic.alert.created", "clinic.alert.listed", "clinic.alert.acknowledged", "clinic.alert.resolved",
  ]);
  // Audit events carry no reading values.
  assert.equal(/glucose|systolic|mg\/dL|"value"/.test(JSON.stringify(events)), false);
  assert.deepEqual(Object.keys(events[0]).sort(), ["action", "actorRole", "alertId", "severity", "success"]);
});

test("open alert for the same rule is not duplicated unless critical", async () => {
  const { store, queue, patient } = await setup();
  for (const g of [250, 260]) {
    const r = await store.addReading({ ...glu(g), clinic_patient_id: patient.id });
    await raiseAlertForReading(store, queue, noAudit, { patient, reading: r, thresholds: T, nowIso: "2026-11-02T10:00:00Z" });
  }
  assert.equal(queue.rows.length, 1);
  for (const s of [185, 190]) {
    const r = await store.addReading({ ...bp(s, 100), clinic_patient_id: patient.id });
    await raiseAlertForReading(store, queue, noAudit, { patient, reading: r, thresholds: T, nowIso: "2026-11-02T10:00:00Z" });
  }
  assert.equal(queue.rows.filter((r) => r.severity === "critical").length, 2);
});

test("queue is clinic staff only and scoped to the staff member's clinic", async () => {
  const { store, queue, patient, actor } = await setup();
  const r = await store.addReading({ ...glu(40), clinic_patient_id: patient.id });
  const a = await raiseAlertForReading(store, queue, noAudit, { patient, reading: r, thresholds: T, nowIso: "2026-11-02T10:00:00Z" });
  assert.equal((await listAlertQueue(queue, noAudit, { kind: "patient", patientId: "app-user-42" })).ok, false);
  assert.equal((await listAlertQueue(queue, noAudit, { ...actor, revoked: true })).ok, false);
  const other = await store.createClinic("Other");
  const otherStaff = { kind: "staff" as const, clinicId: other.id, staffId: "s2", role: "provider" as const };
  const otherList = await listAlertQueue(queue, noAudit, otherStaff);
  assert.ok(otherList.ok && otherList.data.items.length === 0);
  assert.equal((await updateAlertStatus(queue, noAudit, otherStaff, { alertId: a!.id, action: "acknowledge", nowIso: "x" })).ok, false);
  assert.equal((await updateAlertStatus(queue, noAudit, actor, { alertId: a!.id, action: "resolve", note: "x".repeat(501), nowIso: "x" })).ok, false);
});

test("sortQueue: open before resolved, severity, then oldest first", () => {
  const s = sortQueue([
    { status: "resolved" as const, severity: "critical" as const, createdAt: "2026-01-01" },
    { status: "new" as const, severity: "high" as const, createdAt: "2026-01-03" },
    { status: "acknowledged" as const, severity: "critical" as const, createdAt: "2026-01-05" },
    { status: "new" as const, severity: "high" as const, createdAt: "2026-01-02" },
  ]);
  assert.deepEqual(s.map((x) => `${x.status}:${x.createdAt}`), ["acknowledged:2026-01-05", "new:2026-01-02", "new:2026-01-03", "resolved:2026-01-01"]);
});

test("home reading through the clinic API creates a queue alert; queue failure does not fail the reading", async () => {
  const { store, queue, patient } = await setup();
  const patientActor = { kind: "patient" as const, patientId: "app-user-42" };
  const post = (deps: Parameters<typeof handleClinicHttp>[1]) => handleClinicHttp(new Request("http://x/api/clinic", {
    method: "POST",
    body: JSON.stringify({ action: "reading", clinicPatientId: patient.id, kind: "bp", systolic: 182, diastolic: 110, recorded_on: "2026-11-02" }),
  }), deps);
  const res = await post({ store, actor: patientActor, smsEnv: {} as never, asOf: "2026-11-02", alertQueue: queue, nowIso: () => "2026-11-02T09:00:00Z" });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, unknown>;
  assert.equal(body.queue_severity, "critical");
  assert.equal(queue.rows.length, 1);
  const broken = { create: async () => { throw new Error("table missing"); }, list: async () => [], get: async () => null, update: async () => null };
  const res2 = await post({ store, actor: patientActor, smsEnv: {} as never, asOf: "2026-11-02", alertQueue: broken });
  assert.equal(res2.status, 200);
});

test("alert files: sources cited, guidance label, encryption, no race or Native fields, no long dashes", () => {
  const rules = readFileSync("src/lib/clinic/alerts/rules.ts", "utf8");
  assert.match(rules, /AHA/);
  assert.match(rules, /ADA Standards of Care/);
  assert.match(rules, /not a diagnosis/);
  const sb = readFileSync("src/lib/clinic/alerts/supabase-queue-store.ts", "utf8");
  assert.match(sb, /encryptJson\(alert\.payload/);
  assert.match(sb, /encryptJson\(patch\.notes/);
  const sql = readFileSync("supabase/migrations/0014_clinic_alert_queue.sql", "utf8");
  assert.equal(/systolic|diastolic|glucose\s+(numeric|int)/i.test(sql), false);
  for (const f of ["src/lib/clinic/alerts/rules.ts", "src/lib/clinic/alerts/queue.ts", "src/app/clinic/uds/AlertQueue.tsx", "supabase/migrations/0014_clinic_alert_queue.sql", "src/app/api/clinic/alerts/route.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.equal(/\brace\b|ethnic|native|tribal|american indian|alaska/i.test(src), false, f);
    assert.equal(/[\u2013\u2014]/.test(src), false, f);
  }
});
