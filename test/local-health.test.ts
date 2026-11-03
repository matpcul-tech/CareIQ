import assert from "node:assert/strict";
import test from "node:test";
import {
  phraseFor,
  statusOf,
  wordingProblems,
  type LocalMarker,
  type LocalSex,
  type MarkerValue,
} from "../src/lib/local-health";

// Synthetic values only.

test("blood pressure uses 130/80 and 140/90", () => {
  assert.equal(statusOf("bp", { systolic: 129, diastolic: 79 }), "in_range");
  assert.equal(statusOf("bp", { systolic: 130, diastolic: 80 }), "borderline");
  assert.equal(statusOf("bp", { systolic: 139, diastolic: 79 }), "borderline");
  assert.equal(statusOf("bp", { systolic: 118, diastolic: 80 }), "borderline");
  assert.equal(statusOf("bp", { systolic: 140, diastolic: 78 }), "high");
  assert.equal(statusOf("bp", { systolic: 120, diastolic: 90 }), "high");
  assert.equal(statusOf("bp", null), "missing");
  assert.equal(statusOf("bp", 130), "missing");
});

test("A1C uses 5.7 and 6.5", () => {
  assert.equal(statusOf("a1c", 5.6), "in_range");
  assert.equal(statusOf("a1c", 5.7), "borderline");
  assert.equal(statusOf("a1c", 6.4), "borderline");
  assert.equal(statusOf("a1c", 6.5), "high");
});

test("fasting glucose uses 100 and 126", () => {
  assert.equal(statusOf("fasting_glucose", 99), "in_range");
  assert.equal(statusOf("fasting_glucose", 100), "borderline");
  assert.equal(statusOf("fasting_glucose", 125), "borderline");
  assert.equal(statusOf("fasting_glucose", 126), "high");
});

test("LDL uses 130, 160, and 190", () => {
  assert.equal(statusOf("ldl", 129), "in_range");
  assert.equal(statusOf("ldl", 100), "in_range");
  assert.equal(statusOf("ldl", 130), "borderline");
  assert.equal(statusOf("ldl", 159), "borderline");
  assert.equal(statusOf("ldl", 160), "high");
  assert.equal(statusOf("ldl", 189), "high");
  assert.equal(statusOf("ldl", 190), "very_high");
});

test("triglycerides use 150, 200, and 500", () => {
  assert.equal(statusOf("triglycerides", 149), "in_range");
  assert.equal(statusOf("triglycerides", 150), "borderline");
  assert.equal(statusOf("triglycerides", 199), "borderline");
  assert.equal(statusOf("triglycerides", 200), "high");
  assert.equal(statusOf("triglycerides", 499), "high");
  assert.equal(statusOf("triglycerides", 500), "very_high");
});

test("HDL uses 40 for men and unknown sex, and 50 for women", () => {
  assert.equal(statusOf("hdl", 39, "male"), "low");
  assert.equal(statusOf("hdl", 40, "male"), "in_range");
  assert.equal(statusOf("hdl", 45, "male"), "in_range");
  assert.equal(statusOf("hdl", 49, "female"), "low");
  assert.equal(statusOf("hdl", 50, "female"), "in_range");
  assert.equal(statusOf("hdl", 39, "unknown"), "low");
  assert.equal(statusOf("hdl", 40), "in_range");
  assert.equal(statusOf("hdl", 45), "in_range");
});

test("TSH outside 0.4 to 4.5 is outside, not a named condition", () => {
  assert.equal(statusOf("tsh", 0.4), "in_range");
  assert.equal(statusOf("tsh", 4.5), "in_range");
  assert.equal(statusOf("tsh", 2.1), "in_range");
  assert.equal(statusOf("tsh", 0.39), "outside");
  assert.equal(statusOf("tsh", 4.51), "outside");
  const low = phraseFor("tsh", "outside", 0.2);
  const high = phraseFor("tsh", "outside", 6.2);
  assert.match(low, /outside the typical lab range/);
  assert.match(high, /outside the typical lab range/);
  assert.doesNotMatch(low, /hypo|hyper|optimal/i);
  assert.doesNotMatch(high, /hypo|hyper|optimal/i);
});

test("vitamin D flags only below 20, with soft wording", () => {
  assert.equal(statusOf("vitamin_d", 20), "in_range");
  assert.equal(statusOf("vitamin_d", 25), "in_range");
  assert.equal(statusOf("vitamin_d", 19.9), "low");
  const text = phraseFor("vitamin_d", "low", 16);
  assert.match(text, /below 20 ng\/mL/);
  assert.doesNotMatch(text, /deficien|optimal|supplement/i);
});

test("in-range values are not judged by longevity optimal bands", () => {
  assert.equal(statusOf("ldl", 90), "in_range");
  assert.equal(statusOf("a1c", 5.4), "in_range");
  assert.equal(statusOf("fasting_glucose", 90), "in_range");
  assert.equal(statusOf("tsh", 3.2), "in_range");
  assert.equal(statusOf("vitamin_d", 32), "in_range");
});

const CASES: Array<{ key: LocalMarker; statusValue: MarkerValue; sex?: LocalSex }> = [
  { key: "bp", statusValue: { systolic: 118, diastolic: 76 } },
  { key: "bp", statusValue: { systolic: 132, diastolic: 84 } },
  { key: "bp", statusValue: { systolic: 146, diastolic: 92 } },
  { key: "a1c", statusValue: 5.4 },
  { key: "a1c", statusValue: 6.1 },
  { key: "a1c", statusValue: 7.2 },
  { key: "fasting_glucose", statusValue: 92 },
  { key: "fasting_glucose", statusValue: 110 },
  { key: "fasting_glucose", statusValue: 140 },
  { key: "ldl", statusValue: 101 },
  { key: "ldl", statusValue: 142 },
  { key: "ldl", statusValue: 170 },
  { key: "ldl", statusValue: 210 },
  { key: "triglycerides", statusValue: 120 },
  { key: "triglycerides", statusValue: 170 },
  { key: "triglycerides", statusValue: 240 },
  { key: "triglycerides", statusValue: 520 },
  { key: "hdl", statusValue: 55, sex: "male" },
  { key: "hdl", statusValue: 36, sex: "male" },
  { key: "hdl", statusValue: 44, sex: "female" },
  { key: "hdl", statusValue: 38, sex: "unknown" },
  { key: "tsh", statusValue: 1.8 },
  { key: "tsh", statusValue: 6.4 },
  { key: "vitamin_d", statusValue: 28 },
  { key: "vitamin_d", statusValue: 14 },
];

test("phrase table stays plain for every status", () => {
  for (const sample of CASES) {
    const status = statusOf(sample.key, sample.statusValue, sample.sex);
    const text = phraseFor(sample.key, status, sample.statusValue, sample.sex);
    assert.deepEqual(wordingProblems(text), [], text);
    assert.match(text, /care team/i);
    assert.doesNotMatch(text, /optimal|prediabetes|hypertension|deficient/i);
  }
  for (const key of ["bp", "a1c", "fasting_glucose", "ldl", "triglycerides", "hdl", "tsh", "vitamin_d"] as LocalMarker[]) {
    const missing = phraseFor(key, "missing");
    assert.deepEqual(wordingProblems(missing), [], missing);
    assert.match(missing, /on file/);
  }
});

test("wording guard catches you have, diagnos, and doses", () => {
  assert.deepEqual(wordingProblems("you have high cholesterol"), ["you have"]);
  assert.ok(wordingProblems("This may mean a diagnosis of illness.").includes("diagnos"));
  assert.deepEqual(
    wordingProblems("Talk with your care team.\nThis is general information, not a diagnosis."),
    [],
  );
  assert.ok(wordingProblems("Take 2000 IU daily.").includes("dose"));
  assert.ok(wordingProblems("Take 2,000 IU daily.").includes("dose"));
  assert.ok(wordingProblems("Use 500 mg tonight.").includes("dose"));
  assert.ok(wordingProblems("Add 10 mcg.").includes("dose"));
  assert.ok(wordingProblems("Give 2 units.").includes("dose"));
  assert.deepEqual(wordingProblems("LDL cholesterol on file is 130 mg/dL, below 130."), []);
  assert.deepEqual(wordingProblems("Vitamin D on file is 16 ng/mL, below 20 ng/mL."), []);
  assert.deepEqual(wordingProblems("TSH on file is 5.2 mIU/L, outside the typical lab range."), []);
});
