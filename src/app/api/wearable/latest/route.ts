import { NextResponse } from "next/server";
import { decryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { loadSyncSources } from "@/lib/sync-sources-server";
import type { SyncSource } from "@/lib/sync-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Lightweight wearable endpoint. The dashboard checks it about once a
 * minute (CHECK_INTERVAL_MS). The readings are only as new as the last
 * upload or sync, so the response carries per-source "last synced" times
 * and the UI shows those instead of a live indicator.
 *
 * Reads the most recent wearable_data row + the patient's manualLabs +
 * a couple of biomarker keys (fasting_glucose, body_temperature) so
 * the patient dashboard's LIVE strip can render HR, SpO2, BP, Glucose,
 * Temp, HRV, Steps, Sleep without paying for the full Shield decrypt
 * (no biomarker panel build, no audit log, no trend computation).
 *
 * Cookie-auth only, no body. Returns flat JSON.
 */

interface WearableMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
  hrv?: number;
  activeCalories?: number;
}

interface WearablePlaintext {
  device: string;
  metrics: WearableMetric[];
}

interface ManualLabs {
  bpSystolic?: number;
  bpDiastolic?: number;
}

interface BiomarkerStored { value?: number | null }

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
  biomarkers?: Record<string, BiomarkerStored | undefined>;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET() {
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json(
      { error: "authentication required" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const sb = getServiceClient();

  const { data: wd } = await sb
    .from("wearable_data")
    .select("data_encrypted, uploaded_at")
    .eq("patient_id", session.patientId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No live device integration. The label comes from the uploaded file.
  let device: string | null = null;
  let latest: WearableMetric | null = null;
  let updatedAt: string | null = null;
  if (wd?.data_encrypted) {
    updatedAt = (wd as { uploaded_at?: string }).uploaded_at ?? null;
    try {
      const parsed = decryptJson<WearablePlaintext>(
        wd.data_encrypted,
        `wearable:${session.patientId}`,
      );
      device = parsed.device || "Uploaded file";
      const metrics = parsed.metrics || [];
      latest = metrics[metrics.length - 1] || null;
    } catch {
      // ignore; fall through with nulls
    }
  }

  let bpSys: number | null = null;
  let bpDia: number | null = null;
  let glucose: number | null = null;
  let temperature: number | null = null;

  const { data: hh } = await sb
    .from("health_history")
    .select("data_encrypted, updated_at")
    .eq("patient_id", session.patientId)
    .maybeSingle();
  const historyUpdatedAt = (hh as { updated_at?: string } | null)?.updated_at ?? null;
  if (hh?.data_encrypted) {
    try {
      const blob = decryptJson<HistoryPlaintext>(
        hh.data_encrypted,
        `history:${session.patientId}`,
      );
      bpSys = blob.manualLabs?.bpSystolic ?? null;
      bpDia = blob.manualLabs?.bpDiastolic ?? null;
      const fg = blob.biomarkers?.fasting_glucose;
      if (fg && typeof fg.value === "number") glucose = fg.value;
      const bt = blob.biomarkers?.body_temperature;
      if (bt && typeof bt.value === "number") temperature = bt.value;
    } catch {
      // ignore
    }
  }

  let syncSources: SyncSource[] = [];
  try {
    syncSources = await loadSyncSources(sb, session.patientId, historyUpdatedAt);
  } catch {
    syncSources = [];
  }

  return NextResponse.json(
    {
      device,
      sync_sources: syncSources,
      decrypted_at: new Date().toISOString(),
      updated_at: updatedAt,
      metric_date: latest?.date ?? null,
      heart_rate: latest?.heartRate ?? null,
      spo2: latest?.spo2 ?? null,
      bp_systolic: bpSys,
      bp_diastolic: bpDia,
      glucose,
      temperature,
      hrv: latest?.hrv ?? null,
      steps: latest?.steps ?? null,
      sleep_hours: latest?.sleepHours ?? null,
      active_calories: latest?.activeCalories ?? null,
      calories: latest?.calories ?? null,
    },
    { headers: CORS_HEADERS },
  );
}
