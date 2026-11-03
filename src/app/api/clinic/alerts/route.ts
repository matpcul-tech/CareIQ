import { NextRequest, NextResponse } from "next/server";
import { auditAlerts } from "@/lib/clinic/alerts/audit-adapter";
import { listAlertQueue, updateAlertStatus } from "@/lib/clinic/alerts/queue";
import { SupabaseAlertQueueStore } from "@/lib/clinic/alerts/supabase-queue-store";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import type { Actor } from "@/lib/clinic/logic";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

async function names(actor: Actor): Promise<Record<string, string>> {
  if (actor.kind !== "staff") return {};
  const rows = await new SupabaseClinicStore().listStaff(actor.clinicId);
  return Object.fromEntries(rows.map((r) => [r.id, r.display_name]));
}

async function staff(req: NextRequest): Promise<Actor | null> {
  // Staff session only. Patient sessions are never read here.
  const token = req.headers.get("x-care-circle-token") || req.cookies.get("sov_clinic")?.value || "";
  const actor = readClinicActor(token, process.env.CSRF_SECRET || "", Date.now());
  return enforceStaffClinic(new SupabaseClinicStore(), actor);
}

function reply(result: { ok: true; data: unknown } | { ok: false; status: number; error: string }) {
  return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status, headers: HEADERS });
}

function unavailable(err: unknown) {
  const missing = /not configured/i.test((err as Error)?.message || "");
  return NextResponse.json({ error: missing ? "clinic store is not configured" : "alert queue unavailable" }, { status: 503, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const actor = await staff(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    const includeResolved = new URL(req.url).searchParams.get("resolved") === "1";
    return reply(await listAlertQueue(new SupabaseAlertQueueStore(), auditAlerts(req.headers.get("x-session-id") || ""), actor, { includeResolved, staffNames: await names(actor) }));
  } catch (err) {
    return unavailable(err);
  }
}

export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (failure) return NextResponse.json({ error: "CSRF token " + failure }, { status: 403, headers: HEADERS });
  try {
    const actor = await staff(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    const body = await req.json().catch(() => ({})) as Record<string, unknown>;
    const action = body.action === "acknowledge" || body.action === "resolve" ? body.action : null;
    if (!action || typeof body.alertId !== "string") return NextResponse.json({ error: "alertId and action are required" }, { status: 400, headers: HEADERS });
    return reply(await updateAlertStatus(new SupabaseAlertQueueStore(), auditAlerts(req.headers.get("x-session-id") || ""), actor, {
      alertId: body.alertId,
      action,
      note: typeof body.note === "string" ? body.note : "",
      nowIso: new Date().toISOString(),
      staffNames: await names(actor),
    }));
  } catch (err) {
    return unavailable(err);
  }
}
