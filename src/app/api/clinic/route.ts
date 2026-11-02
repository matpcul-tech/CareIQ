import { NextRequest, NextResponse } from "next/server";
import { handleClinicHttp } from "@/lib/clinic/http";
import { smsEnvFromProcess } from "@/lib/clinic/sms";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor, signClinicActor } from "@/lib/clinic/token";
import type { Actor, StaffRole } from "@/lib/clinic/logic";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

async function respond(req: NextRequest) {
  const secret = process.env.CSRF_SECRET || "";
  const header = req.headers.get("x-care-circle-token") || "";
  const cookie = req.cookies.get("sov_clinic")?.value || "";
  let actor: Actor | null = readClinicActor(header || cookie, secret, Date.now());
  if (!actor) {
    const session = readSession();
    if (session.patientId) actor = { kind: "patient", patientId: session.patientId };
  }
  try {
    const store = new SupabaseClinicStore();
    if (actor?.kind === "staff") {
      const staff = await store.getStaff(actor.staffId);
      if (!staff || staff.revoked_at || staff.clinic_id !== actor.clinicId) {
        actor = { ...actor, revoked: true };
      }
    }
    const response = await handleClinicHttp(req, {
      store,
      actor,
      smsEnv: smsEnvFromProcess(),
      asOf: new Date().toISOString().slice(0, 10),
    });
    const payload = await response.json() as Record<string, unknown>;
    if (
      payload &&
      typeof payload.staff_id === "string" &&
      typeof payload.clinic_id === "string" &&
      (payload.role === "provider" || payload.role === "ma" || payload.role === "chw")
    ) {
      const token = signClinicActor(
        {
          kind: "staff",
          clinicId: payload.clinic_id,
          staffId: payload.staff_id,
          role: payload.role as StaffRole,
        },
        secret,
        Date.now() + TWELVE_HOURS_MS,
      );
      payload.staff_token = token;
      if (!token) payload.sign_in = "not_configured";
    }
    return NextResponse.json(payload, {
      status: response.status,
      headers: { "cache-control": "private, no-store" },
    });
  } catch (err) {
    const message = (err as Error)?.message || "clinic store unavailable";
    const missing = /not configured/i.test(message);
    return NextResponse.json(
      { error: missing ? "clinic store is not configured" : "clinic store unavailable" },
      { status: 503 },
    );
  }
}

export async function GET(req: NextRequest) {
  return respond(req);
}

export async function POST(req: NextRequest) {
  return respond(req);
}
