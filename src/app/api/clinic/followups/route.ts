import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import { logFollowUpCall, viewFollowUps, type FollowUpDeps } from "@/lib/clinic/followups/logic";
import { loadFollowUpSignals } from "@/lib/clinic/followups/signals";
import { SupabaseFollowUpCallStore } from "@/lib/clinic/followups/supabase-store";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { clinicTimeZone, localDateHour } from "@/lib/clinic/time-zone";
import { readClinicActor } from "@/lib/clinic/token";
import type { Actor } from "@/lib/clinic/logic";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

/** Today's date in the clinic's own time zone (falls back to America/Chicago). */
async function today(clinicStore: SupabaseClinicStore, actor: Actor): Promise<string> {
  const clinic = actor.kind === "staff" ? await clinicStore.getClinic(actor.clinicId) : null;
  return localDateHour(clinicTimeZone(clinic)).today;
}

async function setup(req: NextRequest) {
  const clinicStore = new SupabaseClinicStore();
  const actor = await enforceStaffClinic(clinicStore, readClinicActor(req.cookies.get("sov_clinic")?.value || "", process.env.CSRF_SECRET || "", Date.now()));
  const sessionId = req.headers.get("x-session-id") || "";
  const deps: FollowUpDeps = {
    clinicStore,
    calls: new SupabaseFollowUpCallStore(),
    // Counts, role, and outcome only. No patient id, name, or note text.
    audit: async (e) => logAudit({ sessionId, action: e.action, dataType: "clinic_followup", success: true, metadata: { metric_count: e.count, requester_role: e.actorRole, outcome: e.outcome ?? null } }),
    signals: loadFollowUpSignals,
    now: () => new Date(),
  };
  return { actor, deps, clinicStore };
}

function reply(r: { ok: true; data: unknown } | { ok: false; status: number; error: string }) {
  return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.ok ? 200 : r.status, headers: HEADERS });
}

function down(err: unknown) {
  const missing = /not configured/i.test((err as Error)?.message || "");
  return NextResponse.json({ error: missing ? "clinic store is not configured" : "follow-up list unavailable" }, { status: 503, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const { actor, deps, clinicStore } = await setup(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    return reply(await viewFollowUps(deps, actor, await today(clinicStore, actor)));
  } catch (err) {
    return down(err);
  }
}

/** POST { patientId, outcome, note }: log a follow-up call. */
export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (failure) return NextResponse.json({ error: "CSRF token " + failure }, { status: 403, headers: HEADERS });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const { actor, deps, clinicStore } = await setup(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    return reply(await logFollowUpCall(deps, actor, { patientId: body.patientId, outcome: body.outcome, note: body.note }, await today(clinicStore, actor)));
  } catch (err) {
    return down(err);
  }
}
