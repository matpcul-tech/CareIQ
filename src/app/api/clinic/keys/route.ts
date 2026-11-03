import { NextRequest, NextResponse } from "next/server";
import { csrfReject, NO_STORE } from "@/lib/clinic/onboarding/route-helpers";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";
import { handleClinicKeyCreate, handleClinicKeyStatus } from "@/lib/e2e-clinic-server";
import { supabaseClinicKeyStore } from "@/lib/e2e-clinic-store";
import { isClientEncEnabled } from "@/lib/e2e/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actorFor(req: NextRequest) {
  const token = req.cookies.get("sov_clinic")?.value || "";
  return enforceStaffClinic(new SupabaseClinicStore(), readClinicActor(token, process.env.CSRF_SECRET || "", Date.now()));
}

/** GET: clinic key status (sealed blobs for the admin only). */
export async function GET(req: NextRequest) {
  if (!isClientEncEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = await handleClinicKeyStatus(await actorFor(req), supabaseClinicKeyStore());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}

/** POST: save the clinic public key and the sealed private key copies (admin only). */
export async function POST(req: NextRequest) {
  if (!isClientEncEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const bad = csrfReject(req);
  if (bad) return bad;
  const body = await req.json().catch(() => null);
  const r = await handleClinicKeyCreate(await actorFor(req), body, supabaseClinicKeyStore());
  return NextResponse.json(r.body, { status: r.status, headers: NO_STORE });
}
