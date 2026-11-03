import { NextRequest, NextResponse } from "next/server";
import { clinicCsrfFailure } from "@/lib/clinic/csrf";
import type { Actor } from "@/lib/clinic/logic";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";
import { clinicTimeZone, localDateHour } from "@/lib/clinic/time-zone";
import { importUdsPanel, parsePeriod, viewUdsPanel } from "@/lib/clinic/uds/actions";
import { SupabaseUdsPanelStore } from "@/lib/clinic/uds/supabase-panel-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };

function staffActor(req: NextRequest): Actor | null {
  // Staff session only. A patient session is never read here, so patients get 401.
  const secret = process.env.CSRF_SECRET || "";
  const header = req.headers.get("x-care-circle-token") || "";
  const cookie = req.cookies.get("sov_clinic")?.value || "";
  return readClinicActor(header || cookie, secret, Date.now());
}

async function withStores(req: NextRequest, run: (actor: Actor, store: SupabaseClinicStore) => Promise<NextResponse>) {
  try {
    const store = new SupabaseClinicStore();
    const actor = await enforceStaffClinic(store, staffActor(req));
    if (!actor) return NextResponse.json({ error: "authentication required" }, { status: 401, headers: HEADERS });
    return await run(actor, store);
  } catch (err) {
    const missing = /not configured/i.test((err as Error)?.message || "");
    return NextResponse.json(
      { error: missing ? "clinic store is not configured" : "clinic store unavailable" },
      { status: 503, headers: HEADERS },
    );
  }
}

export async function GET(req: NextRequest) {
  return withStores(req, async (actor, store) => {
    const url = new URL(req.url);
    const asOf = localDateHour(clinicTimeZone(actor.kind === "staff" ? await store.getClinic(actor.clinicId).catch(() => null) : null)).today;
    const period = parsePeriod(url.searchParams.get("start"), url.searchParams.get("end"), asOf);
    if (!period) return NextResponse.json({ error: "period must be start and end dates" }, { status: 400, headers: HEADERS });
    const result = await viewUdsPanel(store, new SupabaseUdsPanelStore(), actor, period);
    return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status, headers: HEADERS });
  });
}

export async function POST(req: NextRequest) {
  const failure = clinicCsrfFailure(req.headers.get("x-csrf-token") || "", req.cookies.get("sov_csrf")?.value || "");
  if (failure) return NextResponse.json({ error: "CSRF token " + failure }, { status: 403, headers: HEADERS });
  return withStores(req, async (actor, store) => {
    const raw = await req.text();
    if (raw.length > 8_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413, headers: HEADERS });
    let body: { patients?: unknown } = {};
    try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid json" }, { status: 400, headers: HEADERS }); }
    const result = await importUdsPanel(store, new SupabaseUdsPanelStore(), actor, body.patients);
    return NextResponse.json(result.ok ? result.data : { error: result.error }, { status: result.ok ? 200 : result.status, headers: HEADERS });
  });
}
