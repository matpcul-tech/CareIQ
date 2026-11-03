import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  buildMealPlan,
  buildWorkoutPlan,
  DISCLAIMER,
  planBucket,
  wordingProblems,
} from "../src/lib/local-health";

const quiet = { labs: { bpSystolic: 118, bpDiastolic: 76, a1c: 5.4, ldl: 101, hdl: 55 }, sex: "unknown" as const };

test("plans stay the same within a day and change across days", () => {
  const first = buildWorkoutPlan(quiet, 1);
  assert.equal(first, buildWorkoutPlan(quiet, 1));
  assert.equal(first, buildWorkoutPlan(quiet, 8));
  assert.notEqual(first, buildWorkoutPlan(quiet, 2));
  assert.equal(buildMealPlan(quiet, 3), buildMealPlan(quiet, 3));
  assert.notEqual(buildMealPlan(quiet, 3), buildMealPlan(quiet, 4));
});

test("recorded conditions, labs, and steps choose the note", () => {
  assert.equal(planBucket({ conditions: ["heart disease"], labs: quiet.labs }), "cautious");
  assert.equal(planBucket({ labs: { bpSystolic: 150, bpDiastolic: 96 } }), "pressure");
  assert.equal(planBucket({ labs: { a1c: 6.1, bpSystolic: 118, bpDiastolic: 76 } }), "glucose");
  assert.equal(planBucket({ labs: { ldl: 170 } }), "lipids");
  assert.equal(planBucket(quiet), "general");
  assert.equal(planBucket({ conditions: ["you have heart failure"] }), "general");

  const low = buildWorkoutPlan({ ...quiet, steps: 3200 }, 0);
  const high = buildWorkoutPlan({ ...quiet, steps: 8000 }, 0);
  assert.match(low, /under 5000/);
  assert.match(low, /3200/);
  assert.equal(high.includes("under 5000"), false);
  assert.match(high, /8000/);
});

test("workout and meal copy asks the care team and avoids orders and doses", () => {
  const inputs = [
    quiet,
    { labs: { bpSystolic: 146, bpDiastolic: 92 }, conditions: ["asthma"], steps: 2400 },
    { labs: { a1c: 7.1, fastingGlucose: 140, hdl: 36 }, sex: "female" as const, steps: 9000 },
    { conditions: ["hypertension"] },
  ];
  for (const input of inputs) {
    for (const day of [0, 1, 2, 3, 4, 5, 6]) {
      for (const text of [buildWorkoutPlan(input, day), buildMealPlan(input, day)]) {
        assert.match(text, /Check with your care team before starting/);
        assert.match(text, /care team/i);
        assert.ok(text.endsWith(DISCLAIMER), text);
        assert.deepEqual(wordingProblems(text), [], text);
        assert.doesNotMatch(text, /HIIT|zone 2|sets|reps|supplement|intensity/i);
      }
    }
  }
  const heart = buildWorkoutPlan({ conditions: ["hypertension"] }, 0);
  assert.equal(heart.includes("hypertension"), false);
  assert.match(heart, /recorded condition/);
});

test("workout and meal cards do not call the shield", async () => {
  const src = await readFile(path.resolve(__dirname, "../src/components/CareIQHealthOS.tsx"), "utf8");
  assert.equal(src.includes("inferConditions"), false);
  assert.equal(src.includes("useShieldGenerate"), false);
  const workout = src.slice(src.indexOf("function WorkoutPlan"), src.indexOf("function MealPlan"));
  const meal = src.slice(src.indexOf("function MealPlan"), src.indexOf("function dc"));
  assert.match(workout, /buildWeeklyPlan/);
  assert.match(meal, /buildMealPlan/);
  assert.equal(workout.includes("fetch("), false);
  assert.equal(meal.includes("fetch("), false);
  assert.equal(src.includes("AI Generated"), false);
});
