import { NextRequest, NextResponse } from "next/server";
import { headers, cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getServiceClient } from "@/lib/supabase-server";
import { getPublicOrigin } from "@/lib/origin";
import { upsertPatientByEmail, writeAuthCookie } from "@/lib/session";
import { logAudit } from "@/lib/audit";

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
 * Magic-link landing route. Handles the two query-string flows Supabase
 * may produce on a successful email click:
 *
 *   - PKCE:        ?code=<code>                       -> exchangeCodeForSession
 *   - token_hash:  ?token_hash=<hash>&type=<type>     -> verifyOtp
 *
 * Outcomes:
 *   - On success -> 302 to /dashboard with sov_auth cookie set.
 *   - On any failure (missing params, verify error, exchange error) ->
 *     302 to /onboard?error=auth_failed.
 *
 * The Supabase client is built via @supabase/ssr's createServerClient so
 * that the PKCE code_verifier cookie (set by the browser when the magic
 * link was requested) is reachable. The sov_auth identity cookie is set
 * directly on the redirect response. That is the only cookie our
 * middleware/session layer reads.
 */
export async function GET(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const origin = getPublicOrigin(req);

  const code = req.nextUrl.searchParams.get("code");
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const rawType = req.nextUrl.searchParams.get("type") || "magiclink";

  const fail = async (reason: string) => {
    await logAudit({
      sessionId,
      action: "auth.session.invalid",
      dataType: "auth",
      success: false,
      metadata: { reason_code: reason },
    });
    return NextResponse.redirect(`${origin}/onboard?error=auth_failed`);
  };

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
      // Writes are intentionally swallowed: we don't persist Supabase's own
      // session cookies. All identity state is carried by sov_auth, set on
      // the redirect response below.
      set() {},
      remove() {},
    },
  });

  let userId: string | null = null;
  let email: string | null = null;
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
    }
  }

  if (!userId && code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      lastError = sanitizeErrorCode(error.message || error.name);
    } else if (data?.user) {
      userId = data.user.id;
      email = data.user.email ?? null;
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
    } catch {
      // proceed without email
    }
  }

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

  await logAudit({
    sessionId,
    action: "auth.magic_link.consumed",
    dataType: "auth",
    success: true,
  });

  const response = NextResponse.redirect(`${origin}/dashboard`);
  const cookie = writeAuthCookie(
    patientId,
    email || `${userId}@unknown.local`,
  );
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
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
