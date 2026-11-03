import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adultA1cPrompt, ADULT_A1C_PROMPT, ageInYears } from "../src/lib/a1c-prompt";

const TODAY = new Date("2026-11-03T00:00:00Z");

const UI_FILES = [
  "src/app/onboard/OnboardClient.tsx",
  "src/app/onboard/page.tsx",
  "src/app/dashboard/page.tsx",
  "src/components/CareIQHealthOS.tsx",
];

const RACE_FIELD = /race|ethnicity|ethnic|hispanic|latino|latina|latinx|caucasian|american indian|alaska native|alaska|native hawaiian|pacific islander|african american|non-native|aian/i;

test("every adult 18 and over gets the same A1C prompt", () => {
  assert.equal(ageInYears("2008-11-03", TODAY), 18);
  assert.equal(ageInYears("2008-11-04", TODAY), 17);
  assert.equal(adultA1cPrompt("2008-11-03", TODAY), ADULT_A1C_PROMPT);
  assert.equal(adultA1cPrompt("1940-01-01", TODAY), ADULT_A1C_PROMPT);
  assert.equal(adultA1cPrompt("2008-11-04", TODAY), null);
  assert.equal(adultA1cPrompt("", TODAY), null);
  assert.equal(ADULT_A1C_PROMPT.includes("you have"), false);
  assert.match(ADULT_A1C_PROMPT, /Ask your care team about an A1C test/);
  assert.ok(ADULT_A1C_PROMPT.endsWith("This is general information, not a diagnosis."));
});

test("onboarding and profile UI contain no race or ethnicity field", () => {
  for (const file of UI_FILES) {
    const source = readFileSync(file, "utf8");
    assert.equal(RACE_FIELD.test(source), false, file);
  }
  const schema = readFileSync("src/lib/validate.ts", "utf8");
  assert.equal(/americanIndian|alaska|ethnicity|race/i.test(schema), false);
});
