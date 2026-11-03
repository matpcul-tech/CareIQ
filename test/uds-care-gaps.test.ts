import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ALL_MEASURES,
  CARE_GAP_UNSUPPORTED,
  evaluateCareGapPanel,
  evaluateCms124,
  evaluateCms125,
  evaluateCms130,
  evaluateCms138,
  evaluateCms2,
  evaluateCms347,
  phqPositive,
} from "../src/lib/clinic/uds/care-gaps";
import { gapListCsv, parsePanelCsv, templateCsv } from "../src/lib/clinic/uds/csv";
import { calendarYearPeriod, MEASURE_LABEL, type PanelPatient } from "../src/lib/clinic/uds/measures";
import { importUdsPanel, viewUdsPanel } from "../src/lib/clinic/uds/actions";
import { MemoryUdsPanelStore } from "../src/lib/clinic/uds/panel-store";
import { MemoryClinicStore } from "../src/lib/clinic/store";

const P = calendarYearPeriod(2026);
const pt = (over: Partial<PanelPatient> = {}): PanelPatient => ({
  patientId: "SYN-1", birthDate: "1970-06-01", sex: "female", hypertension: false, diabetes: false, bp: [], a1c: [], ...over,
});

test("CMS125 ages 42 to 74 at period end, women only", () => {
  const m = ["2026-03-01"];
  assert.equal(evaluateCms125(pt({ birthDate: "1984-12-31", mammograms: m }), P).status, "met"); // 42
  assert.equal(evaluateCms125(pt({ birthDate: "1985-01-01", mammograms: m }), P).status, "not_in_denominator"); // 41
  assert.equal(evaluateCms125(pt({ birthDate: "1952-01-01", mammograms: m }), P).status, "met"); // 74
  assert.equal(evaluateCms125(pt({ birthDate: "1951-12-31", mammograms: m }), P).status, "not_in_denominator"); // 75
  assert.equal(evaluateCms125(pt({ sex: "male", mammograms: m }), P).status, "not_in_denominator");
  // Sex at birth wins over sex.
  assert.equal(evaluateCms125(pt({ sex: "other", sexAtBirth: "female", mammograms: m }), P).status, "met");
  assert.equal(evaluateCms125(pt({ sex: "female", sexAtBirth: "male", mammograms: m }), P).status, "not_in_denominator");
});

test("CMS125 window starts October 1 two years before the period", () => {
  assert.equal(evaluateCms125(pt({ mammograms: ["2024-10-01"] }), P).status, "met");
  assert.equal(evaluateCms125(pt({ mammograms: ["2024-09-30"] }), P).status, "due");
  assert.equal(evaluateCms125(pt({ mammograms: ["2027-01-01"] }), P).status, "due");
  assert.equal(evaluateCms125(pt({ bilateralMastectomy: true }), P).status, "excluded");
  assert.equal(evaluateCms125(pt({ birthDate: "1956-01-01", frailty: true, advancedIllness: true }), P).status, "excluded");
});

test("CMS130 ages 46 to 75 and lookback by test type", () => {
  assert.equal(evaluateCms130(pt({ birthDate: "1980-12-31" }), P).status, "due"); // 46
  assert.equal(evaluateCms130(pt({ birthDate: "1981-01-01" }), P).status, "not_in_denominator"); // 45
  assert.equal(evaluateCms130(pt({ birthDate: "1950-12-31" }), P).status, "not_in_denominator"); // 76
  const s = (date: string, type: "colonoscopy" | "fit" | "fit_dna" | "ct_colonography" | "flex_sig") =>
    evaluateCms130(pt({ colorectalScreens: [{ date, type }] }), P).status;
  assert.equal(s("2017-01-01", "colonoscopy"), "met");
  assert.equal(s("2016-12-31", "colonoscopy"), "due");
  assert.equal(s("2026-01-01", "fit"), "met");
  assert.equal(s("2025-12-31", "fit"), "due");
  assert.equal(s("2024-01-01", "fit_dna"), "met");
  assert.equal(s("2023-12-31", "fit_dna"), "due");
  assert.equal(s("2022-01-01", "ct_colonography"), "met");
  assert.equal(s("2021-12-31", "flex_sig"), "due");
  assert.equal(evaluateCms130(pt({ colorectalCancer: true }), P).status, "excluded");
  assert.equal(evaluateCms130(pt({ totalColectomy: true }), P).status, "excluded");
  assert.equal(evaluateCms130(pt({ sex: "male" }), P).status, "due");
});

test("CMS124 ages 24 to 64, cytology 3 years, HPV 5 years at age 30 plus", () => {
  assert.equal(evaluateCms124(pt({ birthDate: "2002-12-31" }), P).status, "due"); // 24
  assert.equal(evaluateCms124(pt({ birthDate: "2003-01-01" }), P).status, "not_in_denominator");
  assert.equal(evaluateCms124(pt({ birthDate: "1961-12-31" }), P).status, "not_in_denominator"); // 65
  assert.equal(evaluateCms124(pt({ sex: "male" }), P).status, "not_in_denominator");
  const c = (over: Partial<PanelPatient>) => evaluateCms124(pt(over), P).status;
  assert.equal(c({ cervicalScreens: [{ date: "2024-01-01", type: "cytology" }] }), "met");
  assert.equal(c({ cervicalScreens: [{ date: "2023-12-31", type: "cytology" }] }), "due");
  assert.equal(c({ cervicalScreens: [{ date: "2022-01-01", type: "hpv" }] }), "met");
  assert.equal(c({ cervicalScreens: [{ date: "2021-12-31", type: "hpv" }] }), "due");
  // HPV before age 30 does not count; born 1995-06-01 is 27 in 2022.
  assert.equal(c({ birthDate: "1995-06-01", cervicalScreens: [{ date: "2022-06-01", type: "hpv" }] }), "due");
  assert.equal(c({ birthDate: "1995-06-01", cervicalScreens: [{ date: "2025-06-01", type: "hpv" }] }), "met"); // 30
  assert.equal(c({ cervicalScreens: [{ date: "2022-01-01", type: "cotest" }] }), "met");
  assert.equal(c({ hysterectomy: true }), "excluded");
});

test("CMS2 age 12 at period start, positive screen needs follow-up within 2 days", () => {
  assert.equal(evaluateCms2(pt({ birthDate: "2014-01-01" }), P).status, "due"); // 12 on Jan 1
  assert.equal(evaluateCms2(pt({ birthDate: "2014-01-02" }), P).status, "not_in_denominator");
  assert.equal(phqPositive("phq9", 10), true);
  assert.equal(phqPositive("phq9", 9), false);
  assert.equal(phqPositive("phq2", 3), true);
  assert.equal(phqPositive("phq2", 2), false);
  const d = (over: Partial<PanelPatient>) => evaluateCms2(pt(over), P).status;
  assert.equal(d({ phqResults: [{ date: "2026-03-01", tool: "phq9", score: 4 }] }), "met");
  assert.equal(d({ phqResults: [{ date: "2026-03-01", tool: "phq9", score: 14 }] }), "due");
  assert.equal(d({ phqResults: [{ date: "2026-03-01", tool: "phq9", score: 14 }], depressionFollowUps: ["2026-03-03"] }), "met");
  assert.equal(d({ phqResults: [{ date: "2026-03-01", tool: "phq9", score: 14 }], depressionFollowUps: ["2026-03-04"] }), "due");
  // Most recent screen wins.
  assert.equal(d({ phqResults: [{ date: "2026-01-01", tool: "phq9", score: 14 }, { date: "2026-06-01", tool: "phq2", score: 1 }] }), "met");
  assert.equal(d({ phqResults: [{ date: "2025-12-31", tool: "phq9", score: 2 }] }), "due");
  assert.equal(d({ bipolar: true }), "excluded");
  assert.equal(d({ depressionScreenException: true }), "excluded");
});

test("CMS138 screening and cessation with six month lookback", () => {
  const t = (over: Partial<PanelPatient>) => evaluateCms138(pt(over), P).status;
  assert.equal(t({}), "due");
  assert.equal(t({ birthDate: "2014-01-02" }), "not_in_denominator");
  assert.equal(t({ tobaccoScreens: [{ date: "2026-02-01", user: false }] }), "met");
  assert.equal(t({ tobaccoScreens: [{ date: "2026-02-01", user: true }] }), "due");
  assert.equal(t({ tobaccoScreens: [{ date: "2026-02-01", user: true }], tobaccoInterventions: ["2025-07-01"] }), "met");
  assert.equal(t({ tobaccoScreens: [{ date: "2026-02-01", user: true }], tobaccoInterventions: ["2025-06-30"] }), "due");
  assert.equal(t({ tobaccoScreens: [{ date: "2025-12-31", user: false }] }), "due");
  assert.equal(t({ hospice: true }), "excluded");
});

test("CMS347 four risk groups, ages at period start, exclusions and exceptions", () => {
  const s = (over: Partial<PanelPatient>) => evaluateCms347(pt(over), P).status;
  assert.equal(s({}), "not_in_denominator");
  assert.equal(s({ birthDate: "2010-01-01", ascvd: true }), "due"); // any age
  assert.equal(s({ birthDate: "2006-01-01", ldl190OrFh: true }), "due"); // 20
  assert.equal(s({ birthDate: "2006-01-02", ldl190OrFh: true }), "not_in_denominator"); // 19
  assert.equal(s({ birthDate: "1986-01-01", diabetes: true }), "due"); // 40
  assert.equal(s({ birthDate: "1986-01-02", diabetes: true }), "not_in_denominator"); // 39
  assert.equal(s({ birthDate: "1950-01-01", ascvdRisk20: true }), "not_in_denominator"); // 76
  assert.equal(s({ birthDate: "1951-01-01", ascvdRisk20: true }), "due"); // 75
  assert.equal(s({ ascvd: true, statin: true }), "met");
  for (const f of ["breastfeeding", "rhabdomyolysis", "hospice", "palliativeCare", "esrd", "statinException"] as const) {
    assert.equal(s({ ascvd: true, [f]: true }), "excluded", f);
  }
});

test("panel: rates for all eight measures, gaps due list, export", () => {
  const s = evaluateCareGapPanel([
    pt({ patientId: "A", mammograms: ["2026-01-01"] }),
    pt({ patientId: "B", sex: "male", birthDate: "2000-01-01" }),
  ], P);
  assert.deepEqual(s.rates.map((r) => r.measure), ALL_MEASURES);
  const c125 = s.rates.find((r) => r.measure === "CMS125")!;
  assert.deepEqual([c125.numerator, c125.denominator, c125.percent], [1, 1, 100]);
  const a = s.rows.find((r) => r.patientId === "A")!;
  assert.ok(a.gapsDue.some((g) => g.startsWith("CMS130")));
  assert.ok(!a.gapsDue.some((g) => g.startsWith("CMS125")));
  const csv = gapListCsv(s.rows);
  assert.match(csv.split("\n")[0], /gaps_due/);
  assert.match(csv, /CMS130: Colorectal screening due/);
  assert.equal(s.label, MEASURE_LABEL);
});

test("CSV import: new columns parse and validate per row", () => {
  const r = parsePanelCsv(templateCsv());
  assert.deepEqual(r.errors, []);
  const p = r.patients[0];
  assert.equal(p.sexAtBirth, "female");
  assert.deepEqual(p.colorectalScreens, [{ date: "2024-06-01", type: "fit_dna" }]);
  assert.deepEqual(p.phqResults, [{ date: "2026-02-03", tool: "phq9", score: 12 }]);
  assert.deepEqual(p.tobaccoScreens, [{ date: "2026-02-03", user: true }]);
  assert.equal(p.statin, true);
  const bad = parsePanelCsv([
    "patient_id,birth_date,hypertension,colorectal_screenings,cervical_screenings,phq_results,tobacco_screenings,mammogram_dates,sex_at_birth,statin",
    "X1,1970-01-01,no,2026-01-01 xray,2026-01-01 biopsy,2026-01-01 phq9 30,2026-01-01 sometimes,2026-13-01,unknown,perhaps",
  ].join("\n"));
  assert.equal(bad.patients.length, 0);
  assert.equal(bad.errors[0].messages.length, 7);
});

test("fixture: 50 synthetic patients with care gap columns parse cleanly", () => {
  const r = parsePanelCsv(readFileSync("fixtures/uds-panel-sample.csv", "utf8"));
  assert.deepEqual(r.errors, []);
  assert.equal(r.patients.length, 50);
  assert.ok(r.patients.some((p) => (p.phqResults || []).length > 0));
  assert.ok(r.patients.some((p) => (p.colorectalScreens || []).length > 0));
  const s = evaluateCareGapPanel(r.patients, P);
  for (const rate of s.rates) assert.ok(rate.denominator > 0, rate.measure);
});

test("server import keeps care gap fields and view returns all measures", async () => {
  const store = new MemoryClinicStore();
  const panel = new MemoryUdsPanelStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const admin = await store.addStaff(clinic.id, "provider", "Admin", null, { is_admin: true });
  const actor = { kind: "staff" as const, clinicId: clinic.id, staffId: admin.id, role: admin.role };
  const ok = await importUdsPanel(store, panel, actor, parsePanelCsv(templateCsv()).patients);
  assert.ok(ok.ok);
  const saved = (await panel.listPanel(clinic.id))[0];
  assert.deepEqual(saved.cervicalScreens, [{ date: "2023-04-15", type: "cotest" }]);
  const view = await viewUdsPanel(store, panel, actor, P);
  assert.ok(view.ok);
  if (view.ok) {
    assert.equal(view.data.rates.length, 8);
    assert.equal(view.data.unsupported_exclusions, CARE_GAP_UNSUPPORTED);
  }
  assert.equal((await viewUdsPanel(store, panel, { kind: "patient", patientId: "p" }, P)).ok, false);
});

test("care gap files: label, no race or Native status fields, no long dashes", () => {
  for (const f of ["src/lib/clinic/uds/care-gaps.ts", "src/lib/clinic/uds/csv.ts", "src/app/clinic/uds/UdsPanel.tsx", "fixtures/uds-panel-sample.csv", "scripts/generate-uds-fixture.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.equal(/\brace\b|ethnic|native|tribal|american indian|alaska/i.test(src), false, f);
    assert.equal(/[\u2013\u2014]/.test(src), false, f);
  }
  assert.match(readFileSync("src/lib/clinic/uds/care-gaps.ts", "utf8"), /not certified eCQM software/);
});
