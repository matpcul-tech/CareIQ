import type { Actor } from "./logic";
import { signClinicActor } from "./token";

export const STAFF_COOKIE_NAME = "sov_clinic";

// Matches the staff token lifetime used before tokens were removed from
// clinic responses. The cookie and the signature expire together.
export const STAFF_SESSION_MS = 12 * 60 * 60 * 1000;
export const STAFF_COOKIE_MAX_AGE_SEC = STAFF_SESSION_MS / 1000;

export function issueStaffToken(
  actor: Extract<Actor, { kind: "staff" }>,
  secret: string,
  nowMs: number,
): string | null {
  return signClinicActor(actor, secret, nowMs + STAFF_SESSION_MS);
}

export function staffAuthCookie(token: string) {
  return {
    name: STAFF_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      path: "/",
      maxAge: STAFF_COOKIE_MAX_AGE_SEC,
    },
  };
}
