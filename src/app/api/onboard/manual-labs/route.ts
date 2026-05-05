import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { manualLabsSchema, type ManualLabsInput, type BiomarkerEntryInput } from "@/lib/validate";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { BIOMARKER_KEYS } from "@/lib/biomarker-ranges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/onboard/manual-labs
 *
 * Accepts patient-typed lab values from Step 4 of onboarding. Two shapes
 * are honored, and either or both may appear in the same request:
 *
 *   1. Legacy flat shape  (camelCase keys directly on the body):
 *        { a1c, ldl, hdl, fastingGlucose, bpSystolic, bpDiastolic,
 *          triglycerides, egfr }
 *      Persisted under `manualLabs` in the encrypted health_history blob.
 *
 *   2. New structured shape (full longevity panel):
 *        { biomarkers: { fasting_glucose: { value, date_collected, source },
 *                        a1c: { ... }, ... } }
 *      Persisted under `biomarkers` in the encrypted blob, keyed by spec.
 *
 * The Shield decrypt endpoint reads both shapes (biomarkers preferred,
 * manualLabs as fallback) so existing records keep working.
 *
 * After persisting, the route mirrors the canonical 8 fields into
 * public.patient_vitals_shared so family-side reads (RLS-scoped) keep
 * working without requiring decryption.
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

  // Split parsed body into legacy flat fields vs structured biomarkers.
  const { biomarkers: rawBiomarkers, ...legacy } = parsed.data;

  // Legacy: drop empty / non-finite values.
  const cleanedLegacy: Record<string, number> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (v !== undefined && v !== null && Number.isFinite(v as number)) {
      cleanedLegacy[k] = v as number;
    }
  }

  // Biomarkers: accept only keys we know about, drop entries with no value.
  const knownKeys = new Set<string>(BIOMARKER_KEYS);
  const cleanedBiomarkers: Record<string, BiomarkerEntryInput> = {};
  if (rawBiomarkers) {
    for (const [k, entry] of Object.entries(rawBiomarkers)) {
      if (!knownKeys.has(k)) continue;
      if (!entry || typeof entry.value !== "number" || !Number.isFinite(entry.value)) continue;
      const norm: BiomarkerEntryInput = { value: entry.value };
      if (entry.date_collected) norm.date_collected = entry.date_collected;
      if (entry.source) norm.source = entry.source;
      cleanedBiomarkers[k] = norm;
    }
  }

  const enteredCount = Object.keys(cleanedLegacy).length + Object.keys(cleanedBiomarkers).length;
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

  // Build the merged blob. We preserve every key on the existing decrypted
  // record (chronicConditions, medications, etc.) and merge new lab values
  // on top of `manualLabs` and `biomarkers`.
  let merged: Record<string, unknown> = {};
  if (existing?.data_encrypted) {
    try {
      merged = decryptJson<Record<string, unknown>>(existing.data_encrypted, aad);
    } catch {
      merged = {};
    }
  }
  const priorLegacy =
    typeof merged.manualLabs === "object" && merged.manualLabs !== null
      ? (merged.manualLabs as Record<string, number>)
      : {};
  const priorBiomarkers =
    typeof merged.biomarkers === "object" && merged.biomarkers !== null
      ? (merged.biomarkers as Record<string, BiomarkerEntryInput>)
      : {};

  if (Object.keys(cleanedLegacy).length > 0) {
    merged.manualLabs = { ...priorLegacy, ...cleanedLegacy };
  } else if (Object.keys(priorLegacy).length > 0) {
    merged.manualLabs = priorLegacy;
  }
  if (Object.keys(cleanedBiomarkers).length > 0) {
    merged.biomarkers = { ...priorBiomarkers, ...cleanedBiomarkers };
  } else if (Object.keys(priorBiomarkers).length > 0) {
    merged.biomarkers = priorBiomarkers;
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

  // Mirror to patient_vitals_shared. Prefer the new structured biomarker
  // value over the legacy flat value when both exist, so the family mirror
  // tracks whichever the patient updated most recently.
  const numOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const mergedLabs =
    typeof merged.manualLabs === "object" && merged.manualLabs !== null
      ? (merged.manualLabs as Record<string, number>)
      : {};
  const mergedBio =
    typeof merged.biomarkers === "object" && merged.biomarkers !== null
      ? (merged.biomarkers as Record<string, BiomarkerEntryInput>)
      : {};

  const fromBio = (key: string): number | null => {
    const e = mergedBio[key];
    if (!e || typeof e.value !== "number" || !Number.isFinite(e.value)) return null;
    return e.value;
  };

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

  const sharedRow = {
    patient_id: session.patientId,
    a1c: fromBio("a1c") ?? numOrNull(mergedLabs.a1c),
    ldl: fromBio("ldl") ?? numOrNull(mergedLabs.ldl),
    hdl: fromBio("hdl") ?? numOrNull(mergedLabs.hdl),
    fasting_glucose: fromBio("fasting_glucose") ?? numOrNull(mergedLabs.fastingGlucose),
    bp_systolic: numOrNull(mergedLabs.bpSystolic),
    bp_diastolic: numOrNull(mergedLabs.bpDiastolic),
    triglycerides: fromBio("triglycerides") ?? numOrNull(mergedLabs.triglycerides),
    egfr: fromBio("egfr") ?? numOrNull(mergedLabs.egfr),
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
    // eslint-disable-next-line no-console
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

  // Tell the consumer ManualLabsInput stays referenced even if a future
  // refactor narrows the schema; suppresses unused-import linter noise.
  type _ManualLabsRef = ManualLabsInput;
  void (null as unknown as _ManualLabsRef);

  return NextResponse.json({
    ok: true,
    saved: enteredCount,
    family_mirror_synced: !mirrorErr,
  });
}
