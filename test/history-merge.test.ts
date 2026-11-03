import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeHealthHistory } from "../src/lib/history-merge";
import { healthHistorySchema } from "../src/lib/validate";

const SAVED_MEPA = {
  oliveOilPerDay: 2, leafyVegetablesPerWeek: 7, otherVegetablesPerDay: 2,
};

test("regression: saving step 3 with a blank diet keeps the saved diet answers", () => {
  const prior = { chronicConditions: [], le8: { mepa: SAVED_MEPA, sleepHours: 7 } };
  // What the old form sent when only activity was filled in.
  const incoming = healthHistorySchema.parse({ chronicConditions: [], le8: { mepa: {}, moderateMinutesPerWeek: 150 } });
  const merged = mergeHealthHistory(prior, incoming as Record<string, unknown>);
  assert.deepEqual((merged.le8 as Record<string, unknown>).mepa, SAVED_MEPA);
  assert.equal((merged.le8 as Record<string, unknown>).sleepHours, 7);
  assert.equal((merged.le8 as Record<string, unknown>).moderateMinutesPerWeek, 150);
});

test("entered diet answers replace only those items", () => {
  const merged = mergeHealthHistory({ le8: { mepa: SAVED_MEPA } }, { le8: { mepa: { oliveOilPerDay: 4 } } });
  assert.deepEqual((merged.le8 as Record<string, unknown>).mepa, { ...SAVED_MEPA, oliveOilPerDay: 4 });
});

test("no le8 in the save keeps all saved le8 answers; first save works with no prior", () => {
  const merged = mergeHealthHistory({ le8: { mepa: SAVED_MEPA } }, { medications: "none" });
  assert.deepEqual(merged.le8, { mepa: SAVED_MEPA });
  assert.deepEqual(mergeHealthHistory({}, { le8: { mepa: { oliveOilPerDay: 1 } } }).le8, { mepa: { oliveOilPerDay: 1 } });
});

test("form omits an empty diet object and the route uses the merge", () => {
  const form = readFileSync("src/lib/history-form.ts", "utf8");
  assert.match(form, /mepa: Object\.keys\(mepa\)\.length > 0 \? mepa : undefined/);
  const route = readFileSync("src/app/api/onboard/health-history/route.ts", "utf8");
  assert.match(route, /mergeHealthHistory\(prior,/);
  assert.equal(/\.\.\.parsed\.data\.le8/.test(route), false);
});
