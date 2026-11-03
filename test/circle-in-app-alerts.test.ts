import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildCircleAlert,
  CIRCLE_ALERT_TEXT,
  circleSeverity,
  kindForRule,
  MemoryCircleAlertSink,
  notifyCircle,
} from "../src/lib/circle-alerts/notify";
import { MemoryAlertQueueStore } from "../src/lib/clinic/alerts/queue";
import { optInWellness, tickWellness } from "../src/lib/clinic/actions";
import { handleClinicHttp } from "../src/lib/clinic/http";
import type { Actor } from "../src/lib/clinic/logic";
import { MemoryClinicStore } from "../src/lib/clinic/store";

const PATIENT = "11111111-2222-4333-8444-555555555555";

async function setup(patientId: string | null = PATIENT) {
  const store = new MemoryClinicStore();
  const queue = new MemoryAlertQueueStore();
  const sink = new MemoryCircleAlertSink();
  const clinic = await store.createClinic("Synthetic FQHC");
  const staff = await store.addStaff(clinic.id, "provider", "Dr Synthetic", "+15555550111");
  const [patient] = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-0077", age: 70, has_diabetes: true, has_hypertension: true, last_a1c: null, last_a1c_date: null,
    bp_systolic: null, bp_diastolic: null, last_bp_date: null, next_visit_date: null, patient_id: patientId,
  }]);
  const staffActor: Actor = { kind: "staff", clinicId: clinic.id, staffId: staff.id, role: "provider" };
  return { store, queue, sink, patient, staffActor };
}

function postReading(clinicPatientId: string, reading: Record<string, unknown>) {
  return new Request("http://x/api/clinic", {
    method: "POST",
    body: JSON.stringify({ action: "reading", clinicPatientId, recorded_on: "2026-11-02", ...reading }),
  });
}

// Every value a reading could carry, as text. None may appear in a row.
function assertNoValues(row: unknown, values: number[]) {
  const json = JSON.stringify(row);
  for (const v of values) assert.equal(json.includes(String(v)), false, `value ${v} leaked`);
  assert.doesNotMatch(json, /mmHg|mg\/dL|A1C|LDL|systolic|diastolic|glucose/i);
  // No digits at all in the shared text fields.
  const r = row as { metric: string; recommendation: string };
  assert.doesNotMatch(r.metric + r.recommendation, /\d/);
}

test("out-of-range reading writes one in-app alert with type, severity, time, template only", async () => {
  const { store, queue, sink, patient } = await setup();
  const res = await handleClinicHttp(postReading(patient.id, { kind: "bp", systolic: 187, diastolic: 123 }), {
    store, actor: { kind: "patient", patientId: PATIENT }, smsEnv: {} as never, asOf: "2026-11-02",
    alertQueue: queue, circleAlerts: sink, nowIso: () => "2026-11-02T09:00:00Z",
  });
  assert.equal(res.status, 200);
  assert.equal(sink.rows.length, 1);
  const row = sink.rows[0];
  assert.deepEqual(Object.keys(row).sort(), ["delivery_count", "delivery_summary", "fired_at", "metric", "patient_id", "recommendation", "severity"]);
  assert.equal(row.patient_id, PATIENT);
  assert.equal(row.severity, "critical");
  assert.equal(row.metric, CIRCLE_ALERT_TEXT.reading_out_of_range.metric);
  assert.equal(row.recommendation, CIRCLE_ALERT_TEXT.reading_out_of_range.text);
  assert.equal(row.fired_at, "2026-11-02T09:00:00.000Z");
  assert.equal(row.delivery_summary, null);
  assertNoValues(row, [187, 123]);
});

test("clinic alert rule (threshold) maps to the clinic alert template, informational", async () => {
  const { store, queue, sink, patient } = await setup();
  await handleClinicHttp(postReading(patient.id, { kind: "glucose", glucose: 191 }), {
    store, actor: { kind: "patient", patientId: PATIENT }, smsEnv: {} as never, asOf: "2026-11-02",
    alertQueue: queue, circleAlerts: sink, nowIso: () => "2026-11-02T09:00:00Z",
  });
  assert.equal(sink.rows.length, 1);
  assert.equal(sink.rows[0].metric, CIRCLE_ALERT_TEXT.clinic_alert_rule.metric);
  assert.equal(sink.rows[0].severity, "informational");
  assertNoValues(sink.rows[0], [191]);
});

test("normal reading writes nothing; unlinked clinic patient writes nothing", async () => {
  const a = await setup();
  await handleClinicHttp(postReading(a.patient.id, { kind: "bp", systolic: 118, diastolic: 76 }), {
    store: a.store, actor: { kind: "patient", patientId: PATIENT }, smsEnv: {} as never, asOf: "2026-11-02",
    alertQueue: a.queue, circleAlerts: a.sink,
  });
  assert.equal(a.sink.rows.length, 0);
  assert.equal(buildCircleAlert({ patientId: null, kind: "reading_out_of_range", severity: "critical", firedAt: "2026-11-02T09:00:00Z" }), null);
  assert.equal(buildCircleAlert({ patientId: "not-a-uuid", kind: "reading_out_of_range", severity: "critical", firedAt: "2026-11-02T09:00:00Z" }), null);
});

test("a failing in-app sink does not fail the reading", async () => {
  const { store, queue, patient } = await setup();
  const broken = { insert: async () => { throw new Error("down"); } };
  const res = await handleClinicHttp(postReading(patient.id, { kind: "bp", systolic: 190, diastolic: 100 }), {
    store, actor: { kind: "patient", patientId: PATIENT }, smsEnv: {} as never, asOf: "2026-11-02",
    alertQueue: queue, circleAlerts: broken,
  });
  assert.equal(res.status, 200);
  assert.equal(await notifyCircle(broken, { patientId: PATIENT, kind: "clinic_alert_rule", severity: "informational", firedAt: "x" }), false);
});

test("missed wellness check-in writes one in-app alert per missed window", async () => {
  const { store, sink, patient, staffActor } = await setup();
  await optInWellness(store, { kind: "patient", patientId: PATIENT }, {
    clinicPatientId: patient.id, optedIn: true, livesAlone: true, phone: "+15555550122", familyPhone: "+15555550133",
  });
  const env = { accountSid: "ACexample", authToken: "token-example", from: "+15555550100" };
  const fetchImpl = async () => new Response("{}", { status: 201 });
  const t1 = await tickWellness(store, staffActor, { nowIso: "2026-11-02T12:00:00Z", env, fetchImpl, circleAlerts: sink });
  assert.equal(t1.ok, true);
  await tickWellness(store, staffActor, { nowIso: "2026-11-03T12:00:00Z", env, fetchImpl, circleAlerts: sink });
  assert.equal(sink.rows.length, 1);
  assert.equal(sink.rows[0].metric, CIRCLE_ALERT_TEXT.wellness_check_missed.metric);
  assert.equal(sink.rows[0].severity, "critical");
  assert.equal(sink.rows[0].patient_id, PATIENT);
  assertNoValues(sink.rows[0], []);
  assert.doesNotMatch(JSON.stringify(sink.rows[0]), /5555550/);
});

test("rule and severity mapping", () => {
  assert.equal(kindForRule("clinic_threshold"), "clinic_alert_rule");
  for (const r of ["bp_crisis", "bp_stage2_repeated", "glucose_very_low", "glucose_very_high"] as const) {
    assert.equal(kindForRule(r), "reading_out_of_range");
  }
  assert.equal(circleSeverity("critical"), "critical");
  assert.equal(circleSeverity("high"), "critical");
  assert.equal(circleSeverity("informational"), "informational");
});

test("templates carry no numbers, units, or lab names", () => {
  for (const t of Object.values(CIRCLE_ALERT_TEXT)) assertNoValues({ metric: t.metric, recommendation: t.text }, []);
});

test("in-app alert module makes no SMS, email, or model call", () => {
  const src = readFileSync("src/lib/circle-alerts/notify.ts", "utf8") + readFileSync("src/lib/circle-alerts/supabase-sink.ts", "utf8");
  assert.doesNotMatch(src, /twilio|resend|anthropic|sendSms|sendEmail|deliverSms|fetch\(/i);
});
