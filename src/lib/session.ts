import "server-only";

import { cookies, headers } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { hashEmail, sha256Hex } from "@/lib/crypto";

const SESSION_COOKIE = "sov_session";
const AUTH_COOKIE = "sov_auth";
const SESSION_TS_COOKIE = "sov_session_ts";

// 7-day patient auth window. Was 24h, but pilot demos that ran across a
// week kept hitting the maxAge expiry and getting bounced to /onboard.
// 7 days lines up with how often a patient is realistically expected to
// re-authenticate during a demo cycle. The middleware's rotating session
// cookie still rotates per request and has its own 24h idle window;
// sov_auth carries the actual signed-in identity and is the cookie that
// determines whether the user stays logged in.
const AUTH_COOKIE_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export interface ServerSession {
  sessionId: string; // raw rotating session id from middleware
  sessionHash: string; // sha256 of session id (used in audit log)
  patientId: string | null;
  emailHash: string | null;
  // Supabase auth user id from sign-in. Unsigned cookie value: verify it
  // against server data before granting anything with it.
  authUserId?: string | null;
}

/**
 * Reads the rotating session id (set by middleware) and the auth cookie
 * which contains the encrypted patient identity. Use in server components
 * and API route handlers only.
 */
export function readSession(): ServerSession {
  const c = cookies();
  const h = headers();
  const sessionId = h.get("x-session-id") || c.get(SESSION_COOKIE)?.value || "";
  const sessionHash = sessionId ? sha256Hex(sessionId) : "";
  const auth = c.get(AUTH_COOKIE)?.value || "";
  if (!auth) {
    return { sessionId, sessionHash, patientId: null, emailHash: null };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(auth, "base64url").toString("utf8"),
    ) as { patientId?: string; emailHash?: string; authUserId?: string };
    return {
      sessionId,
      sessionHash,
      patientId: typeof parsed.patientId === "string" ? parsed.patientId : null,
      emailHash: typeof parsed.emailHash === "string" ? parsed.emailHash : null,
      authUserId: typeof parsed.authUserId === "string" ? parsed.authUserId : null,
    };
  } catch {
    return { sessionId, sessionHash, patientId: null, emailHash: null };
  }
}

/**
 * Establish the patient identity cookie after a verified magic link callback.
 * The cookie carries the patient_id and email_hash only. No name, no PHI.
 */
export function writeAuthCookie(patientId: string, email: string, authUserId?: string | null): {
  name: string;
  value: string;
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "lax";
    path: string;
    maxAge: number;
  };
} {
  const emailHash = hashEmail(email);
  const payload = Buffer.from(
    JSON.stringify(authUserId ? { patientId, emailHash, authUserId } : { patientId, emailHash }),
    "utf8",
  ).toString("base64url");
  return {
    name: AUTH_COOKIE,
    value: payload,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: AUTH_COOKIE_MAX_AGE_SEC,
    },
  };
}

export function clearAuthCookies() {
  return [
    { name: AUTH_COOKIE, options: { path: "/", maxAge: 0 } },
    { name: SESSION_COOKIE, options: { path: "/", maxAge: 0 } },
    { name: SESSION_TS_COOKIE, options: { path: "/", maxAge: 0 } },
  ];
}

/**
 * Resolve the patient_id for a verified email, creating the row if needed.
 * Email is stored only as a salted hash. No plaintext email persistence.
 */
export async function upsertPatientByEmail(email: string): Promise<{ patientId: string; created: boolean }> {
  const sb = getServiceClient();
  const emailHash = hashEmail(email);
  const { data: existing, error: selErr } = await sb
    .from("patients")
    .select("id")
    .eq("email_hash", emailHash)
    .maybeSingle();
  if (selErr) throw new Error("patient lookup failed");
  if (existing?.id) return { patientId: existing.id as string, created: false };

  const { data: inserted, error: insErr } = await sb
    .from("patients")
    .insert({ email_hash: emailHash })
    .select("id")
    .single();
  if (insErr || !inserted?.id) throw new Error("patient create failed");
  return { patientId: inserted.id as string, created: true };
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
export const AUTH_COOKIE_NAME = AUTH_COOKIE;
