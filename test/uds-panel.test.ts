import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importUdsPanel, mergeAppReadings, parsePeriod, viewUdsPanel } from "../src/lib/clinic/uds/actions";
import {
  gapListCsv,
  guessMapping,
  parseCsvText,
  parsePanelCsv,
  templateCsv,
} from "../src/lib/clinic/uds/csv";
import {
  ageOn,
  calendarYearPeriod,
  evaluateCms122,
  evaluateCms165,
  evaluatePanel,
  MEASURE_LABEL,
  mostRecentBp,
  UNSUPPORTED_EXCLUSIONS,
  type PanelPatient,
} from "../src/lib/clinic/uds/measures";
import { MemoryUdsPanelStore } from "../src/lib/clinic/uds/panel-store";
import { MemoryClinicStore } from "../src/lib/clinic/store";

const P = calendarYearPeriod(2026);

function pt(over: Partial<PanelPatient> = {}): PanelPatient {
  return { patientId: "SYN-1", birthDate: "1970-06-01", sex: "female", hypertension: true, diabetes: true, bp: [], a1c: [], ...over };
}

test("age is computed at the end of the measurement period", () => {
  assert.equal(ageOn("2008-12-31", "2026-12-31"), 18);
  assert.equal(ageOn("2009-01-01", "2026-12-31"), 17);
  assert.equal(ageOn("bad", "2026-12-31"), null);
});

test("CMS165 age boundaries 18 to 85", () => {
  const bp = [{ date: "2026-05-01", systolic: 120, diastolic: 80 }];
  assert.equal(evaluateCms165(pt({ birthDate: "2008-12-31", bp }), P).status, "controlled");
  assert.equal(evaluateCms165(pt({ birthDate: "2009-01-01", bp }), P).status, "not_in_denominator");
  assert.equal(evaluateCms165(pt({ birthDate: "1941-01-01", bp }), P).status, "controlled"); // 85
  assert.equal(evaluateCms165(pt({ birthDate: "1940-12-31", bp }), P).status, "not_in_denominator"); // 86
  assert.equal(evaluateCms165(pt({ hypertension: false, bp }), P).status, "not_in_denominator");
});

test("CMS122 age boundaries 18 to 75", () => {
  const a1c = [{ date: "2026-05-01", value: 7 }];
  assert.equal(evaluateCms122(pt({ birthDate: "1951-01-01", a1c }), P).status, "controlled"); // 75
  assert.equal(evaluateCms122(pt({ birthDate: "1950-12-31", a1c }), P).status, "not_in_denominator"); // 76
  assert.equal(evaluateCms122(pt({ birthDate: "2009-01-01", a1c }), P).status, "not_in_denominator");
});

test("CMS165 numerator is strictly under 140 and under 90", () => {
  const at = (s: number, d: number) => evaluateCms165(pt({ bp: [{ date: "2026-03-01", systolic: s, diastolic: d }] }), P);
  assert.equal(at(139, 89).inNumerator, true);
  assert.equal(at(140, 80).inNumerator, false);
  assert.equal(at(130, 90).inNumerator, false);
});

test("most recent BP wins, and same day uses lowest systolic and lowest diastolic", () => {
  const r = evaluateCms165(pt({ bp: [
    { date: "2026-02-01", systolic: 120, diastolic: 70 },
    { date: "2026-10-01", systolic: 150, diastolic: 85 },
  ] }), P);
  assert.equal(r.status, "not_controlled");
  const same = mostRecentBp([
    { date: "2026-10-01", systolic: 150, diastolic: 82 },
    { date: "2026-10-01", systolic: 136, diastolic: 94 },
  ], P);
  assert.deepEqual([same?.systolic, same?.diastolic], [136, 82]);
});

test("period boundaries: first and last day count, outside days do not", () => {
  const on = (date: string) => evaluateCms165(pt({ bp: [{ date, systolic: 120, diastolic: 70 }] }), P).status;
  assert.equal(on("2026-01-01"), "controlled");
  assert.equal(on("2026-12-31"), "controlled");
  assert.equal(on("2025-12-31"), "missing_reading");
  assert.equal(on("2027-01-01"), "missing_reading");
});

test("missing BP is not controlled; missing A1C counts in the CMS122 numerator", () => {
  const b = evaluateCms165(pt(), P);
  assert.equal(b.status, "missing_reading");
  assert.equal(b.inNumerator, false);
  assert.equal(b.needsOutreach, true);
  const a = evaluateCms122(pt(), P);
  assert.equal(a.status, "missing_reading");
  assert.equal(a.inNumerator, true);
});

test("CMS122 is over 9 percent, most recent wins", () => {
  const at = (value: number) => evaluateCms122(pt({ a1c: [{ date: "2026-04-01", value }] }), P);
  assert.equal(at(9).inNumerator, false);
  assert.equal(at(9.1).inNumerator, true);
  const recent = evaluateCms122(pt({ a1c: [{ date: "2026-01-01", value: 11 }, { date: "2026-09-01", value: 7.5 }] }), P);
  assert.equal(recent.status, "controlled");
});

test("exclusions: hospice, palliative, frailty rules by age, LTC, ESRD, dialysis, transplant, pregnancy", () => {
  assert.equal(evaluateCms165(pt({ hospice: true }), P).exclusion, "hospice");
  assert.equal(evaluateCms122(pt({ palliativeCare: true }), P).exclusion, "palliative care");
  // 66 to 80 needs frailty AND advanced illness.
  const age70 = "1956-01-01";
  assert.equal(evaluateCms165(pt({ birthDate: age70, frailty: true }), P).status, "missing_reading");
  assert.equal(evaluateCms165(pt({ birthDate: age70, frailty: true, advancedIllness: true }), P).status, "excluded");
  // Under 66 frailty and advanced illness do not exclude.
  assert.equal(evaluateCms122(pt({ birthDate: "1961-01-01", frailty: true, advancedIllness: true }), P).status, "missing_reading");
  assert.equal(evaluateCms165(pt({ birthDate: "1961-01-01", longTermCare: true }), P).status, "missing_reading");
  assert.equal(evaluateCms165(pt({ birthDate: "1960-01-01", longTermCare: true }), P).status, "excluded");
  // 81 and over: frailty alone.
  assert.equal(evaluateCms165(pt({ birthDate: "1945-01-01", frailty: true }), P).status, "excluded");
  for (const flag of ["esrd", "dialysis", "kidneyTransplant", "pregnancy"] as const) {
    assert.equal(evaluateCms165(pt({ [flag]: true }), P).status, "excluded", flag);
    assert.equal(evaluateCms122(pt({ [flag]: true }), P).status, "missing_reading", flag);
  }
});

test("visit and hypertension onset requirements", () => {
  assert.equal(evaluateCms165(pt({ visitDates: ["2025-05-01"] }), P).status, "not_in_denominator");
  assert.equal(evaluateCms165(pt({ visitDates: ["2026-05-01"] }), P).status, "missing_reading");
  assert.equal(evaluateCms165(pt({ hypertensionOnset: "2026-06-30" }), P).status, "missing_reading");
  assert.equal(evaluateCms165(pt({ hypertensionOnset: "2026-07-01" }), P).status, "not_in_denominator");
});

test("rates exclude exclusions from the denominator", () => {
  const s = evaluatePanel([
    pt({ patientId: "A", bp: [{ date: "2026-02-01", systolic: 120, diastolic: 70 }], a1c: [{ date: "2026-02-01", value: 10 }] }),
    pt({ patientId: "B" }),
    pt({ patientId: "C", hospice: true }),
  ], P);
  const [c165, c122] = s.rates;
  assert.deepEqual([c165.numerator, c165.denominator, c165.exclusions, c165.percent], [1, 2, 1, 50]);
  assert.deepEqual([c122.numerator, c122.denominator, c122.percent, c122.inverse], [2, 2, 100, true]);
  assert.equal(s.label, MEASURE_LABEL);
  assert.equal(evaluatePanel([], P).rates[0].percent, null);
});

test("CSV parser handles quotes, CRLF, BOM, and blank lines", () => {
  const t = parseCsvText('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2');
  assert.deepEqual(t, [["a", "b"], ["x, y", 'he said "hi"'], ["1", "2"]]);
});

test("template parses with zero errors and guesses every column", () => {
  const r = parsePanelCsv(templateCsv());
  assert.deepEqual(r.errors, []);
  assert.equal(r.patients.length, 1);
  assert.equal(r.patients[0].hypertension, true);
  assert.equal(r.patients[0].diabetes, true);
  assert.equal(r.patients[0].bp.length, 2);
});

test("column mapping: aliases and explicit mapping", () => {
  const csv = "MRN,DOB,HTN\nX1,1960-01-01,yes\n";
  const m = guessMapping(parseCsvText(csv)[0]);
  assert.deepEqual(m, { patient_id: 0, birth_date: 1, hypertension: 2 });
  const r = parsePanelCsv("col1,col2,col3\nX1,1960-01-01,I10\n", { patient_id: 0, birth_date: 1, diagnosis_codes: 2 });
  assert.equal(r.patients[0].hypertension, true);
  assert.ok(parsePanelCsv("a,b\n1,2\n").mappingErrors.length > 0);
});

test("per row validation errors", () => {
  const csv = [
    "patient_id,birth_date,hypertension,bp_readings,a1c_results",
    "OK1,1960-01-01,yes,2026-01-01 130/80,",
    ",1960-01-01,yes,,",
    "BAD2,1960-02-30,yes,,",
    "BAD3,1960-01-01,maybe,2026-01-01 130-80,2026-01-01 abc",
    "OK1,1961-01-01,yes,,",
  ].join("\n");
  const r = parsePanelCsv(csv);
  assert.equal(r.patients.length, 1);
  assert.deepEqual(r.errors.map((e) => e.row), [2, 3, 4, 5]);
  assert.match(r.errors[0].messages[0], /Patient ID is required/);
  assert.match(r.errors[1].messages[0], /Birth date/);
  assert.equal(r.errors[2].messages.length, 3);
  assert.match(r.errors[3].messages[0], /Duplicate/);
});

test("gap list export lists outreach rows and blocks formula injection", () => {
  const s = evaluatePanel([pt({ patientId: "=CMD()" }), pt({ patientId: "OK", diabetes: false, bp: [{ date: "2026-02-01", systolic: 120, diastolic: 70 }] })], P);
  const out = gapListCsv(s.rows).trim().split("\n");
  assert.equal(out.length, 2);
  assert.ok(out[1].startsWith("'=CMD()"));
});

test("sample fixture has about 50 synthetic patients and parses cleanly", () => {
  const r = parsePanelCsv(readFileSync("fixtures/uds-panel-sample.csv", "utf8"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.patients.length, 50);
  assert.ok(r.patients.every((p) => p.patientId.startsWith("SYN-")));
});

test("panel is staff only and import is clinic admin only", async () => {
  const store = new MemoryClinicStore();
  const panel = new MemoryUdsPanelStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const admin = await store.addStaff(clinic.id, "provider", "Admin", null, { is_admin: true });
  const staff = await store.addStaff(clinic.id, "provider", "Staff");
  const adminActor = { kind: "staff" as const, clinicId: clinic.id, staffId: admin.id, role: admin.role };
  const staffActor = { kind: "staff" as const, clinicId: clinic.id, staffId: staff.id, role: staff.role };
  const patient = { kind: "patient" as const, patientId: "p1" };
  const rows = parsePanelCsv(templateCsv()).patients;
  assert.equal((await importUdsPanel(store, panel, staffActor, rows)).ok, false);
  assert.equal((await importUdsPanel(store, panel, patient, rows)).ok, false);
  assert.equal((await importUdsPanel(store, panel, { ...adminActor, revoked: true }, rows)).ok, false);
  assert.equal((await importUdsPanel(store, panel, adminActor, [{ patientId: "x", birthDate: "nope" }])).ok, false);
  const ok = await importUdsPanel(store, panel, adminActor, rows);
  assert.ok(ok.ok);
  const view = await viewUdsPanel(store, panel, staffActor, P);
  assert.ok(view.ok && view.data.rows.length === 1);
  assert.equal((await viewUdsPanel(store, panel, patient, P)).ok, false);
  const other = await store.createClinic("Other");
  const otherStaff = await store.addStaff(other.id, "provider", "O");
  const otherView = await viewUdsPanel(store, panel, { kind: "staff", clinicId: other.id, staffId: otherStaff.id, role: "provider" }, P);
  assert.ok(otherView.ok && otherView.data.rows.length === 0);
  assert.ok(view.ok && view.data.unsupported_exclusions.length === UNSUPPORTED_EXCLUSIONS.length);
});

test("readings from linked CareIQ app users merge in and most recent wins", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const [row] = await store.upsertPatients(clinic.id, [{
    external_id: "SYN-1", age: 56, has_diabetes: true, has_hypertension: true,
    last_a1c: 7.1, last_a1c_date: "2026-10-15", bp_systolic: null, bp_diastolic: null,
    last_bp_date: null, next_visit_date: null, patient_id: "app-user-1",
  } as never]);
  await store.addReading({ clinic_patient_id: row.id, kind: "bp", systolic: 128, diastolic: 78, glucose: null, recorded_on: "2026-11-01" });
  const merged = await mergeAppReadings(store, clinic.id, [pt({ bp: [{ date: "2026-03-01", systolic: 160, diastolic: 95 }], a1c: [{ date: "2026-02-01", value: 10.2 }] })]);
  assert.equal(merged[0].source, "csv+app");
  const s = evaluatePanel(merged, P);
  assert.equal(s.rows[0].cms165.status, "controlled");
  assert.equal(s.rows[0].cms122.status, "controlled");
});

test("period parsing defaults to the calendar year", () => {
  assert.deepEqual(parsePeriod(null, null, "2026-11-02"), { start: "2026-01-01", end: "2026-12-31" });
  assert.equal(parsePeriod("2026-05-01", "2026-01-01", "2026-11-02"), null);
  assert.deepEqual(parsePeriod("2026-01-01", "2026-06-30", "2026-11-02"), { start: "2026-01-01", end: "2026-06-30" });
});

test("UDS panel files carry the label and no race or Native status fields", () => {
  for (const f of ["src/lib/clinic/uds/measures.ts", "src/lib/clinic/uds/csv.ts", "src/app/clinic/uds/UdsPanel.tsx", "fixtures/uds-panel-sample.csv", "supabase/migrations/0013_clinic_uds_panel.sql"]) {
    const src = readFileSync(f, "utf8");
    assert.equal(/race|ethnic|native|tribal|american indian|alaska/i.test(src), false, f);
    assert.equal(/[\u2013\u2014]/.test(src), false, f);
  }
  assert.match(readFileSync("src/app/clinic/uds/page.tsx", "utf8"), /not certified eCQM software/);
});
