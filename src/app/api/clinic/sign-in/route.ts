import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import { staffMayReceiveSignInLink } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { hashEmail } from "@/lib/crypto";
import { getPublicOrigin } from "@/lib/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CookieOp =
  | { type: "set"; name: string; value: string; options: CookieOptions }
  | { type: "remove"; name: string; options: CookieOptions };

/**
 * POST /api/clinic/sign-in
 *
 * Sends a magic link only when the email matches an active clinic_staff row.
 * The response is the same when the email is unknown, so this route does
 * not reveal who is on the staff list. It does not create an auth user and
 * it does not grant a staff role.
 */
export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(
    req.headers.get("x-csrf-token") || "",
    req.cookies.get("sov_csrf")?.value || "",
  );
  if (failure === "missing") {
    return NextResponse.json({ error: "CSRF token missing" }, { status: 403 });
  }
  if (failure === "mismatch") {
    return NextResponse.json({ error: "CSRF token mismatch" }, { status: 403 });
  }

  let email = "";
  try {
    const body = await req.json() as { email?: unknown };
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return NextResponse.json({ error: "invalid email" }, { status: 400 });
  }

  let shouldSend = false;
  try {
    const staff = await new SupabaseClinicStore().findStaffByEmailHash(hashEmail(email));
    shouldSend = staffMayReceiveSignInLink(staff);
  } catch (err) {
    const message = (err as Error)?.message || "";
    const missing = /not configured/i.test(message);
    return NextResponse.json(
      { error: missing ? "clinic store is not configured" : "clinic store unavailable" },
      { status: 503 },
    );
  }

  if (!shouldSend) return NextResponse.json({ ok: true });

  const supaUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const supaAnon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!supaUrl || !supaAnon) return NextResponse.json({ ok: true });

  const origin = getPublicOrigin(req);
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

  try {
    await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${origin}/auth/callback`,
        shouldCreateUser: false,
      },
    });
  } catch {
    // Same response as a known staff email so the client cannot tell
    // a mail failure apart from an unknown address.
  }

  const response = NextResponse.json({ ok: true });
  for (const op of pending) {
    if (op.type === "set") {
      response.cookies.set({ name: op.name, value: op.value, ...op.options });
    } else {
      response.cookies.set({ name: op.name, value: "", ...op.options, maxAge: 0 });
    }
  }
  return response;
}
