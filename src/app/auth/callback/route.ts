import { NextRequest, NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getServiceClient } from "@/lib/supabase-server";
import { getPublicOrigin } from "@/lib/origin";
import { upsertPatientByEmail, writeAuthCookie } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { hashEmail } from "@/lib/crypto";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { bindStaffOnSignIn } from "@/lib/clinic/staff-auth";
import { issueStaffToken, staffAuthCookie, STAFF_COOKIE_NAME } from "@/lib/clinic/staff-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OtpType =
  | "magiclink"
  | "email"
  | "recovery"
  | "signup"
  | "invite"
  | "email_change";

/**
 * GET /auth/callback
 *
 * Magic-link landing route. Built on @supabase/ssr's createServerClient
 * (NOT the browser client) so the PKCE code_verifier cookie set by the
 * browser when the magic link was requested is reachable.
 *
 * Two query-string flows are handled:
 *   - code present       -> exchangeCodeForSession(code)
 *   - token_hash present -> verifyOtp({ token_hash, type })
 *
 * Outcomes:
 *   - On success            -> 302 to /dashboard with sov_auth cookie set
 *   - On any failure        -> 302 to /onboard?error=auth_failed
 *
 * The route NEVER returns a 5xx to the browser. Any unexpected exception
 * (decrypt failure, encryption-key misconfiguration, etc.) is logged and
 * funnelled into the auth_failed redirect path.
 */
export async function GET(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const origin = getPublicOrigin(req);

  const code = req.nextUrl.searchParams.get("code");
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const rawType = req.nextUrl.searchParams.get("type") || "magiclink";

  const fail = async (reason: string) => {
    try {
      await logAudit({
        sessionId,
        action: "auth.session.invalid",
        dataType: "auth",
        success: false,
        metadata: { reason_code: reason },
      });
    } catch {
      // never throw out of failure path
    }
    return NextResponse.redirect(`${origin}/onboard?error=auth_failed`);
  };

  try {
    if (!code && !tokenHash) {
      return fail("missing_token");
    }

    const supaUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
    const supaAnon =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      "";
    if (!supaUrl || !supaAnon) {
      return fail("missing_supabase_env");
    }

    const cookieStore = cookies();
    const supabase = createServerClient(supaUrl, supaAnon, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        // Writes are intentionally swallowed: we don't persist Supabase's
        // own session cookies. All identity state is carried by sov_auth,
        // set on the redirect response below.
        set() {},
        remove() {},
      },
    });

    let userId: string | null = null;
    let email: string | null = null;
    let userMetadata: Record<string, unknown> | null = null;
    let appMetadata: Record<string, unknown> | null = null;
    let lastError = "unknown";

    if (tokenHash) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: normalizeOtpType(rawType),
      });
      if (error) {
        lastError = sanitizeErrorCode(error.message || error.name);
      } else if (data?.user) {
        userId = data.user.id;
        email = data.user.email ?? null;
        userMetadata = asRecord(data.user.user_metadata);
        appMetadata = asRecord(data.user.app_metadata);
      }
    }

    if (!userId && code) {
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        lastError = sanitizeErrorCode(error.message || error.name);
      } else if (data?.user) {
        userId = data.user.id;
        email = data.user.email ?? null;
        userMetadata = asRecord(data.user.user_metadata);
        appMetadata = asRecord(data.user.app_metadata);
      }
    }

    if (!userId) {
      return fail(lastError);
    }

    if (!email) {
      try {
        const sb = getServiceClient();
        const { data } = await sb.auth.admin.getUserById(userId);
        email = data?.user?.email ?? null;
        if (!userMetadata) userMetadata = asRecord(data?.user?.user_metadata);
        if (!appMetadata) appMetadata = asRecord(data?.user?.app_metadata);
      } catch {
        // proceed without email
      }
    }

    const staffGate = await staffSignInResponse({
      origin,
      sessionId,
      userId,
      email,
      userMetadata,
      appMetadata,
    });
    if (staffGate.kind === "response") return staffGate.response;
    if (staffGate.kind === "failed") return fail("staff_session_not_configured");

    let patientId = userId;
    if (email) {
      try {
        const r = await upsertPatientByEmail(email);
        patientId = r.patientId;
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "[auth/callback] patient upsert failed:",
          sanitizeErrorCode((err as Error)?.message),
        );
      }
    }

    let cookie;
    try {
      cookie = writeAuthCookie(
        patientId,
        email || `${userId}@unknown.local`,
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "[auth/callback] writeAuthCookie failed:",
        sanitizeErrorCode((err as Error)?.message),
      );
      return fail("cookie_write_failed");
    }

    try {
      await logAudit({
        sessionId,
        action: "auth.magic_link.consumed",
        dataType: "auth",
        success: true,
      });
    } catch {
      // audit failure must not block sign-in completion
    }

    const response = NextResponse.redirect(`${origin}/dashboard`);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    response.cookies.set(STAFF_COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      "[auth/callback] unhandled exception:",
      sanitizeErrorCode((err as Error)?.message),
    );
    return fail("unhandled_exception");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function staffSignInResponse(input: {
  origin: string;
  sessionId: string;
  userId: string;
  email: string | null;
  userMetadata: Record<string, unknown> | null;
  appMetadata: Record<string, unknown> | null;
}): Promise<{ kind: "none" } | { kind: "failed" } | { kind: "response"; response: NextResponse }> {
  if (!input.email) return { kind: "none" };
  try {
    const actor = await bindStaffOnSignIn(new SupabaseClinicStore(), {
      emailHash: hashEmail(input.email),
      authUserId: input.userId,
      userMetadata: input.userMetadata,
      appMetadata: input.appMetadata,
    });
    if (!actor) return { kind: "none" };
    const token = issueStaffToken(actor, process.env.CSRF_SECRET || "", Date.now());
    if (!token) return { kind: "failed" };
    try {
      await logAudit({
        sessionId: input.sessionId,
        action: "auth.magic_link.consumed",
        dataType: "auth",
        success: true,
        metadata: { reason_code: "staff_session" },
      });
    } catch {
      // audit failure must not block sign-in completion
    }
    const cookie = staffAuthCookie(token);
    const response = NextResponse.redirect(`${input.origin}/clinic`);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return { kind: "response", response };
  } catch (err) {
    console.warn(
      "[auth/callback] staff bind failed:",
      sanitizeErrorCode((err as Error)?.message),
    );
    return { kind: "none" };
  }
}

function normalizeOtpType(raw: string): OtpType {
  const allowed: OtpType[] = [
    "magiclink",
    "email",
    "recovery",
    "signup",
    "invite",
    "email_change",
  ];
  return (allowed as string[]).includes(raw) ? (raw as OtpType) : "magiclink";
}

function sanitizeErrorCode(input: string | undefined | null): string {
  if (!input) return "unknown";
  return input
    .toString()
    .replace(/[^a-zA-Z0-9._:\- ]+/g, "_")
    .slice(0, 80);
}
