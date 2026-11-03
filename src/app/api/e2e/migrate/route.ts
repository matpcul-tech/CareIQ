import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { handleMigrate } from "@/lib/e2e-migrate-server";
import { migrationAudit, supabaseMigrateStore } from "@/lib/e2e-migrate-store";
import { isClientEncEnabled } from "@/lib/e2e/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST only, so the middleware CSRF check runs before any legacy row is opened. */
export async function POST(req: NextRequest) {
  if (!isClientEncEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => null);
  const s = readSession();
  const r = await handleMigrate(s.patientId, body, supabaseMigrateStore(), migrationAudit(s.sessionId));
  return NextResponse.json(r.body, { status: r.status, headers: { "cache-control": "private, no-store" } });
}
