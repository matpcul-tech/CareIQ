import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  addCheckin,
  addCircleMember,
  addConcern,
  addHomeReading,
  clinicGaps,
  clinicMeasures,
  clinicTracking,
  clinicWorklist,
  importRegistry,
  listConcerns,
  logMinutes,
  logOutreach,
  maskedInsight,
  notifySms,
  revokeCircleMember,
} from "../src/lib/clinic/actions";
import { handleClinicHttp } from "../src/lib/clinic/http";
import { parseRegistryCsv } from "../src/lib/clinic/logic";
import { deliverSms } from "../src/lib/clinic/sms";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { readClinicActor, signClinicActor } from "../src/lib/clinic/token";
import type { Actor } from "../src/lib/clinic/logic";

const AS_OF = "2026-11-02";

async function seed() {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic", "+15555550100");
  const ma = await store.addStaff(clinic.id, "ma", "MA Synthetic");
  const chw = await store.addStaff(clinic.id, "chw", "CHW Synthetic");
  const csv = await readFile(path.resolve("supabase/seeds/clinic_registry.sample.csv"), "utf8");
  const staff: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const imported = await importRegistry(store, staff, csv);
  assert.equal(imported.ok, true);
  const patients = await store.listPatients(clinic.id);
  return { store, clinic, provider, ma, chw, staff, patients };
}

test("registry csv rejects name columns and ssn ids", () => {
  const badName = parseRegistryCsv("external_id,name\nSYN-1,Ada Example");
  assert.equal("error" in badName, true);
  const badSsn = parseRegistryCsv("external_id\n123-45-6789");
  assert.equal("error" in badSsn, true);
});

test("worklist ranks overdue and uncontrolled synthetic rows", async () => {
  const { store, staff } = await seed();
  const work = await clinicWorklist(store, staff, AS_OF);
  assert.equal(work.ok, true);
  if (!work.ok) return;
  assert.deepEqual(work.data.items.map((item) => item.external_id), ["SYN-1001", "SYN-1005", "SYN-1003"]);
  assert.ok(work.data.items[0].reasons.includes("uncontrolled_a1c"));
  assert.ok(work.data.items[0].reasons.includes("overdue_bp"));
  const measures = await clinicMeasures(store, staff, AS_OF);
  assert.equal(measures.ok, true);
  if (!measures.ok) return;
  assert.equal(measures.data.cms165.denominator, 3);
  assert.equal(measures.data.cms165.numerator, 1);
  assert.equal(measures.data.cms165.rate, 0.333);
  assert.match(measures.data.cms165.label, /Estimate only/);
  assert.match(measures.data.cms165.label, /Not a validated/);
  assert.equal(measures.data.cms122.denominator, 3);
  assert.equal(measures.data.cms122.numerator, 2);
  assert.equal(measures.data.cms122.rate, 0.667);
  assert.match(measures.data.label, /Not a validated/);
  const gaps = await clinicGaps(store, staff, AS_OF);
  assert.equal(gaps.ok, true);
  if (!gaps.ok) return;
  const ids = gaps.data.items.map((item) => item.external_id);
  assert.ok(ids.includes("SYN-1001"));
  assert.equal(ids.includes("SYN-1005"), false);
});

test("only the patient or an admin can add members, and revoke blocks detail", async () => {
  const { store, staff, ma, patients } = await seed();
  const row = patients.find((item) => item.external_id === "SYN-1002");
  assert.ok(row);
  if (!row) return;
  const caregiver: Actor = { kind: "circle", clinicPatientId: row.id, memberId: "temp", role: "caregiver" };
  const denied = await addCircleMember(store, caregiver, {
    clinicPatientId: row.id,
    role: "caregiver",
    displayName: "Family Synthetic",
  });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);

  const patient: Actor = { kind: "patient", patientId: "patient-synthetic" };
  row.patient_id = "patient-synthetic";
  const added = await addCircleMember(store, patient, {
    clinicPatientId: row.id,
    role: "admin",
    displayName: "Admin Synthetic",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  const admin: Actor = { kind: "circle", clinicPatientId: row.id, memberId: added.data.id, role: "admin" };
  const family = await addCircleMember(store, admin, {
    clinicPatientId: row.id,
    role: "caregiver",
    displayName: "Jane Doe",
  });
  assert.equal(family.ok, true);

  const maActor: Actor = { kind: "staff", clinicId: staff.clinicId, staffId: ma.id, role: "ma" };
  const posted = await addConcern(store, admin, {
    clinicPatientId: row.id,
    body: "Jane Doe lives at 123 Main Street. SSN 123-45-6789. A1C of 8.2.",
    on: AS_OF,
  });
  assert.equal(posted.ok, true);
  const visible = await listConcerns(store, maActor, row.id);
  assert.equal(visible.ok, true);

  const maMember = (await store.listMembers(row.id)).find((member) => member.staff_id === ma.id);
  assert.ok(maMember);
  if (!maMember) return;
  const revoked = await revokeCircleMember(store, patient, { memberId: maMember.id, at: AS_OF });
  assert.equal(revoked.ok, true);
  const hidden = await listConcerns(store, maActor, row.id);
  assert.equal(hidden.ok, false);
  if (!hidden.ok) assert.equal(hidden.status, 403);
  const stillListed = await clinicWorklist(store, maActor, AS_OF);
  assert.equal(stillListed.ok, true);

  const insight = await maskedInsight(store, staff, row.id);
  assert.equal(insight.ok, true);
  if (!insight.ok) return;
  const payload = insight.data.modelRequest;
  for (const needle of ["Jane Doe", "Jane", "Doe", "123 Main Street", "123-45-6789"]) {
    assert.equal(payload.includes(needle), false, needle);
  }
  assert.match(payload, /8\.2/);
  assert.match(payload, /\[SSN\]/);
  assert.match(payload, /\[ADDRESS\]/);
});

test("home readings use clinic thresholds and can change the bp estimate", async () => {
  const { store, staff, patients } = await seed();
  const row = patients.find((item) => item.external_id === "SYN-1003");
  assert.ok(row);
  if (!row) return;
  const patient: Actor = { kind: "patient", patientId: "linked-1003" };
  row.patient_id = "linked-1003";
  const thresholds = await setThreshold(store, staff);
  assert.equal(thresholds.ok, true);
  const high = await addHomeReading(store, patient, {
    clinicPatientId: row.id,
    reading: { kind: "glucose", systolic: null, diastolic: null, glucose: 160, recorded_on: AS_OF },
  });
  assert.equal(high.ok, true);
  if (!high.ok) return;
  assert.equal(high.data.out_of_range, true);
  const controlled = await addHomeReading(store, patient, {
    clinicPatientId: row.id,
    reading: { kind: "bp", systolic: 128, diastolic: 76, glucose: null, recorded_on: AS_OF },
  });
  assert.equal(controlled.ok, true);
  const measures = await clinicMeasures(store, staff, AS_OF);
  assert.equal(measures.ok, true);
  if (!measures.ok) return;
  assert.equal(measures.data.cms165.numerator, 2);
  const missed = await addCheckin(store, patient, {
    clinicPatientId: row.id,
    kind: "medication",
    status: "missed",
    on: AS_OF,
  });
  assert.equal(missed.ok, true);
  const work = await clinicWorklist(store, staff, AS_OF);
  assert.equal(work.ok, true);
  if (!work.ok) return;
  const item = work.data.items.find((rowItem) => rowItem.external_id === "SYN-1003");
  assert.ok(item?.reasons.includes("missed_medication"));
  assert.ok(item?.reasons.includes("home_out_of_range"));
  const logged = await logOutreach(store, staff, { clinicPatientId: row.id, outcome: "contacted", on: AS_OF });
  assert.equal(logged.ok, true);
  if (!logged.ok) return;
  assert.equal(logged.data.outcome, "contacted");
});

async function setThreshold(store: MemoryClinicStore, staff: Actor) {
  const { setClinicThresholds } = await import("../src/lib/clinic/actions");
  return setClinicThresholds(store, staff, { glucose_high: 150 });
}

test("reading days and minutes are labeled as tracking only", async () => {
  const { store, staff, patients } = await seed();
  const row = patients[0];
  await store.addReading({
    clinic_patient_id: row.id,
    kind: "bp",
    systolic: 120,
    diastolic: 70,
    glucose: null,
    recorded_on: "2026-11-01",
  });
  await store.addReading({
    clinic_patient_id: row.id,
    kind: "glucose",
    systolic: null,
    diastolic: null,
    glucose: 110,
    recorded_on: "2026-11-02",
  });
  await store.addReading({
    clinic_patient_id: row.id,
    kind: "bp",
    systolic: 120,
    diastolic: 70,
    glucose: null,
    recorded_on: "2026-10-02",
  });
  const minutes = await logMinutes(store, staff, { clinicPatientId: row.id, month: "2026-11", minutes: 25 });
  assert.equal(minutes.ok, true);
  const summary = await clinicTracking(store, staff, row.id, "2026-11");
  assert.equal(summary.ok, true);
  if (!summary.ok) return;
  assert.equal(summary.data.reading_days, 2);
  assert.equal(summary.data.reading_day_reference, 16);
  assert.equal(summary.data.minutes, 25);
  assert.equal(summary.data.minutes_reference, 20);
  assert.match(summary.data.label, /Tracking only/);
  assert.match(summary.data.label, /Not claims submission/);
});

test("sms hook fails closed when Twilio is not configured and does not throw", async () => {
  const { store, staff, patients } = await seed();
  const quiet = await notifySms(store, staff, { clinicPatientId: patients[0].id, env: {} });
  assert.equal(quiet.ok, true);
  if (!quiet.ok) return;
  assert.equal(quiet.data.delivered, false);
  assert.equal(quiet.data.reason, "sms_not_configured");

  let called = "";
  const sent = await deliverSms(
    { accountSid: "AC-synthetic", authToken: "token-synthetic", from: "+15555550199" },
    "+15555550100",
    async (url) => {
      called = String(url);
      return new Response("{}", { status: 201 });
    },
  );
  assert.equal(sent.delivered, true);
  assert.match(called, /AC-synthetic/);
  const failed = await deliverSms(
    { accountSid: "AC-synthetic", authToken: "token-synthetic", from: "+15555550199" },
    "+15555550100",
    async () => {
      throw new Error("network down");
    },
  );
  assert.equal(failed.delivered, false);
  assert.equal(failed.reason, "sms_failed");
});

test("clinic http requires an actor and masks the model payload", async () => {
  const { store, staff, patients } = await seed();
  const row = patients.find((item) => item.external_id === "SYN-1002");
  assert.ok(row);
  if (!row) return;
  row.patient_id = "patient-synthetic";
  const open = await handleClinicHttp(new Request("http://localhost/api/clinic?view=worklist"), {
    store,
    actor: null,
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(open.status, 401);
  const listed = await handleClinicHttp(new Request("http://localhost/api/clinic?view=worklist"), {
    store,
    actor: staff,
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(listed.status, 200);
  const body = JSON.stringify(await listed.clone().json());
  assert.equal(body.includes("Jane"), false);
  const named = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "add_member",
      clinicPatientId: row.id,
      role: "caregiver",
      displayName: "Jane Doe",
    }),
  }), {
    store,
    actor: { kind: "patient", patientId: "patient-synthetic" },
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(named.status, 200);
  const posted = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "message",
      clinicPatientId: row.id,
      body: "Call Jane Doe at 405-555-0142 about 123 Main Street. A1C of 8.2.",
    }),
  }), {
    store,
    actor: { kind: "patient", patientId: "patient-synthetic" },
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(posted.status, 200);
  const insight = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({ action: "insight", clinicPatientId: row.id }),
  }), {
    store,
    actor: staff,
    smsEnv: {},
    asOf: AS_OF,
  });
  const insightBody = await insight.json();
  const payload = String(insightBody.modelRequest || "");
  assert.equal(payload.includes("Jane"), false);
  assert.equal(payload.includes("405-555-0142"), false);
  assert.equal(payload.includes("123 Main Street"), false);
  assert.match(payload, /8\.2/);
});

test("care team token round trip", () => {
  const actor: Actor = { kind: "staff", clinicId: "clinic-1", staffId: "staff-1", role: "chw" };
  const token = signClinicActor(actor, "synthetic-secret", 2_000);
  assert.ok(token);
  assert.deepEqual(readClinicActor(token || "", "synthetic-secret", 1_000), actor);
  assert.equal(readClinicActor(token || "", "synthetic-secret", 3_000), null);
  assert.equal(readClinicActor(token || "", "other-secret", 1_000), null);
});
