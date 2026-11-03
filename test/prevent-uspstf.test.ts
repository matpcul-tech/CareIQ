import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRiskInputs } from "../src/lib/clinical-info";
import { preventCategory, preventTotalCvd10, type PreventInputs } from "../src/lib/prevent";
import { uspstfList } from "../src/lib/uspstf";

// Published example patient (Khan et al. 2023 PREVENT supplement; the AHA calculator and the
// preventr R package reproduce it): 50 years, total cholesterol 200, HDL 45, SBP 160 on treatment,
// diabetes, non smoker, eGFR 90, no statin. 10-year total CVD 14.7% female, 16.3% male.
const example: PreventInputs = { age: 50, totalCholesterol: 200, hdl: 45, systolic: 160, bpTreated: true, diabetes: true, currentSmoker: false, egfr: 90, statin: false };

test("PREVENT matches the published worked examples", () => {
  const f = preventTotalCvd10({ ...example, sex: "female" });
  const m = preventTotalCvd10({ ...example, sex: "male" });
  assert.ok(f.ok && m.ok);
  if (!f.ok || !m.ok) return;
  assert.equal(f.percent, "14.7%");
  assert.equal(m.percent, "16.3%");
  assert.equal(Math.round(f.risk * 1000) / 1000, 0.147);
  assert.equal(Math.round(m.risk * 1000) / 1000, 0.163);
});

test("PREVENT terms (statin, smoking, low eGFR, low SBP, range ends) match an independent calculation from Table S12A", () => {
  // Expected values computed separately from the published coefficient table.
  const cases: [PreventInputs, number][] = [
    [{ sex: "female", age: 62, totalCholesterol: 240, hdl: 38, systolic: 145, bpTreated: false, diabetes: false, currentSmoker: true, egfr: 52, statin: true }, 0.176115],
    [{ sex: "male", age: 71, totalCholesterol: 180, hdl: 60, systolic: 118, bpTreated: true, diabetes: true, currentSmoker: false, egfr: 40, statin: true }, 0.269167],
    [{ sex: "male", age: 35, totalCholesterol: 150, hdl: 55, systolic: 104, bpTreated: false, diabetes: false, currentSmoker: true, egfr: 120, statin: false }, 0.009573],
    [{ sex: "female", age: 79, totalCholesterol: 320, hdl: 20, systolic: 180, bpTreated: true, diabetes: true, currentSmoker: true, egfr: 15, statin: false }, 0.471202],
    [{ sex: "male", age: 45, totalCholesterol: 210, hdl: 42, systolic: 132, bpTreated: false, diabetes: false, currentSmoker: false, egfr: 95, statin: false }, 0.027283],
  ];
  for (const [input, expected] of cases) {
    const r = preventTotalCvd10(input);
    assert.ok(r.ok);
    if (r.ok) assert.ok(Math.abs(r.risk - expected) < 5e-6, `${JSON.stringify(input)} ${r.risk}`);
  }
});

test("not enough data lists exactly what is missing; out of range is named", () => {
  const r = preventTotalCvd10({ age: 50, sex: "female", totalCholesterol: 200 });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.deepEqual(r.missing, ["HDL cholesterol", "systolic blood pressure", "whether you take blood pressure medicine", "diabetes status", "smoking status", "eGFR (kidney filtration)", "whether you take a statin or cholesterol medicine"]);
  }
  const unknownSex = preventTotalCvd10({ ...example, sex: "unknown" });
  assert.ok(!unknownSex.ok && unknownSex.missing.includes("sex"));
  const young = preventTotalCvd10({ ...example, sex: "male", age: 29 });
  assert.ok(!young.ok && young.outOfRange[0].startsWith("age"));
  assert.equal(preventTotalCvd10({ ...example, sex: "male", age: 80 }).ok, false);
  assert.equal(preventTotalCvd10({ ...example, sex: "male", systolic: 200 }).ok, false);
  assert.equal(preventCategory(0.049), "low");
  assert.equal(preventCategory(0.05), "borderline");
  assert.equal(preventCategory(0.075), "intermediate");
  assert.equal(preventCategory(0.2), "high");
});

test("risk inputs come from data on file; unanswered stays missing", () => {
  const r = buildRiskInputs({ age: 60, sex: "male", labs: { totalCholesterol: 210, hdl: 40, bpSystolic: 138, egfr: 70 }, conditions: ["Hypertension"], nicotine: "quit_5y_or_more", bpTreated: true, lipidTreated: false, bmi: 31 });
  assert.equal(r.diabetes, false);
  assert.equal(r.currentSmoker, false);
  assert.equal(r.smoking, "former");
  assert.ok(preventTotalCvd10(r).ok);
  const empty = buildRiskInputs({ age: 60, sex: "male", labs: {} });
  assert.equal(empty.diabetes, null);
  assert.equal(empty.currentSmoker, null);
  assert.equal(buildRiskInputs({ age: 60, sex: "male", labs: {}, conditions: ["Type 2 diabetes"], nicotine: "current_smoker" }).currentSmoker, true);
});

const ids = (i: Parameters<typeof uspstfList>[0]) => uspstfList(i).items.map((x) => x.id);

test("USPSTF list by age and sex, grade A and B only", () => {
  assert.deepEqual(ids({ age: 30, sex: "female", smoking: "never" }), ["bp", "cervical", "depression", "tobacco", "hepc", "hiv"]);
  assert.deepEqual(ids({ age: 52, sex: "male", smoking: "never", bmi: 28 }), ["bp", "diabetes", "colorectal", "statin", "depression", "tobacco", "hepc", "hiv"]);
  assert.deepEqual(ids({ age: 68, sex: "male", smoking: "former" }), ["bp", "diabetes", "colorectal", "statin", "depression", "tobacco", "hepc", "lung", "aaa"]);
  assert.ok(!ids({ age: 68, sex: "female", smoking: "former" }).includes("aaa"));
  assert.ok(ids({ age: 45, sex: "female" }).includes("breast"));
  assert.ok(!ids({ age: 75, sex: "female" }).includes("breast"));
  assert.ok(ids({ age: 16, sex: "male" }).includes("hiv"));
  assert.ok(!ids({ age: 66, sex: "male" }).includes("hiv"));
  assert.ok(!ids({ age: 81, sex: "male", smoking: "current" }).includes("lung"));
  for (const i of uspstfList({ age: 60, sex: "unknown", smoking: "unknown" }).items) assert.ok(i.grade === "A" || i.grade === "B");
  assert.equal(uspstfList({ age: 47, sex: "male" }).items.find((i) => i.id === "colorectal")?.grade, "B");
  assert.equal(uspstfList({ age: 55, sex: "male" }).items.find((i) => i.id === "colorectal")?.grade, "A");
  assert.ok(uspstfList({ age: null }).needsAge);
});

test("A1C item notes the ADA all adults 35 and up prompt; sources cited", () => {
  const d = uspstfList({ age: 40, sex: "female", bmi: 22 }).items.find((i) => i.id === "diabetes");
  assert.match(d?.detail || "", /35 and older/);
  assert.match(d?.detail || "", /American Diabetes Association/);
  for (const i of uspstfList({ age: 70, sex: "male", smoking: "current" }).items) assert.match(i.source, /^https:\/\/www\.uspreventiveservicestaskforce\.org\/uspstf\/recommendation\//);
});

test("no race input anywhere; marked general guidance, not a diagnosis", () => {
  for (const f of ["src/lib/prevent.ts", "src/lib/uspstf.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src, /\b(ethnic|native)\b/i);
    assert.doesNotMatch(src.replace(/no race|never race|not use race|No race or ethnicity input/gi, ""), /\brace\b/i);
  }
  const ui = readFileSync("src/components/CareIQHealthOS.tsx", "utf8");
  assert.match(ui, /General guidance, not a diagnosis/);
  assert.doesNotMatch(ui, /TODO: PREVENT|TODO: A USPSTF/);
  assert.match(ui, /Not enough data to estimate/);
});
