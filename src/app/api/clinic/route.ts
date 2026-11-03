import { NextRequest, NextResponse } from "next/server";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import { handleClinicHttp } from "@/lib/clinic/http";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { deliverStaffInvite, sendStaffLinkEmail } from "@/lib/clinic/staff-mail";
import { smsEnvFromProcess } from "@/lib/clinic/sms";
import { toPublicClinicPayload } from "@/lib/clinic/public-payload";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";
import { auditAlerts } from "@/lib/clinic/alerts/audit-adapter";
import { SupabaseAlertQueueStore } from "@/lib/clinic/alerts/supabase-queue-store";
import { SupabaseCircleAlertSink } from "@/lib/circle-alerts/supabase-sink";
import type { Actor } from "@/lib/clinic/logic";
import { hashEmail } from "@/lib/crypto";
import { getPublicOrigin } from "@/lib/origin";
import { readSession } from "@/lib/session";
import { getServiceClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    actor = await enforceStaffClinic(store, actor);
    const origin = getPublicOrigin(req);
    const response = await handleClinicHttp(req, {
      store,
      actor,
      smsEnv: smsEnvFromProcess(),
      asOf: new Date().toISOString().slice(0, 10),
      hashStaffEmail: (email) => hashEmail(email),
      alertQueue: new SupabaseAlertQueueStore(),
      circleAlerts: new SupabaseCircleAlertSink(),
      alertAudit: auditAlerts(req.headers.get("x-session-id") || ""),
      sendStaffInvite: async (email) => {
        const redirectTo = `${origin}/auth/callback`;
        const admin = getServiceClient().auth.admin;
        const sendLink = process.env.RESEND_API_KEY
          ? (link: string) => sendStaffLinkEmail(email, link)
          : undefined;
        return deliverStaffInvite(admin, email, redirectTo, sendLink);
      },
    });
    const payload = toPublicClinicPayload(await response.json() as Record<string, unknown>);
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
  return respond(req);
}
