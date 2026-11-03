import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { handleEntry, handleListEntries } from "@/lib/e2e-server";
import { supabaseE2eStore } from "@/lib/e2e-store";
import { isClientEncEnabled } from "@/lib/e2e/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(req: NextRequest) {
  if (!isClientEncEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const r = await handleEntry(readSession().patientId, body, supabaseE2eStore());
  return NextResponse.json(r.body, { status: r.status });
}

export async function GET() {
  if (!isClientEncEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const r = await handleListEntries(readSession().patientId, supabaseE2eStore());
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "private, no-store" } });
}
