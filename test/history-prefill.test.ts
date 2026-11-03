import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formToPayload, initialFormState, toSavedHistory } from "../src/lib/history-form";
import { mergeHealthHistory } from "../src/lib/history-merge";
import { healthHistorySchema } from "../src/lib/validate";

const RECORD = {
  chronicConditions: ["diabetes", "hypertension"],
  medications: "Metformin 500 mg",
  allergies: "Penicillin",
  familyHistory: "Father, heart disease",
  manualLabs: { a1c: 6.1 },
  le8: {
    mepa: { oliveOilPerDay: 2, fishPerWeek: 3 },
    moderateMinutesPerWeek: 120,
    nicotine: "never",
    livesWithIndoorSmoker: false,
    sleepHours: 7,
    bpTreated: true,
  },
};

function save(prior: Record<string, unknown>, payload: unknown) {
  const parsed = healthHistorySchema.parse(payload);
  return mergeHealthHistory(prior, parsed as Record<string, unknown>);
}

test("open form shows saved values", () => {
  const f = initialFormState(toSavedHistory(RECORD));
  assert.deepEqual(f.conditions, ["diabetes", "hypertension"]);
  assert.equal(f.meds, "Metformin 500 mg");
  assert.equal(f.allergies, "Penicillin");
  assert.equal(f.family, "Father, heart disease");
  assert.equal(f.moderate, "120");
  assert.equal(f.nicotine, "never");
  assert.equal(f.indoor, "no");
  assert.equal(f.sleepHours, "7");
  assert.equal(f.bpTreated, "yes");
  assert.equal(f.lipidTreated, "");
  assert.deepEqual(f.mepa, { oliveOilPerDay: "2", fishPerWeek: "3" });
});

test("first-time user sees an empty form", () => {
  const f = initialFormState(toSavedHistory(null));
  assert.deepEqual(f, {
    conditions: [], meds: "", allergies: "", family: "", moderate: "", vigorous: "", nicotine: "",
    indoor: "", sleepHours: "", lipidTreated: "", bpTreated: "", mepa: {},
  });
  assert.equal(formToPayload(f, null).clearLe8, undefined);
});

test("saving one section leaves every other saved answer intact", () => {
  const saved = toSavedHistory(RECORD)!;
  const f = initialFormState(saved);
  f.sleepHours = "8"; // only change sleep
  const next = save(RECORD, formToPayload(f, saved));
  assert.deepEqual(next.chronicConditions, RECORD.chronicConditions);
  assert.equal(next.medications, RECORD.medications);
  assert.equal(next.allergies, RECORD.allergies);
  assert.equal(next.familyHistory, RECORD.familyHistory);
  assert.deepEqual(next.manualLabs, RECORD.manualLabs);
  assert.deepEqual(next.le8, { ...RECORD.le8, sleepHours: 8 });
});

test("explicit removal clears only that answer", () => {
  const saved = toSavedHistory(RECORD)!;
  const f = initialFormState(saved);
  f.mepa = { ...f.mepa, fishPerWeek: "" }; // Remove on one diet item
  f.nicotine = "";                          // Remove nicotine
  f.allergies = "";                         // Remove allergies
  f.conditions = ["diabetes"];              // uncheck hypertension
  const payload = formToPayload(f, saved);
  assert.deepEqual(payload.clearLe8, ["mepa.fishPerWeek", "nicotine"]);
  const next = save(RECORD, payload) as typeof RECORD;
  assert.deepEqual(next.le8.mepa, { oliveOilPerDay: 2 });
  assert.equal("nicotine" in next.le8, false);
  assert.equal(next.le8.sleepHours, 7);
  assert.equal(next.allergies, "");
  assert.deepEqual(next.chronicConditions, ["diabetes"]);
  assert.equal(next.medications, RECORD.medications);
});

test("clear list only accepts known keys", () => {
  assert.equal(healthHistorySchema.safeParse({ chronicConditions: [], clearLe8: ["sleepHours", "mepa.fishPerWeek"] }).success, true);
  assert.equal(healthHistorySchema.safeParse({ chronicConditions: [], clearLe8: ["__proto__"] }).success, false);
  assert.equal(healthHistorySchema.safeParse({ chronicConditions: [], clearLe8: ["medications"] }).success, false);
});

test("prefill is decrypted on the server for the session patient only", () => {
  const page = readFileSync("src/app/onboard/page.tsx", "utf8");
  assert.match(page, /session\.patientId \? await loadSavedHistory\(session\.patientId\) : null/);
  const read = readFileSync("src/lib/history-read.ts", "utf8");
  assert.match(read, /import "server-only"/);
  assert.match(read, /history:\$\{patientId\}/);
  const form = readFileSync("src/app/onboard/OnboardClient.tsx", "utf8");
  assert.match(form, /RemoveButton/);
  assert.equal(/[\u2013\u2014]/.test(form + read + page), false);
});
