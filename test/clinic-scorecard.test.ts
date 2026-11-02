import assert from "node:assert/strict";
import test from "node:test";
import { addScreen, clinicScorecard, setMeasureTargets } from "../src/lib/clinic/actions";
import { handleClinicHttp } from "../src/lib/clinic/http";
import { buildScorecard, estimateCareManagement, type ScorecardPatient } from "../src/lib/clinic/scorecard";
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

function card(result: ReturnType<typeof buildScorecard>, id: string) {
  const found = result.measures.find((measure) => measure.id === id);
  if (!found) throw new Error(id);
  return found;
}

test("scorecard rates, targets, gap patients, and example dollars", () => {
  const rows: ScorecardPatient[] = [
    row({
      external_id: "P1",
      has_diabetes: true,
      has_hypertension: true,
      a1c: 10.1,
      a1c_date: "2026-08-01",
      systolic: 150,
      diastolic: 92,
      bp_date: "2026-08-01",
    }),
    row({
      external_id: "P2",
      has_diabetes: true,
      has_hypertension: true,
      a1c: 7.2,
      a1c_date: "2026-09-01",
      systolic: 128,
      diastolic: 78,
      bp_date: "2026-09-01",
      screens: [{ instrument: "phq2", score: 1, follow_up: false, recorded_on: "2026-10-01" }],
    }),
    row({
      external_id: "P3",
      age: 40,
      screens: [{ instrument: "phq9", score: 14, follow_up: true, recorded_on: "2025-11-02" }],
    }),
    row({
      external_id: "P4",
      age: 70,
      has_diabetes: true,
      a1c: 8.4,
      a1c_date: "2026-10-01",
    }),
  ];
  const result = buildScorecard(rows, {}, AS_OF, "2026-11");
  const cms165 = card(result, "cms165");
  assert.equal(cms165.rate, 0.5);
  assert.equal(cms165.target, 0.6908);
  assert.equal(cms165.target_source, "example");
  assert.equal(cms165.gap, 0.191);
  assert.equal(cms165.needed, 1);
  assert.deepEqual(cms165.patients, ["P1"]);
  const cbp = card(result, "hedis_cbp");
  assert.equal(cbp.target, 0.6387);
  assert.equal(cbp.needed, 1);
  const cms122 = card(result, "cms122");
  assert.equal(cms122.numerator, 1);
  assert.equal(cms122.denominator, 3);
  assert.equal(cms122.target, 0.2628);
  assert.equal(cms122.direction, "lower");
  assert.deepEqual(cms122.patients, ["P1"]);
  const gsd = card(result, "hedis_gsd");
  assert.equal(gsd.target, 0.5669);
  assert.equal(gsd.numerator, 1);
  assert.deepEqual(gsd.patients, ["P1", "P4"]);
  const cms2 = card(result, "cms2");
  assert.equal(cms2.target, null);
  assert.equal(cms2.target_source, "none");
  assert.equal(cms2.numerator, 2);
  assert.deepEqual(cms2.patients, ["P1", "P4"]);
  assert.match(cms2.note, /No default percent/);
  const cms159 = card(result, "cms159");
  assert.equal(cms159.denominator, 1);
  assert.equal(cms159.numerator, 0);
  assert.deepEqual(cms159.patients, ["P3"]);
  assert.match(cms159.note, /12 month PHQ-9/);
  const gpraA1c = card(result, "gpra_a1c");
  assert.equal(gpraA1c.target, 0.121);
  assert.match(gpraA1c.note, /Tribal site/);
  const gpraBp = card(result, "gpra_bp");
  assert.equal(gpraBp.target, 0.575);
  assert.equal(gpraBp.numerator, 1);
  assert.equal(gpraBp.denominator, 3);
  const gpraDep = card(result, "gpra_depression");
  assert.equal(gpraDep.target, 0.396);
  assert.equal(gpraDep.gap, 0);
  assert.deepEqual(gpraDep.patients, []);
  assert.equal(result.p4p.hedis_cbp.p40, 40);
  assert.equal(result.p4p.hedis_gsd.p80, 80);
  assert.equal(result.p4p.combined.p100, 200);
  assert.match(result.p4p.label, /Estimate only/);
  assert.match(result.label, /Not a validated/);

  const raised = buildScorecard(rows, { cms165: 0.4 }, AS_OF, "2026-11");
  const moved = card(raised, "cms165");
  assert.equal(moved.target_source, "clinic");
  assert.equal(moved.needed, 0);
  assert.deepEqual(moved.patients, []);
});

test("a repeat PHQ-9 under 5 closes the remission gap", () => {
  const rows: ScorecardPatient[] = [
    row({
      external_id: "R1",
      screens: [
        { instrument: "phq9", score: 16, follow_up: true, recorded_on: "2025-11-02" },
        { instrument: "phq9", score: 4, follow_up: false, recorded_on: "2026-11-02" },
      ],
    }),
  ];
  const result = buildScorecard(rows, {}, AS_OF, "2026-11");
  const cms159 = card(result, "cms159");
  assert.equal(cms159.numerator, 1);
  assert.equal(cms159.denominator, 1);
  assert.deepEqual(cms159.patients, []);
});

test("a positive PHQ-2 without follow-up stays a CMS2 gap", () => {
  const rows: ScorecardPatient[] = [
    row({
      external_id: "D1",
      screens: [{ instrument: "phq2", score: 4, follow_up: false, recorded_on: "2026-10-01" }],
    }),
  ];
  const open = card(buildScorecard(rows, {}, AS_OF, "2026-11"), "cms2");
  assert.deepEqual(open.patients, ["D1"]);
  rows[0].screens[0].follow_up = true;
  const closed = card(buildScorecard(rows, {}, AS_OF, "2026-11"), "cms2");
  assert.deepEqual(closed.patients, []);
  assert.equal(closed.numerator, 1);
});

test("RPM dollar estimates follow the scorecard amounts and do not price CCM", () => {
  const days = Array.from({ length: 16 }, (_, index) => `2026-11-${String(index + 1).padStart(2, "0")}`);
  const full = estimateCareManagement([
    row({ external_id: "M1", reading_dates: days, minutes: 45 }),
  ], "2026-11");
  const byCode = Object.fromEntries(full.rpm.map((line) => [line.code, line.dollars]));
  assert.equal(byCode["99453"], 22);
  assert.equal(byCode["99454"], 47);
  assert.equal(byCode["99457"], 52);
  assert.equal(byCode["99458"], 41);
  assert.equal(byCode["99470"], 0);
  assert.equal(full.rpm_dollars, 162);
  assert.equal(full.ccm_apcm.patients_at_20, 1);
  assert.match(full.ccm_apcm.label, /none is estimated/i);
  const short = estimateCareManagement([
    row({ external_id: "M2", reading_dates: ["2026-11-03", "2026-11-04"], minutes: 15 }),
  ], "2026-11");
  const shortCodes = Object.fromEntries(short.rpm.map((line) => [line.code, line.dollars]));
  assert.equal(shortCodes["99470"], 26);
  assert.equal(shortCodes["99457"], 0);
  assert.equal(short.rpm_dollars, 48);
  assert.match(full.label, /Not claims submission/);
  assert.match(full.label, /99470 is unconfirmed/);
  assert.match(String(full.rpm.find((line) => line.code === "99470")?.rule), /unconfirmed/);
});

test("circle PHQ check-in feeds the clinic scorecard", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const provider = await store.addStaff(clinic.id, "provider", "Provider Synthetic");
  const staff: Actor = { kind: "staff", clinicId: clinic.id, staffId: provider.id, role: "provider" };
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-PHQ",
    age: 52,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: "patient-phq",
  }]);
  await store.addMember({
    clinic_patient_id: saved[0].id,
    role: "provider",
    display_name: "Provider Synthetic",
    staff_id: provider.id,
  });
  const posted = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "screen",
      clinicPatientId: saved[0].id,
      instrument: "phq9",
      score: 12,
      follow_up: false,
      on: AS_OF,
    }),
  }), {
    store,
    actor: { kind: "patient", patientId: "patient-phq" },
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(posted.status, 200);
  const view = await handleClinicHttp(new Request("http://localhost/api/clinic?view=scorecard"), {
    store,
    actor: staff,
    smsEnv: {},
    asOf: AS_OF,
  });
  assert.equal(view.status, 200);
  const body = await view.json();
  const cms2 = body.measures.find((measure: { id: string }) => measure.id === "cms2");
  assert.equal(cms2.numerator, 0);
  assert.deepEqual(cms2.patients, ["SYN-PHQ"]);
  const updated = await setMeasureTargets(store, staff, { cms2: 0.5 }, AS_OF);
  assert.equal(updated.ok, true);
  if (!updated.ok) return;
  const next = updated.data.measures.find((measure) => measure.id === "cms2");
  assert.equal(next?.target, 0.5);
  assert.equal(next?.target_source, "clinic");
  const direct = await addScreen(store, { kind: "circle", clinicPatientId: saved[0].id, memberId: "x", role: "viewer" }, {
    clinicPatientId: saved[0].id,
    instrument: "phq2",
    score: 1,
    followUp: false,
    on: AS_OF,
  });
  assert.equal(direct.ok, false);
  const loaded = await clinicScorecard(store, staff, AS_OF);
  assert.equal(loaded.ok, true);
});
