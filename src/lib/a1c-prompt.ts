/**
 * A1C screening prompt.
 *
 * ADA Standards of Care start routine diabetes screening at age 35, and
 * earlier when risk is higher. This product shows the same prompt to
 * every adult age 18 and over. It does not collect race or ethnicity
 * and it does not change the prompt for anyone.
 */

export const ADULT_A1C_MIN_AGE = 18;

export const ADULT_A1C_PROMPT =
  "Ask your care team about an A1C test. This is general information, not a diagnosis.";

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
