import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { emailSchema } from "@/lib/validate";
import { getPublicOrigin } from "@/lib/origin";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CookieOp =
  | { type: "set"; name: string; value: string; options: CookieOptions }
  | { type: "remove"; name: string; options: CookieOptions };

/**
 * POST /api/auth/magic-link
 *
 * Sends a passwordless sign-in email via Supabase. Built on @supabase/ssr's
 * createServerClient so the PKCE code_verifier cookie generated during this
 * request is written to the user's browser; /auth/callback then reads it
 * back to complete exchangeCodeForSession.
 *
 * Required env vars (Vercel -> Project Settings -> Environment Variables):
 *   NEXT_PUBLIC_SUPABASE_URL       e.g. https://abcd1234.supabase.co
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  the project's anon public key
 *
 * Server-only fallbacks (used only if the NEXT_PUBLIC_* form is unset):
 *   SUPABASE_URL, SUPABASE_ANON_KEY
 *
 * The URL MUST be the verbatim project URL from Supabase Dashboard -> API ->
 * Project URL. It must start with https:// and have no trailing slash.
 *
 * Diagnostics: every request logs a single [magic-link] config line that
 * includes the first 20 chars of NEXT_PUBLIC_SUPABASE_URL (and of the
 * resolved URL actually being used) plus the full emailRedirectTo URL,
 * so the operator can verify in Vercel logs that:
 *   1. The URL points to <ref>.supabase.co, NOT the app domain
 *   2. The redirect is the app's /auth/callback route, not /_not_found
 */
export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: "auth",
      success: false,
      metadata: { reason_code: "json_parse" },
    });
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const parsed = emailSchema.safeParse(body);
  if (!parsed.success) {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: "auth",
      success: false,
      metadata: { reason_code: "email_invalid" },
    });
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  const { email } = parsed.data;
  const origin = getPublicOrigin(req);
  const emailRedirectTo = `${origin}/auth/callback`;

  // ----- Env diagnostics ----------------------------------------------------
  const rawPublicUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const rawServerUrl = (process.env.SUPABASE_URL || "").trim();
  const supaUrl = resolveSupabaseUrl();
  const supaAnon = resolveSupabaseAnonKey();
  const urlValid = isValidSupabaseUrl(supaUrl);
  const looksLikeSupabaseHost = /\.supabase\.(co|in|net)$/i.test(
    safeHostname(supaUrl),
  );

  // Single line, easy to grep in Vercel: shows exactly what env values are
  // being read AND the redirect URL the email will land on. Keys are never
  // logged; only the URL prefix is, so we can see the project-ref subdomain
  // without exposing anything sensitive.
  // eslint-disable-next-line no-console
  console.log(
    "[magic-link] config",
    JSON.stringify({
      origin,
      emailRedirectTo, // full URL, must end in /auth/callback on app host
      urlSource: urlSourceName(),
      anonSource: anonSourceName(),
      urlValid,
      looksLikeSupabaseHost,
      // First 20 chars of each candidate, so operators can confirm the env
      // var actually points at <ref>.supabase.co and not the app domain.
      next_public_supabase_url_prefix: rawPublicUrl.slice(0, 20),
      supabase_url_prefix: rawServerUrl.slice(0, 20),
      resolved_url_prefix: supaUrl.slice(0, 20),
      resolved_url_host: safeHostname(supaUrl),
      anon_key_present: Boolean(supaAnon),
      anon_key_length: supaAnon.length,
    }),
  );

  if (!supaUrl || !supaAnon || !urlValid) {
    const reason = !supaUrl
      ? "missing_supabase_url"
      : !supaAnon
      ? "missing_supabase_anon_key"
      : "invalid_supabase_url";
    // eslint-disable-next-line no-console
    console.error("[magic-link] config error:", reason);
    await logAudit({
      sessionId,
      action: "auth.magic_link.requested",
      dataType: "auth",
      success: false,
      metadata: { reason_code: reason },
    });
    return finalize(NextResponse.json({ ok: true }), []);
  }

  if (!looksLikeSupabaseHost) {
    // Refuse to call signInWithOtp against a non-Supabase host. This is the
    // configuration that produced the /_not_found symptom: the SDK was built
    // against the app domain, sent POST /auth/v1/otp to the app, hit Next's
    // 404 handler, and the user got "invalid or expired" downstream.
    // eslint-disable-next-line no-console
    console.error(
      "[magic-link] refusing: SUPABASE_URL host is not a Supabase host:",
      safeHostname(supaUrl),
    );
    await logAudit({
      sessionId,
      action: "auth.magic_link.requested",
      dataType: "auth",
      success: false,
      metadata: { reason_code: "non_supabase_host" },
    });
    return finalize(NextResponse.json({ ok: true }), []);
  }

  // ----- Send the magic link ------------------------------------------------
  const pending: CookieOp[] = [];
  const supabase = createServerClient(supaUrl, supaAnon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        pending.push({ type: "set", name, value, options });
      },
      remove(name: string, options: CookieOptions) {
        pending.push({ type: "remove", name, options });
      },
    },
  });

  // eslint-disable-next-line no-console
  console.log(
    "[magic-link] signInWithOtp",
    JSON.stringify({
      to_host: safeHostname(supaUrl),
      emailRedirectTo,
      shouldCreateUser: true,
    }),
  );

  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo,
        shouldCreateUser: true,
      },
    });
    if (error) {
      const reason = sanitizeErrorCode(error.message || error.name);
      // eslint-disable-next-line no-console
      console.warn("[magic-link] supabase error:", reason);
      await logAudit({
        sessionId,
        action: "auth.magic_link.requested",
        dataType: "auth",
        success: false,
        metadata: { reason_code: reason },
      });
      return finalize(NextResponse.json({ ok: true }), pending);
    }
  } catch (err) {
    const reason = sanitizeErrorCode((err as Error)?.message);
    // eslint-disable-next-line no-console
    console.error("[magic-link] exception:", reason);
    await logAudit({
      sessionId,
      action: "auth.magic_link.requested",
      dataType: "auth",
      success: false,
      metadata: { reason_code: "exception:" + reason },
    });
    return finalize(NextResponse.json({ ok: true }), pending);
  }

  // eslint-disable-next-line no-console
  console.log(
    "[magic-link] sent ok",
    JSON.stringify({ to_host: safeHostname(supaUrl), emailRedirectTo }),
  );
  await logAudit({
    sessionId,
    action: "auth.magic_link.requested",
    dataType: "auth",
    success: true,
  });
  return finalize(NextResponse.json({ ok: true }), pending);
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function finalize(response: NextResponse, ops: CookieOp[]): NextResponse {
  for (const op of ops) {
    if (op.type === "set") {
      response.cookies.set({ name: op.name, value: op.value, ...op.options });
    } else {
      response.cookies.set({
        name: op.name,
        value: "",
        ...op.options,
        maxAge: 0,
      });
    }
  }
  return response;
}

function resolveSupabaseUrl(): string {
  const raw =
    (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim() ||
    (process.env.SUPABASE_URL || "").trim();
  return raw.replace(/\/+$/, "");
}

function resolveSupabaseAnonKey(): string {
  return (
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim() ||
    (process.env.SUPABASE_ANON_KEY || "").trim()
  );
}

function urlSourceName(): string {
  if ((process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim()) {
    return "NEXT_PUBLIC_SUPABASE_URL";
  }
  if ((process.env.SUPABASE_URL || "").trim()) return "SUPABASE_URL";
  return "none";
}

function anonSourceName(): string {
  if ((process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim()) {
    return "NEXT_PUBLIC_SUPABASE_ANON_KEY";
  }
  if ((process.env.SUPABASE_ANON_KEY || "").trim()) return "SUPABASE_ANON_KEY";
  return "none";
}

function isValidSupabaseUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    if (!parsed.hostname) return false;
    return true;
  } catch {
    return false;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function sanitizeErrorCode(input: string | undefined | null): string {
  if (!input) return "unknown";
  return input
    .toString()
    .replace(/[^a-zA-Z0-9._:\- ]+/g, "_")
    .slice(0, 80);
}
