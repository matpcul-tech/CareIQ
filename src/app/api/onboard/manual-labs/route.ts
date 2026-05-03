import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { manualLabsSchema, type ManualLabsInput } from "@/lib/validate";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboard/manual-labs
 *
 * Accepts the patient-typed lab values from Step 4 of onboarding.
 * Every field is optional. Values are merged into the existing
 * health_history.data_encrypted JSON under the `manualLabs` key, so
 * chronic conditions / medications / allergies / family history
 * already on file are preserved.
 *
 * Empty / undefined fields are dropped before encryption, so a partial
 * submission only persists the fields the patient actually filled in.
 *
 * Storing inside health_history.data_encrypted means no schema change
 * is required: the AES-256-GCM ciphertext just gets a few more keys.
 */
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

  const parsed = manualLabsSchema.safeParse(body);
  if (!parsed.success) {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: "manual_labs_schema" },
    });
    return NextResponse.json({ error: "invalid lab values" }, { status: 400 });
  }

  // Drop undefined fields so we don't store noise.
  const cleaned: ManualLabsInput = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined && v !== null && Number.isFinite(v as number)) {
      (cleaned as Record<string, number>)[k] = v as number;
    }
  }
  const enteredCount = Object.keys(cleaned).length;

  // No-op if patient submitted an empty form. Still 200 so the client
  // navigation isn't blocked.
  if (enteredCount === 0) {
    await logAudit({
      sessionId,
      action: "patient.history.updated",
      dataType: "health_history",
      success: true,
      metadata: { reason_code: "no_manual_labs", metric_count: 0 },
    });
    return NextResponse.json({ ok: true, saved: 0 });
  }

  const sb = getServiceClient();
  const aad = `history:${session.patientId}`;

  // Read + decrypt existing health_history row, if any.
  const { data: existing, error: selErr } = await sb
    .from("health_history")
    .select("id, data_encrypted")
    .eq("patient_id", session.patientId)
    .maybeSingle();

  if (selErr) {
    await logAudit({
      sessionId,
      action: "patient.history.updated",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: "db_select" },
    });
    return NextResponse.json({ error: "could not read history" }, { status: 500 });
  }

  let merged: Record<string, unknown> = { manualLabs: cleaned };
  if (existing?.data_encrypted) {
    try {
      const prior = decryptJson<Record<string, unknown>>(existing.data_encrypted, aad);
      const priorLabs =
        prior && typeof prior.manualLabs === "object" && prior.manualLabs !== null
          ? (prior.manualLabs as Record<string, number>)
          : {};
      merged = {
        ...prior,
        manualLabs: { ...priorLabs, ...cleaned },
      };
    } catch {
      // If existing ciphertext can't be decrypted (key rotation, corruption),
      // fall back to writing only the new manual labs. The previous row
      // becomes unreadable but we don't lose the patient's new entry.
      merged = { manualLabs: cleaned };
    }
  }

  const encrypted = encryptJson(merged, aad);

  let dbError: { code?: string } | null = null;
  if (existing?.id) {
    const { error } = await sb
      .from("health_history")
      .update({
        data_encrypted: encrypted,
        updated_at: new Date().toISOString(),
      })
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
      action: "patient.history.updated",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: "db_write" },
    });
    return NextResponse.json({ error: "could not save manual labs" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.history.updated",
    dataType: "health_history",
    success: true,
    metadata: { metric_count: enteredCount },
  });
  return NextResponse.json({ ok: true, saved: enteredCount });
}
