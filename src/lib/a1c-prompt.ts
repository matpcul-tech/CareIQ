/**
 * A1C screening prompt.
 *
 * Source: American Diabetes Association, Standards of Care in Diabetes,
 * Section 2 (Diagnosis and Classification of Diabetes): testing for
 * prediabetes and type 2 diabetes should begin at age 35 for all adults,
 * regardless of risk factors. Earlier testing for people under 35 is a
 * risk-based decision for the care team, so this product shows no
 * automatic prompt under 35.
 *
 * The same prompt is shown to every adult age 35 and over. This product
 * does not collect race or ethnicity and it does not change the prompt
 * for anyone.
 */

/** ADA Standards of Care: screen all adults starting at age 35. */
export const ADULT_A1C_MIN_AGE = 35;

export const ADULT_A1C_PROMPT =
  "Adults age 35 and over are advised to get an A1C test. Ask your care team about one. This is general information, not a diagnosis.";

export function ageInYears(dateOfBirth: string, today: Date): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) return null;
  const born = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(born.getTime())) return null;
  let age = today.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

export function adultA1cPrompt(dateOfBirth: string, today: Date): string | null {
  const age = ageInYears(dateOfBirth, today);
  if (age === null || age < ADULT_A1C_MIN_AGE) return null;
  return ADULT_A1C_PROMPT;
}
