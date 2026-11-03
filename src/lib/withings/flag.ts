/**
 * Withings integration flag. Off unless WITHINGS_ENABLED is the exact
 * string "true". Every Withings route returns 404 while it is off.
 */
export function isWithingsEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.WITHINGS_ENABLED === "true";
}
