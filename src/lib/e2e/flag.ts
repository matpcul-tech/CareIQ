/**
 * Feature flag for on-device encryption of new patient health entries (design flag CLIENT_ENC_V1).
 * Off unless NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is the exact string "true".
 * While off, every existing route and the server-side encryption in src/lib/crypto.ts work as before.
 * This module does not read or write deployment settings.
 */
export const CLIENT_ENC_FLAG = "NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1";

export function isClientEncEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[CLIENT_ENC_FLAG] === "true";
}
