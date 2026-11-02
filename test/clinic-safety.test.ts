import assert from "node:assert/strict";
import test from "node:test";
import {
  optInWellness,
  recordCancerFollowUp,
  recordCancerResult,
  recordStrain,
  tickWellness,
  wellnessSmsReply,
} from "../src/lib/clinic/actions";
import { buildScorecard, type ScorecardPatient } from "../src/lib/clinic/scorecard";
import { wellnessDecision } from "../src/lib/clinic/safety";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import type { Actor } from "../src/lib/clinic/logic";

const AS_OF = "2026-11-02";

function row(partial: Partial<ScorecardPatient> & Pick<ScorecardPatient, "external_id">): ScorecardPatient {
  return {
    age: 60,
    has_diabetes: false,
    has_hypertension: false,
    a1c: null,
    a1c_date: null,
    systolic: null,
    diastolic: null,
    bp_date: null,
    screens: [],
    reading_dates: [],
    minutes: 0,
    ...partial,
  };
}

function tags(result: ReturnType<typeof buildScorecard>, id: string): string[] {
  return result.worklist.find((item) => item.external_id === id)?.measures || [];
}

test("cancer screening gaps stay open until follow-up and carry barrier flags", () => {
  const open = buildScorecard([
    row({
      external_id: "C1",
      age: 60,
      sex: "female",
      cost_barrier: true,
      transport_barrier: true,
      cancer: [
        { kind: "colorectal", method: "colonoscopy", result: "normal", screened_on: "2018-01-01", follow_up_on: null },
        { kind: "cervical", method: "pap", result: "normal", screened_on: "2024-11-02", follow_up_on: null },
        { kind: "colorectal", method: "fit", result: "abnormal", screened_on: "2026-09-01", follow_up_on: null },
      ],
    }),
  ], {}, AS_OF, "2026-11");
  const cms130 = open.measures.find((measure) => measure.id === "cms130");
  const cms125 = open.measures.find((measure) => measure.id === "cms125");
  const cms124 = open.measures.find((measure) => measure.id === "cms124");
  assert.equal(cms130?.numerator, 1);
  assert.deepEqual(cms125?.patients, ["C1"]);
  assert.equal(cms124?.numerator, 1);
  assert.match(String(cms125?.note), /No default percent/);
  const reasons = tags(open, "C1");
  assert.ok(reasons.includes("cancer_followup_overdue"));
  assert.ok(reasons.includes("cost_barrier"));
  assert.ok(reasons.includes("transport_barrier"));

  const closed = buildScorecard([
    row({
      external_id: "C1",
      age: 60,
      sex: "female",
      cancer: [
        { kind: "colorectal", method: "fit", result: "abnormal", screened_on: "2026-09-01", follow_up_on: "2026-10-01" },
        { kind: "breast", method: "mammogram", result: "normal", screened_on: "2026-06-01", follow_up_on: null },
      ],
    }),
  ], {}, AS_OF, "2026-11");
  assert.equal(tags(closed, "C1").includes("cancer_followup_overdue"), false);
  assert.equal(closed.measures.find((measure) => measure.id === "cms125")?.numerator, 1);
  const male = buildScorecard([
    row({ external_id: "M1", age: 60, sex: "male" }),
  ], {}, AS_OF, "2026-11");
  assert.equal(male.measures.find((measure) => measure.id === "cms125")?.denominator, 0);
  const age51 = buildScorecard([
    row({ external_id: "Y1", age: 51, sex: "female" }),
  ], {}, AS_OF, "2026-11");
  assert.equal(age51.measures.find((measure) => measure.id === "cms125")?.denominator, 0);
  const age52 = buildScorecard([
    row({ external_id: "Y2", age: 52, sex: "female" }),
  ], {}, AS_OF, "2026-11");
  assert.equal(age52.measures.find((measure) => measure.id === "cms125")?.denominator, 1);
});

test("missed wellness check-in escalates to family before the care team", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic", "+15555550111");
  const staff: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-ALONE",
    age: 78,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: "patient-alone",
  }]);
  await store.addMember({
    clinic_patient_id: saved[0].id,
    role: "provider",
    display_name: "Provider Synthetic",
    staff_id: provider.id,
  });
  const opted = await optInWellness(store, { kind: "patient", patientId: "patient-alone" }, {
    clinicPatientId: saved[0].id,
    optedIn: true,
    livesAlone: true,
    phone: "+15555550122",
    familyPhone: "+15555550133",
  });
  assert.equal(opted.ok, true);
  const env = { accountSid: "ACexample", authToken: "token-example", from: "+15555550100" };
  const fetchImpl = async () => new Response("{}", { status: 201 });
  const first = await tickWellness(store, staff, { nowIso: "2026-11-02T12:00:00Z", env, fetchImpl });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.data.escalations.length, 1);
  assert.equal(first.data.escalations[0].step, "family");
  assert.equal(first.data.escalations[0].sms, "sent");
  const marked = await store.getPatient(saved[0].id);
  assert.equal(marked?.wellness_family_notified_at, "2026-11-02T12:00:00Z");
  assert.equal(marked?.wellness_family_delivery, "sent");
  assert.equal(marked?.wellness_team_notified_at, null);
  const waiting = await tickWellness(store, staff, { nowIso: "2026-11-03T13:00:00Z", env, fetchImpl });
  assert.equal(waiting.ok, true);
  if (!waiting.ok) return;
  assert.equal(waiting.data.escalations.length, 0);
  const second = await tickWellness(store, staff, { nowIso: "2026-11-03T15:00:00Z", env, fetchImpl });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.data.escalations[0].step, "care_team");
  const reply = await wellnessSmsReply(store, { phone: "+15555550122", body: "OK", at: "2026-11-03T16:00:00Z" });
  assert.equal(reply.data.matched, true);
  assert.equal("external_id" in reply.data, false);
  const quiet = await tickWellness(store, staff, { nowIso: "2026-11-03T18:00:00Z", env: {} });
  assert.equal(quiet.ok, true);
  if (!quiet.ok) return;
  assert.equal(quiet.data.escalations.length, 0);
});

async function missedAlone(familyPhone: string | null) {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic", "+15555550111");
  const staff: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-MISS",
    age: 78,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: "patient-miss",
  }]);
  await optInWellness(store, { kind: "patient", patientId: "patient-miss" }, {
    clinicPatientId: saved[0].id,
    optedIn: true,
    livesAlone: true,
    phone: "+15555550122",
    familyPhone,
  });
  return { store, staff, id: saved[0].id };
}

test("no family phone records the attempt and alerts the care team", async () => {
  const { store, staff, id } = await missedAlone(null);
  const env = { accountSid: "ACexample", authToken: "token-example", from: "+15555550100" };
  const tick = await tickWellness(store, staff, {
    nowIso: "2026-11-02T12:00:00Z",
    env,
    fetchImpl: async () => new Response("{}", { status: 201 }),
  });
  assert.equal(tick.ok, true);
  if (!tick.ok) return;
  assert.equal(tick.data.escalations[0].step, "family");
  assert.equal(tick.data.escalations[0].sms, "no_destination");
  assert.equal(tick.data.escalations[1].step, "care_team");
  assert.equal(tick.data.escalations[1].sms, "sent");
  const row = await store.getPatient(id);
  assert.equal(row?.wellness_family_notified_at, "2026-11-02T12:00:00Z");
  assert.equal(row?.wellness_family_delivery, "no_destination");
  assert.equal(row?.wellness_team_notified_at, "2026-11-02T12:00:00Z");
  const again = await tickWellness(store, staff, { nowIso: "2026-11-02T13:00:00Z", env, fetchImpl: async () => new Response("{}", { status: 201 }) });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.data.escalations.length, 0);
});

test("sms_not_configured still records the family attempt and alerts the care team", async () => {
  const { store, staff, id } = await missedAlone("+15555550133");
  const tick = await tickWellness(store, staff, { nowIso: "2026-11-02T12:00:00Z", env: {} });
  assert.equal(tick.ok, true);
  if (!tick.ok) return;
  assert.equal(tick.data.escalations[0].sms, "sms_not_configured");
  assert.equal(tick.data.escalations[1].step, "care_team");
  const row = await store.getPatient(id);
  assert.equal(row?.wellness_family_delivery, "sms_not_configured");
  assert.ok(row?.wellness_team_notified_at);
  const again = await tickWellness(store, staff, { nowIso: "2026-11-02T18:00:00Z", env: {} });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.data.escalations.some((item) => item.step === "family"), false);
});

test("a Twilio error records the family attempt and alerts the care team", async () => {
  const { store, staff, id } = await missedAlone("+15555550133");
  const env = { accountSid: "ACexample", authToken: "token-example", from: "+15555550100" };
  const failing = async () => new Response("nope", { status: 500 });
  const tick = await tickWellness(store, staff, { nowIso: "2026-11-02T12:00:00Z", env, fetchImpl: failing });
  assert.equal(tick.ok, true);
  if (!tick.ok) return;
  assert.equal(tick.data.escalations[0].step, "family");
  assert.equal(tick.data.escalations[0].sms, "sms_failed");
  const row = await store.getPatient(id);
  assert.equal(row?.wellness_family_delivery, "sms_failed");
  assert.equal(row?.wellness_team_notified_at, "2026-11-02T12:00:00Z");
  assert.equal(tick.data.escalations.some((item) => item.step === "care_team"), true);
  const again = await tickWellness(store, staff, { nowIso: "2026-11-02T12:05:00Z", env, fetchImpl: failing });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.data.escalations.length, 0);
  const nextTick = wellnessDecision({
    opted_in: true,
    lives_alone: true,
    last_ok_at: null,
    family_notified_at: "2026-11-02T12:00:00Z",
    family_delivery: "sms_failed",
    team_notified_at: null,
  }, "2026-11-02T12:05:00Z", 26);
  assert.equal(nextTick, "escalate_care_team");
});

test("cognitive concern links to CMS139 and high strain opens a task", async () => {
  const concern = buildScorecard([
    row({
      external_id: "G1",
      age: 72,
      cognitive: [{ score: 1, recorded_on: "2026-10-01" }],
    }),
  ], {}, AS_OF, "2026-11");
  assert.deepEqual(concern.measures.find((measure) => measure.id === "cms139")?.patients, ["G1"]);
  assert.ok(tags(concern, "G1").includes("falls_risk_cms139"));
  assert.equal(tags(concern, "G1").includes("cognitive_due"), false);

  const due = buildScorecard([
    row({ external_id: "G2", age: 80 }),
  ], {}, AS_OF, "2026-11");
  assert.ok(tags(due, "G2").includes("cognitive_due"));
  assert.ok(tags(due, "G2").includes("cms139"));

  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-CARE",
    age: 81,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: "patient-care",
  }]);
  const denied = await recordStrain(store, { kind: "circle", clinicPatientId: saved[0].id, memberId: "v", role: "viewer" }, {
    clinicPatientId: saved[0].id,
    score: 9,
    on: AS_OF,
  });
  assert.equal(denied.ok, false);
  const opened = await recordStrain(store, { kind: "circle", clinicPatientId: saved[0].id, memberId: "c", role: "caregiver" }, {
    clinicPatientId: saved[0].id,
    score: 8,
    on: AS_OF,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(opened.data.task_open, true);
  const followed = await recordCancerResult(store, { kind: "patient", patientId: "patient-care" }, {
    clinicPatientId: saved[0].id,
    kind: "breast",
    method: "mammogram",
    result: "abnormal",
    on: "2026-08-01",
  });
  assert.equal(followed.ok, true);
  if (!followed.ok) return;
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic");
  await store.addMember({
    clinic_patient_id: saved[0].id,
    role: "provider",
    display_name: "Provider Synthetic",
    staff_id: provider.id,
  });
  const staff: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const done = await recordCancerFollowUp(store, staff, { eventId: followed.data.id, on: AS_OF });
  assert.equal(done.ok, true);
});
