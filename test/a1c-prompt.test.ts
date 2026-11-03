import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adultA1cPrompt, ADULT_A1C_MIN_AGE, ADULT_A1C_PROMPT, ageInYears } from "../src/lib/a1c-prompt";

const TODAY = new Date("2026-11-03T00:00:00Z");

const UI_FILES = [
  "src/app/onboard/OnboardClient.tsx",
  "src/app/onboard/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/components/CareIQHealthOS.tsx",
];

const RACE_FIELD = /race|ethnicity|ethnic|hispanic|latino|latina|latinx|caucasian|american indian|alaska native|alaska|native hawaiian|pacific islander|african american|non-native|aian/i;

test("every adult 35 and over gets the same A1C prompt (ADA Standards of Care)", () => {
  assert.equal(ADULT_A1C_MIN_AGE, 35);
  // 35th birthday is today: prompt shows.
  assert.equal(ageInYears("1991-11-03", TODAY), 35);
  assert.equal(adultA1cPrompt("1991-11-03", TODAY), ADULT_A1C_PROMPT);
  // One day short of 35: no prompt.
  assert.equal(ageInYears("1991-11-04", TODAY), 34);
  assert.equal(adultA1cPrompt("1991-11-04", TODAY), null);
  assert.equal(adultA1cPrompt("1940-01-01", TODAY), ADULT_A1C_PROMPT);
  assert.equal(adultA1cPrompt("1980-06-15", TODAY), ADULT_A1C_PROMPT);
});

test("no automatic A1C prompt under 35", () => {
  assert.equal(adultA1cPrompt("2008-11-03", TODAY), null); // 18
  assert.equal(adultA1cPrompt("2000-01-01", TODAY), null); // 26
  assert.equal(adultA1cPrompt("2015-05-05", TODAY), null); // child
  assert.equal(adultA1cPrompt("", TODAY), null);
  assert.equal(adultA1cPrompt("not-a-date", TODAY), null);
});

test("A1C prompt copy is general information, not a diagnosis", () => {
  assert.equal(ADULT_A1C_PROMPT.includes("you have"), false);
  assert.match(ADULT_A1C_PROMPT, /age 35 and over/);
  assert.match(ADULT_A1C_PROMPT, /Ask your care team about one/);
  assert.ok(ADULT_A1C_PROMPT.endsWith("This is general information, not a diagnosis."));
  assert.equal(/[\u2013\u2014]/.test(ADULT_A1C_PROMPT), false);
});

test("onboarding and profile UI contain no race or ethnicity field", () => {
  for (const file of UI_FILES) {
    const source = readFileSync(file, "utf8");
    assert.equal(RACE_FIELD.test(source), false, file);
  }
  const schema = readFileSync("src/lib/validate.ts", "utf8");
  assert.equal(/americanIndian|alaska|ethnicity|race/i.test(schema), false);
});
