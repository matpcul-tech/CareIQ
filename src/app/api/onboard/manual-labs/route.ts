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
 * Accepts patient-typed lab values from Step 4 of onboarding. Two shapes:
 *
 *   1. Legacy flat:  { a1c, ldl, hdl, fastingGlucose, bpSystolic,
 *                      bpDiastolic, triglycerides, egfr } -> manualLabs
 *   2. Structured:   { biomarkers: { fasting_glucose: {value,
 *                      date_collected, source}, ... } } -> biomarkers
 *
 * Phase 3 addition: every biomarker write also lands in biomarker_log
 * (append-only, encrypted-value, server-only) so the Shield decrypt
 * endpoint can compute trend (improving / stable / declining) per
 * biomarker by comparing the latest two entries.
 *
 * BP is vitals, not a biomarker spec, so it stays in manualLabs only and
 * is NOT logged to biomarker_log.
 */

// Map legacy camelCase keys to their canonical biomarker_log key, where
// applicable. bpSystolic / bpDiastolic intentionally not mapped.
const LEGACY_TO_CANONICAL: Record<string, string> = {
  a1c: "a1c",
  ldl: "ldl",
  hdl: "hdl",
  fastingGlucose: "fasting_glucose",
  triglycerides: "triglycerides",
  egfr: "egfr",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

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

  const { biomarkers: rawBiomarkers, ...legacy } = parsed.data;

  const cleanedLegacy: Record<string, number> = {};
  for (const [k, v] of Object.entries(legacy)) {
    if (v !== undefined && v !== null && Number.isFinite(v as number)) {
      cleanedLegacy[k] = v as number;
    }
  }

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

  // -------------------------------------------------------------------
  // Append every biomarker entry to biomarker_log so trends can be
  // computed on the next Shield decrypt. Best-effort: never fail the
  // save if the log write errors.
  // -------------------------------------------------------------------
  type LogRow = {
    patient_id: string;
    biomarker_key: string;
    date_collected: string;
    source: "lab" | "wearable" | "self_reported";
    value_encrypted: string;
  };
  const logRows: LogRow[] = [];

  for (const [key, entry] of Object.entries(cleanedBiomarkers)) {
    if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) continue;
    const date = entry.date_collected || todayIso();
    const source = entry.source || "self_reported";
    const value_encrypted = encryptJson(
      { value: entry.value },
      `biomarker_log:${session.patientId}:${key}`,
    );
    logRows.push({
      patient_id: session.patientId,
      biomarker_key: key,
      date_collected: date,
      source,
      value_encrypted,
    });
  }

  for (const [legacyKey, val] of Object.entries(cleanedLegacy)) {
    const canonical = LEGACY_TO_CANONICAL[legacyKey];
    if (!canonical) continue;
    const value_encrypted = encryptJson(
      { value: val },
      `biomarker_log:${session.patientId}:${canonical}`,
    );
    logRows.push({
      patient_id: session.patientId,
      biomarker_key: canonical,
      date_collected: todayIso(),
      source: "self_reported",
      value_encrypted,
    });
  }

  if (logRows.length > 0) {
    const { error: logErr } = await sb.from("biomarker_log").insert(logRows);
    if (logErr) {
      // eslint-disable-next-line no-console
      console.error("[manual-labs] biomarker_log insert failed:", logErr.code || logErr.message);
    }
  }

  // -------------------------------------------------------------------
  // patient_vitals_shared mirror.
  // -------------------------------------------------------------------
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

  type _ManualLabsRef = ManualLabsInput;
  void (null as unknown as _ManualLabsRef);

  return NextResponse.json({
    ok: true,
    saved: enteredCount,
    logged: logRows.length,
    family_mirror_synced: !mirrorErr,
  });
}
