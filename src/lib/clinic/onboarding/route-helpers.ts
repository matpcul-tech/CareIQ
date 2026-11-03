import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { clinicCsrfFailure } from "../csrf";
import { SupabaseClinicStore } from "../supabase-store";
import { hashEmail } from "@/lib/crypto";
import { auditOnboarding } from "./audit-adapter";
import type { OnboardingDeps } from "./logic";
import { SupabaseOnboardingStore } from "./supabase-store";

export const NO_STORE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };

export function onboardingDeps(req: NextRequest): OnboardingDeps {
  return {
    clinicStore: new SupabaseClinicStore(),
    store: new SupabaseOnboardingStore(),
    audit: auditOnboarding(req.headers.get("x-session-id") || ""),
    hashEmail: (e) => hashEmail(e),
    now: () => new Date(),
  };
}

export function csrfReject(req: NextRequest): NextResponse | null {
  const f = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (f === "missing") return NextResponse.json({ error: "CSRF token missing" }, { status: 403 });
  if (f === "mismatch") return NextResponse.json({ error: "CSRF token mismatch" }, { status: 403 });
  return null;
}

export function reply(r: { ok: true; data: unknown } | { ok: false; status: number; error: string }) {
  return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.ok ? 200 : r.status, headers: NO_STORE });
}

export function storeDown(err: unknown) {
  const missing = /not configured/i.test((err as Error)?.message || "");
  return NextResponse.json({ error: missing ? "clinic store is not configured" : "clinic store unavailable" }, { status: 503, headers: NO_STORE });
}
