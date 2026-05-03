import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { healthHistorySchema } from "@/lib/validate";
import { encryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const parsed = healthHistorySchema.safeParse(body);
  if (!parsed.success) {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: "schema" },
    });
    return NextResponse.json({ error: "invalid health history" }, { status: 400 });
  }

  const history = parsed.data;
  const encrypted = encryptJson(history, `history:${session.patientId}`);

  const sb = getServiceClient();
  // Upsert one row per patient (idempotent)
  const { data: existing } = await sb
    .from("health_history")
    .select("id")
    .eq("patient_id", session.patientId)
    .maybeSingle();

  let dbError = null as null | { code?: string };
  if (existing?.id) {
    const { error } = await sb
      .from("health_history")
      .update({ data_encrypted: encrypted, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    dbError = error ?? null;
  } else {
    const { error } = await sb.from("health_history").insert({
      patient_id: session.patientId,
      data_encrypted: encrypted,
    });
    dbError = error ?? null;
  }

  if (dbError) {
    await logAudit({
      sessionId,
      action: "patient.history.created",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: "db_write" },
    });
    return NextResponse.json({ error: "could not save history" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.history.created",
    dataType: "health_history",
    success: true,
  });
  return NextResponse.json({ ok: true });
}
