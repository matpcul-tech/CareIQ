import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { addCareTeamStaff, markWellnessOk, recordCancerFollowUp } from "../src/lib/clinic/actions";
import { clinicCsrfFailure } from "../src/lib/clinic/csrf";
import { handleClinicHttp } from "../src/lib/clinic/http";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { handleWellnessInbound, twilioSignature } from "../src/lib/clinic/twilio-inbound";
import type { Actor } from "../src/lib/clinic/logic";

async function clinicWithProvider() {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic");
  const actor: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  return { store, clinic, provider, actor };
}

test("only an active provider can add staff, and no staff token is returned", async () => {
  const { store, clinic, provider, actor } = await clinicWithProvider();
  const patient = await addCareTeamStaff(store, { kind: "patient", patientId: "patient-1" }, {
    clinicId: clinic.id,
    role: "ma",
    displayName: "MA Synthetic",
  });
  assert.equal(patient.ok, false);
  const admin = await addCareTeamStaff(store, {
    kind: "circle",
    clinicPatientId: "row-1",
    memberId: "admin-1",
    role: "admin",
  }, {
    clinicId: clinic.id,
    role: "chw",
    displayName: "CHW Synthetic",
  });
  assert.equal(admin.ok, false);
  const ma = await store.addStaff(clinic.id, "ma", "Existing MA");
  const maActor: Actor = { kind: "staff", clinicId: clinic.id, staffId: ma.id, role: "ma" };
  const deniedMa = await addCareTeamStaff(store, maActor, {
    clinicId: clinic.id,
    role: "chw",
    displayName: "Another CHW",
  });
  assert.equal(deniedMa.ok, false);
  await store.revokeStaff(provider.id, "2026-11-02");
  const revoked = await addCareTeamStaff(store, actor, {
    clinicId: clinic.id,
    role: "ma",
    displayName: "Should Fail",
  });
  assert.equal(revoked.ok, false);
  const active = await store.addStaff(clinic.id, "provider", "Second Provider");
  const added = await addCareTeamStaff(store, {
    kind: "staff",
    clinicId: clinic.id,
    staffId: active.id,
    role: "provider",
  }, {
    clinicId: clinic.id,
    role: "ma",
    displayName: "MA Two",
  });
  assert.equal(added.ok, true);
  if (!added.ok) return;
  assert.equal("staff_token" in added.data, false);
  assert.equal("staff_id" in added.data, false);
  const http = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({ action: "add_staff", clinicId: clinic.id, role: "chw", displayName: "CHW Two" }),
  }), {
    store,
    actor: { kind: "patient", patientId: "patient-1" },
    smsEnv: {},
    asOf: "2026-11-02",
  });
  const body = await http.json();
  assert.equal(http.status, 403);
  assert.equal(body.staff_token, undefined);
});

test("inbound wellness SMS requires a Twilio signature and returns no patient id", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-SMS",
    age: 70,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: "patient-sms",
  }]);
  await store.updatePatient(saved[0].id, {
    wellness_opt_in: true,
    lives_alone: true,
    wellness_phone: "+15555550122",
    wellness_family_notified_at: "2026-11-02T12:00:00Z",
  });
  const url = "https://example.test/api/clinic/wellness/inbound";
  const raw = "Body=OK&From=%2B15555550122";
  const params = { Body: "OK", From: "+15555550122" };
  const token = "twilio-test-token";
  const bad = await handleWellnessInbound({
    url,
    signature: "not-a-signature",
    rawBody: raw,
    authToken: token,
    at: "2026-11-02T13:00:00Z",
  }, store);
  assert.equal(bad.status, 403);
  assert.equal(bad.body.includes("SYN-SMS"), false);
  const untouched = await store.getPatient(saved[0].id);
  assert.equal(untouched?.wellness_family_notified_at, "2026-11-02T12:00:00Z");
  const signature = twilioSignature(token, url, params);
  const independent = createHmac("sha1", token).update(url + "BodyOK" + "From+15555550122", "utf8").digest("base64");
  assert.equal(signature, independent);
  const good = await handleWellnessInbound({
    url,
    signature,
    rawBody: raw,
    authToken: token,
    at: "2026-11-02T13:00:00Z",
  }, store);
  assert.equal(good.status, 204);
  assert.equal(good.body, "");
  const cleared = await store.getPatient(saved[0].id);
  assert.equal(cleared?.wellness_last_ok, "2026-11-02T13:00:00Z");
  assert.equal(cleared?.wellness_family_notified_at, null);
  const missing = await handleWellnessInbound({
    url,
    signature,
    rawBody: raw,
    authToken: "",
    at: "2026-11-02T14:00:00Z",
  }, store);
  assert.equal(missing.status, 503);

  const viewer = await markWellnessOk(store, {
    kind: "circle",
    clinicPatientId: saved[0].id,
    memberId: "viewer-1",
    role: "viewer",
  }, { clinicPatientId: saved[0].id, at: "2026-11-02T15:00:00Z" });
  assert.equal(viewer.ok, false);
  const otherPatient = await markWellnessOk(store, { kind: "patient", patientId: "someone-else" }, {
    clinicPatientId: saved[0].id,
    at: "2026-11-02T15:00:00Z",
  });
  assert.equal(otherPatient.ok, false);
  const self = await markWellnessOk(store, { kind: "patient", patientId: "patient-sms" }, {
    clinicPatientId: saved[0].id,
    at: "2026-11-02T16:00:00Z",
  });
  assert.equal(self.ok, true);
  const posted = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({ action: "wellness_sms", phone: "+15555550122", body: "OK" }),
  }), {
    store,
    actor: { kind: "patient", patientId: "someone-else" },
    smsEnv: {},
    asOf: "2026-11-02",
  });
  assert.equal(posted.status, 400);
  const postedBody = JSON.stringify(await posted.json());
  assert.equal(postedBody.includes("SYN-SMS"), false);
  assert.equal(postedBody.includes("patient-sms"), false);
});

test("cancer follow-up is not written before clinic and circle access succeed", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const other = await store.createClinic("Other Clinic");
  const insider = await store.addStaff(clinic.id, "ma", "MA Synthetic");
  const outsider = await store.addStaff(other.id, "provider", "Other Provider");
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-CA",
    age: 60,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: null,
  }]);
  const event = await store.addSafety({
    clinic_patient_id: saved[0].id,
    kind: "cancer",
    recorded_on: "2026-08-01",
    payload: { kind: "breast", method: "mammogram", result: "abnormal", screened_on: "2026-08-01", follow_up_on: null },
  });
  let writes = 0;
  const original = store.updateSafety.bind(store);
  store.updateSafety = async (id, payload) => {
    writes += 1;
    return original(id, payload);
  };
  const wrongClinic = await recordCancerFollowUp(store, {
    kind: "staff",
    clinicId: other.id,
    staffId: outsider.id,
    role: "provider",
  }, { eventId: event.id, on: "2026-11-02" });
  assert.equal(wrongClinic.ok, false);
  assert.equal(writes, 0);
  const noCircle = await recordCancerFollowUp(store, {
    kind: "staff",
    clinicId: clinic.id,
    staffId: insider.id,
    role: "ma",
  }, { eventId: event.id, on: "2026-11-02" });
  assert.equal(noCircle.ok, false);
  assert.equal(writes, 0);
  await store.addMember({
    clinic_patient_id: saved[0].id,
    role: "ma",
    display_name: "MA Synthetic",
    staff_id: insider.id,
  });
  const allowed = await recordCancerFollowUp(store, {
    kind: "staff",
    clinicId: clinic.id,
    staffId: insider.id,
    role: "ma",
  }, { eventId: event.id, on: "2026-11-02" });
  assert.equal(allowed.ok, true);
  assert.equal(writes, 1);
});

test("clinic POST CSRF helper rejects a missing or mismatched token", () => {
  assert.equal(clinicCsrfFailure("", "abc.sig"), "missing");
  assert.equal(clinicCsrfFailure("abc", ""), "missing");
  assert.equal(clinicCsrfFailure("nope", "abc.sig"), "mismatch");
  assert.equal(clinicCsrfFailure("abc", "abc.sig"), null);
});
