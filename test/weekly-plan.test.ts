import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { bpCategory, buildWeeklyPlan, DISCLAIMER, stepGoalFrom, wordingProblems } from "../src/lib/local-health";

// Synthetic values only.
const base = { ageYears: 45, bmi: 24, moderateMinutesPerWeek: 60 };

test("bp categories follow ACC/AHA cut points", () => {
  assert.equal(bpCategory(115, 75), "normal");
  assert.equal(bpCategory(125, 78), "elevated");
  assert.equal(bpCategory(135, 80), "stage1");
  assert.equal(bpCategory(118, 85), "stage1");
  assert.equal(bpCategory(145, 85), "stage2");
  assert.equal(bpCategory(128, 92), "stage2");
  assert.equal(bpCategory(182, 100), "very_high");
  assert.equal(bpCategory(150, 121), "very_high");
  assert.equal(bpCategory(undefined, 80), "missing");
});

test("normal bp gives a full 7 day plan with 2 strength days", () => {
  const p = buildWeeklyPlan({ ...base, bpSystolic: 115, bpDiastolic: 75 });
  assert.equal(p.status, "plan");
  assert.equal(p.days.length, 7);
  assert.equal(p.days.filter((d) => /strength/i.test(d.activity)).length, 2);
  assert.equal(p.weeklyMinutes, 80);
  assert.match(p.stepUp, /from about 60 to 80/);
});

test("elevated bp at target can include one vigorous day", () => {
  const p = buildWeeklyPlan({ ...base, moderateMinutesPerWeek: 160, bpSystolic: 125, bpDiastolic: 78 });
  assert.ok(p.days.some((d) => d.intensity === "vigorous"));
  assert.ok(p.weeklyMinutes >= 150);
});

test("stage 1 adds a breathing safety note and no vigorous day", () => {
  const p = buildWeeklyPlan({ ...base, moderateMinutesPerWeek: 200, bpSystolic: 135, bpDiastolic: 80 });
  assert.ok(p.safety.some((s) => /stage 1/.test(s)));
  assert.ok(!p.days.some((d) => d.intensity === "vigorous"));
});

test("stage 2 caps the week at 90 minutes and asks for clearance", () => {
  const p = buildWeeklyPlan({ ...base, moderateMinutesPerWeek: 300, bpSystolic: 150, bpDiastolic: 95 });
  assert.equal(p.status, "plan");
  assert.ok(p.weeklyMinutes <= 90);
  assert.ok(p.safety.some((s) => /stage 2/.test(s) && /clear/.test(s)));
});

test("very high bp shows no plan and a contact now message", () => {
  const p = buildWeeklyPlan({ ...base, bpSystolic: 185, bpDiastolic: 110 });
  assert.equal(p.status, "contact_care_team");
  assert.equal(p.days.length, 0);
  assert.match(p.text, /Contact your care team now/);
  assert.match(p.text, /911/);
});

test("missing data is listed and never filled in", () => {
  const p = buildWeeklyPlan({});
  assert.equal(p.bpCategory, "missing");
  assert.equal(p.missing.length, 5);
  assert.equal(p.stepGoal, null);
  assert.ok(p.weeklyMinutes <= 90 && p.weeklyMinutes >= 60);
  assert.match(p.text, /Not on file: Blood pressure/);
  assert.doesNotMatch(p.text, /Age \d/);
});

test("older adults get balance work", () => {
  const p = buildWeeklyPlan({ ...base, ageYears: 70, bpSystolic: 118, bpDiastolic: 76 });
  assert.ok(p.days.filter((d) => /balance/i.test(d.activity)).length >= 3);
  assert.ok(p.safety.some((s) => /65 and older/.test(s)));
  const young = buildWeeklyPlan({ ...base, bpSystolic: 118, bpDiastolic: 76 });
  assert.ok(!young.days.some((d) => /balance/i.test(d.activity)));
});

test("step goal is average plus 1000 with a cap", () => {
  assert.equal(stepGoalFrom(null), null);
  assert.equal(stepGoalFrom(5000), 6000);
  assert.equal(stepGoalFrom(11500), 12000);
  assert.equal(stepGoalFrom(14000), 14000);
  const p = buildWeeklyPlan({ ...base, bpSystolic: 118, bpDiastolic: 76, dailySteps: [4000, 5000, 6000, 0] });
  assert.equal(p.averageSteps, 5000);
  assert.equal(p.stepGoal, 6000);
  assert.match(p.stepUp, /Daily step goal: 6000 steps/);
});

test("high bmi gets low impact options", () => {
  const p = buildWeeklyPlan({ ...base, bmi: 34, bpSystolic: 118, bpDiastolic: 76 });
  assert.ok(p.days.some((d) => /water walking/.test(d.activity)));
});

test("copy passes wording rules and has no banned phrases", async () => {
  const inputs = [
    {}, { ...base, bpSystolic: 135, bpDiastolic: 80 }, { ...base, bpSystolic: 190, bpDiastolic: 125 },
    { ...base, ageYears: 80, bmi: 17, dailySteps: [3000], dailyHeartRate: [105] },
  ];
  for (const input of inputs) {
    const t = buildWeeklyPlan(input).text;
    assert.deepEqual(wordingProblems(t), []);
    assert.ok(t.endsWith(DISCLAIMER));
    assert.match(t, /care team/);
    assert.doesNotMatch(t, /HIPAA|race|native/i);
  }
  const src = await readFile(path.resolve(__dirname, "../src/lib/local-health/weekly-plan.ts"), "utf8");
  assert.equal(/[\u2013\u2014]/.test(src), false);
  assert.equal(/fetch\(|anthropic/i.test(src), false);
});

test("same input gives the same plan", () => {
  const i = { ...base, bpSystolic: 135, bpDiastolic: 80 };
  assert.equal(buildWeeklyPlan(i).text, buildWeeklyPlan(i).text);
});

test("rest days show Rest, no minutes, and add nothing to the total", () => {
  const p = buildWeeklyPlan({ ...base, bpSystolic: 118, bpDiastolic: 76 });
  const rest = p.days.filter((d) => d.intensity === "rest");
  assert.deepEqual(rest.map((d) => d.day), ["Wed", "Sun"]);
  for (const d of rest) {
    assert.equal(d.activity, "Rest day. Gentle stretching is optional.");
    assert.equal(d.minutes, 0);
    assert.equal(d.aerobicCredit, 0);
    assert.match(d.intensityNote, /^Light:/);
  }
  assert.equal(p.weeklyMinutes, p.days.reduce((s, d) => s + d.minutes - (/strength/.test(d.activity) ? 15 : 0), 0));
  assert.match(p.text, /Wed: Rest day\. Gentle stretching is optional\. Light:/);
  assert.doesNotMatch(p.text, /Wed: [^\n]*\d+ min/);
  assert.doesNotMatch(p.text, /Sun: [^\n]*\d+ min/);
});
