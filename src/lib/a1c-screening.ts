/**
 * One A1C prompt for every adult.
 *
 * ADA Standards of Care discuss screening for prediabetes and type 2
 * diabetes in asymptomatic adults, and they discuss earlier testing when
 * risk is higher. The CDC/ADA risk questionnaire was validated mostly in
 * non-Native populations, so this app does not use that questionnaire.
 * It does not ask about race or ethnicity, and it does not add an
 * ancestry question. That note stays in this comment and in the pull
 * request. It is not shown in the app.
 *
 * Age 18 or over is the only branch. The sentence is the same for
 * every adult.
 */

export const A1C_SCREENING_MIN_AGE = 18;

export const A1C_SCREENING_PROMPT =
  "Ask your care team about an A1C test. This is general information, not a diagnosis.";

export function ageFromDateOfBirth(dob: string, today = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [year, month, day] = dob.split("-").map(Number);
  const born = new Date(Date.UTC(year, month - 1, day));
  if (
    born.getUTCFullYear() !== year ||
    born.getUTCMonth() !== month - 1 ||
    born.getUTCDate() !== day
  ) {
    return null;
  }
  let age = today.getUTCFullYear() - year;
  const beforeBirthday =
    today.getUTCMonth() < month - 1 ||
    (today.getUTCMonth() === month - 1 && today.getUTCDate() < day);
  if (beforeBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function a1cScreeningPrompt(age: number | null): string | null {
  if (age == null || age < A1C_SCREENING_MIN_AGE) return null;
  return A1C_SCREENING_PROMPT;
}
