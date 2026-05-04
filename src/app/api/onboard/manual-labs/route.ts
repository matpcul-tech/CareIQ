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
 * After encrypting + persisting, this also upserts the same numeric
 * values + a few shareable health-history fields into the
 * public.patient_vitals_shared table so the patient's family circle
 * (linked via care_circle) can read them via Supabase REST + RLS.
 * The shared row is the source of truth for the CareCircle dashboard
 * tabs that need real BP/A1C/LDL/HR/etc. numbers.
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

  // Mirror the merged labs + shareable history fields into the
  // family-readable patient_vitals_shared table. Best-effort: if the
  // mirror upsert fails, the patient's encrypted record is still
  // saved and the request is reported as successful. Family will see
  // stale or missing vitals until the next save retries.
  type SharedRow = {
    patient_id: string;
    a1c: number | null;
    ldl: number | null;
    hdl: number | null;
    fasting_glucose: number | null;
    bp_systolic: number | null;
    bp_diastolic: number | null;
    triglycerides: number | null;
    egfr: number | null;
    chronic_conditions: string[] | null;
    medications: string | null;
    allergies: string | null;
    updated_at: string;
  };

  const mergedLabs =
    typeof merged.manualLabs === "object" && merged.manualLabs !== null
      ? (merged.manualLabs as Record<string, number>)
      : {};

  const conditions =
    Array.isArray((merged as Record<string, unknown>).chronicConditions)
      ? ((merged as Record<string, unknown>).chronicConditions as string[])
      : null;
  const meds =
    typeof (merged as Record<string, unknown>).medications === "string"
      ? ((merged as Record<string, unknown>).medications as string)
      : null;
  const allergies =
    typeof (merged as Record<string, unknown>).allergies === "string"
      ? ((merged as Record<string, unknown>).allergies as string)
      : null;

  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const sharedRow: SharedRow = {
    patient_id: session.patientId,
    a1c: numOrNull(mergedLabs.a1c),
    ldl: numOrNull(mergedLabs.ldl),
    hdl: numOrNull(mergedLabs.hdl),
    fasting_glucose: numOrNull(mergedLabs.fastingGlucose),
    bp_systolic: numOrNull(mergedLabs.bpSystolic),
    bp_diastolic: numOrNull(mergedLabs.bpDiastolic),
    triglycerides: numOrNull(mergedLabs.triglycerides),
    egfr: numOrNull(mergedLabs.egfr),
    chronic_conditions: conditions,
    medications: meds,
    allergies,
    updated_at: new Date().toISOString(),
  };

  const { error: mirrorErr } = await sb
    .from("patient_vitals_shared")
    .upsert(sharedRow, { onConflict: "patient_id" });

  if (mirrorErr) {
    await logAudit({
      sessionId,
      action: "patient.history.updated",
      dataType: "health_history",
      success: true,
      metadata: { reason_code: "mirror_failed", metric_count: enteredCount },
    });
    // Eslint-disable-next-line no-console
    console.error("[manual-labs] mirror upsert failed:", mirrorErr.code || mirrorErr.message);
  } else {
    await logAudit({
      sessionId,
      action: "patient.history.updated",
      dataType: "health_history",
      success: true,
      metadata: { metric_count: enteredCount },
    });
  }

  return NextResponse.json({
    ok: true,
    saved: enteredCount,
    family_mirror_synced: !mirrorErr,
  });
}
