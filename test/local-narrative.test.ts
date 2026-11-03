import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildHealthNarrative, DISCLAIMER, wordingProblems } from "../src/lib/local-health";

const sample = {
  labs: {
    bpSystolic: 150,
    bpDiastolic: 96,
    a1c: 6.8,
    fastingGlucose: 140,
    ldl: 170,
    triglycerides: 240,
    hdl: 30,
    tsh: 6.1,
    vitaminD: 12,
  },
  sex: "female" as const,
  conditions: ["asthma"],
};

test("the same labs always produce the same narrative", () => {
  assert.equal(buildHealthNarrative(sample), buildHealthNarrative(sample));
});

test("narrative keeps at most 3 items in priority order", () => {
  const text = buildHealthNarrative(sample);
  assert.match(text, /150\/96/);
  assert.match(text, /6\.8/);
  assert.match(text, /140/);
  assert.match(text, /170/);
  assert.equal(text.includes("Triglycerides"), false);
  assert.equal(text.includes("HDL"), false);
  assert.equal(text.includes("TSH"), false);
  assert.equal(text.includes("Vitamin D"), false);
  assert.match(text, /asthma/);
  assert.equal(text.includes("hypertension"), false);
  assert.equal(text.includes("prediabetes"), false);
  assert.ok(text.endsWith(DISCLAIMER));
  assert.deepEqual(wordingProblems(text), []);
});

test("a later marker is shown when earlier markers are inside the cut points", () => {
  const text = buildHealthNarrative({
    labs: { bpSystolic: 118, bpDiastolic: 76, a1c: 5.4, ldl: 101, tsh: 6.4 },
    sex: "unknown",
  });
  assert.match(text, /outside the typical lab range/);
  assert.equal(text.includes("118/76"), false);
  assert.equal(text.includes("5.4"), false);
});

test("no labs and no conditions says so plainly", () => {
  const text = buildHealthNarrative({});
  assert.match(text, /No lab results or recorded conditions are on file/);
  assert.match(text, /care team/i);
  assert.ok(text.endsWith(DISCLAIMER));
  assert.deepEqual(wordingProblems(text), []);
});

test("recorded conditions are quoted and unsafe wording is dropped", () => {
  const text = buildHealthNarrative({
    conditions: ["asthma", "you have diabetes", "  "],
  });
  assert.match(text, /asthma/);
  assert.equal(text.includes("you have"), false);
  assert.deepEqual(wordingProblems(text), []);
});

test("narrative card does not infer conditions or call the shield", async () => {
  const src = await readFile(path.resolve(__dirname, "../src/components/CareIQHealthOS.tsx"), "utf8");
  const start = src.indexOf("function HealthNarrative");
  const end = src.indexOf("function WorkoutPlan");
  const body = src.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(body.includes("inferConditions"), false);
  assert.equal(body.includes("/api/shield"), false);
  assert.equal(body.includes("Regenerate"), false);
  assert.match(body, /buildHealthNarrative/);
  assert.match(src, /badge b-violet">Local</);

  const button = await readFile(path.resolve(__dirname, "../src/app/dashboard/InsightButton.tsx"), "utf8");
  assert.equal(button.includes("fetch("), false);
  assert.equal(button.includes("/api/shield"), false);
  assert.match(button, /buildHealthNarrative/);
});
