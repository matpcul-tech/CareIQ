import { NextRequest, NextResponse } from "next/server";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import type { Actor } from "@/lib/clinic/logic";
import { dispatchToday, importAppointments, reminderOverview, sendingState, setReminderTemplate, type ReminderDeps } from "@/lib/clinic/reminders/actions";
import { auditReminders } from "@/lib/clinic/reminders/audit-adapter";
import { phoneHash, SupabaseReminderStore } from "@/lib/clinic/reminders/supabase-store";
import { reminderEnv, sendingFlagOn, twilioConfigured, twilioSender } from "@/lib/clinic/reminders/twilio";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";
import { SupabaseUdsPanelStore } from "@/lib/clinic/uds/supabase-panel-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { messageClinicName } from "@/lib/clinic/reminders/engine";
import { clinicTimeZone, localDateHour } from "@/lib/clinic/time-zone";

const HEADERS = { "cache-control": "private, no-store" };
async function context(req: NextRequest) {
  const clinicStore = new SupabaseClinicStore();
  const token = req.headers.get("x-care-circle-token") || req.cookies.get("sov_clinic")?.value || "";
  // Staff session only. Patient sessions are never read here.
  const actor: Actor | null = await enforceStaffClinic(clinicStore, readClinicActor(token, process.env.CSRF_SECRET || "", Date.now()));
  const deps: ReminderDeps = {
    clinicStore,
    panelStore: new SupabaseUdsPanelStore(),
    store: new SupabaseReminderStore(),
    audit: auditReminders(req.headers.get("x-session-id") || ""),
    hashPhone: phoneHash,
  };
  const env = reminderEnv(process.env);
  const sending = sendingState(sendingFlagOn(env), twilioConfigured(env));
  // Clinic display name and time zone from the clinics record (time zone defaults to America/Chicago).
  const clinic = actor && actor.kind === "staff" ? await clinicStore.getClinic(actor.clinicId).catch(() => null) : null;
  const clinicName = messageClinicName(clinic?.name);
  const tz = clinicTimeZone(clinic);
  const localNow = () => localDateHour(tz);
  return { actor, deps, env, sending, clinicName, localNow };
}

function reply(r: { ok: true; data: unknown } | { ok: false; status: number; error: string }) {
  return NextResponse.json(r.ok ? r.data : { error: r.error }, { status: r.ok ? 200 : r.status, headers: HEADERS });
}

function unavailable(err: unknown) {
  const missing = /not configured/i.test((err as Error)?.message || "");
  return NextResponse.json({ error: missing ? "clinic store is not configured" : "appointment store unavailable" }, { status: 503, headers: HEADERS });
}

export async function GET(req: NextRequest) {
  try {
    const { actor, deps, sending, clinicName, localNow } = await context(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    return reply(await reminderOverview(deps, actor, { today: localNow().today, clinicName, sending }));
  } catch (err) {
    return unavailable(err);
  }
}

export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (failure) return NextResponse.json({ error: "CSRF token " + failure }, { status: 403, headers: HEADERS });
  try {
    const raw = await req.text();
    if (raw.length > 8_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413, headers: HEADERS });
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400, headers: HEADERS }); }
    const { actor, deps, env, sending, clinicName, localNow } = await context(req);
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    if (body.action === "import") return reply(await importAppointments(deps, actor, body.appointments, body.mode));
    if (body.action === "template") return reply(await setReminderTemplate(deps, actor, body.language, body.template));
    if (body.action === "dispatch") {
      const now = localNow();
      return reply(await dispatchToday(deps, actor, {
        today: now.today, clinicName, sending, nowIso: new Date().toISOString(), localHour: now.hour,
        send: sending.enabled ? twilioSender(env) : null,
      }));
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400, headers: HEADERS });
  } catch (err) {
    return unavailable(err);
  }
}
