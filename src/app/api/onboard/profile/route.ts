import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { profileSchema } from "@/lib/validate";
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
    await logAudit({
      sessionId,
      action: "auth.session.invalid",
      dataType: "session",
      success: false,
    });
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: "profile",
      success: false,
      metadata: { reason_code: "schema" },
    });
    return NextResponse.json({ error: "invalid profile" }, { status: 400 });
  }

  const profile = parsed.data;
  const encrypted = encryptJson(profile, `profile:${session.patientId}`);

  const sb = getServiceClient();
  const { error } = await sb
    .from("patients")
    .update({ profile_encrypted: encrypted })
    .eq("id", session.patientId);

  if (error) {
    await logAudit({
      sessionId,
      action: "patient.profile.created",
      dataType: "profile",
      success: false,
      metadata: { reason_code: "db_write" },
    });
    return NextResponse.json({ error: "could not save profile" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.profile.created",
    dataType: "profile",
    success: true,
  });
  return NextResponse.json({ ok: true });
}
