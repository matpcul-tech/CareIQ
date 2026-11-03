import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  A1C_SCREENING_PROMPT,
  a1cScreeningPrompt,
  ageFromDateOfBirth,
} from "../src/lib/a1c-screening";
import { wordingProblems } from "../src/lib/local-health";

const TODAY = new Date(Date.UTC(2026, 10, 3));

test("every adult gets the same A1C prompt and younger people do not", () => {
  assert.equal(ageFromDateOfBirth("2008-11-03", TODAY), 18);
  assert.equal(ageFromDateOfBirth("2008-11-04", TODAY), 17);
  assert.equal(ageFromDateOfBirth("1940-01-01", TODAY), 86);
  const adult = a1cScreeningPrompt(18);
  const older = a1cScreeningPrompt(86);
  assert.equal(adult, A1C_SCREENING_PROMPT);
  assert.equal(older, adult);
  assert.equal(a1cScreeningPrompt(17), null);
  assert.equal(a1cScreeningPrompt(null), null);
  assert.equal(ageFromDateOfBirth("", TODAY), null);
  assert.match(adult as string, /Ask your care team about an A1C test/);
  assert.ok((adult as string).endsWith("This is general information, not a diagnosis."));
  assert.deepEqual(wordingProblems(adult as string), []);
});

test("onboarding UI does not ask about race or ethnicity", async () => {
  const ui = await readFile(path.resolve(__dirname, "../src/app/onboard/OnboardClient.tsx"), "utf8");
  assert.match(ui, /a1cScreeningPrompt/);
  assert.doesNotMatch(ui, /race|ethnicity|American Indian|Alaska Native|non-Native|Native American/i);
  assert.doesNotMatch(ui, /validated mostly/i);
});
