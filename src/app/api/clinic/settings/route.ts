import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { getClinicSettings, updateClinicTimeZone } from "@/lib/clinic/time-zone";
import { readClinicActor } from "@/lib/clinic/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

function reply(r: { ok: true; data: unknown } | { ok: false; status: number; error: string }) {
  return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.ok ? 200 : r.status, headers: HEADERS });
}

async function load(req: NextRequest) {
  const store = new SupabaseClinicStore();
  const actor = await enforceStaffClinic(store, readClinicActor(req.cookies.get("sov_clinic")?.value || "", process.env.CSRF_SECRET || "", Date.now()));
  return { store, actor };
}

function down() {
  return NextResponse.json({ error: "clinic store unavailable" }, { status: 503, headers: HEADERS });
}

/** GET: clinic settings for staff. */
export async function GET(req: NextRequest) {
  try {
    const { store, actor } = await load(req);
    return reply(await getClinicSettings(store, actor));
  } catch {
    return down();
  }
}

/** POST { timeZone }: clinic admin only. */
export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (failure) return NextResponse.json({ error: "CSRF token " + failure }, { status: 403, headers: HEADERS });
  const body = (await req.json().catch(() => ({}))) as { timeZone?: unknown };
  try {
    const { store, actor } = await load(req);
    const r = await updateClinicTimeZone(store, actor, body.timeZone);
    await logAudit({ sessionId: req.headers.get("x-session-id") || "", action: "clinic.settings.time_zone", dataType: "none", success: r.ok, metadata: { requester_role: actor?.kind === "staff" ? actor.role : null } });
    return reply(r);
  } catch {
    return down();
  }
}
