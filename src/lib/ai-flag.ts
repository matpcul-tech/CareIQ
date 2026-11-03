/**
 * Server flag for optional model calls.
 * Off unless CAREIQ_AI_ENABLED is the exact string "true".
 * Unset, empty, "1", "yes", and "TRUE" stay off.
 * The boolean is passed to client components as aiEnabled.
 * This module does not read or write deployment settings.
 */

export function isAiEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.CAREIQ_AI_ENABLED === "true";
}
