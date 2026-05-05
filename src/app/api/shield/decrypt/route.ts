import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { decryptJson, sha256Hex } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import {
  BIOMARKER_SPECS,
  computeStatus,
  getThresholds,
  type BiomarkerCategory,
  type BiomarkerSpec,
  type BiomarkerStatus,
  type Sex,
} from "@/lib/biomarker-ranges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sovereign Prompt Shield decryption endpoint.
 *
 * GET or POST /api/shield/decrypt
 *
 * Returns the patient's latest decrypted vital + full longevity biomarker
 * panel, server-side. The decryption key never leaves the server.
 *
 * Auth (one of):
 *   1. Family Bearer JWT (Supabase access_token).
 *   2. Cookie session (sov_auth) for patient self-access / clinician view.
 *
 * Response keeps the legacy flat fields (bp_systolic, a1c, ldl, etc.) for
 * back-compat with care-os clients that have not yet adopted the new
 * `biomarkers` shape. The new `biomarkers` object groups every spec from
 * BIOMARKER_SPECS by category and embeds resolved thresholds + computed
 * status.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SHIELD_VERSION = "v5";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function bad(message: string, status = 400, debug?: unknown) {
  const body: Record<string, unknown> = { error: message };
  if (debug !== undefined) body.debug = debug;
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

type Source = "lab" | "wearable" | "self_reported";

interface BiomarkerEntryStored {
  value?: number | null;
  date_collected?: string;
  source?: Source;
}

interface ManualLabs {
  // Legacy flat shape, still written by the existing onboard form.
  a1c?: number;
  ldl?: number;
  hdl?: number;
  totalCholesterol?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
  crp?: number;
  hsCrp?: number;
  hs_crp?: number;
}

interface BiomarkerBlob {
  // New per-biomarker structured shape, keyed by spec.key.
  [key: string]: BiomarkerEntryStored | undefined;
}

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
  biomarkers?: BiomarkerBlob;
}

interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
  sex?: Sex;
}

interface DailyMetric {
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
  metrics: DailyMetric[];
}

type RangeStatus = "ok" | "warn" | "alert" | "none";

function bpStatus(sys: number | null, dia: number | null): RangeStatus {
  if (sys === null && dia === null) return "none";
  if ((sys ?? 0) >= 140 || (dia ?? 0) >= 90) return "alert";
  if ((sys ?? 0) >= 130 || (dia ?? 0) >= 80) return "warn";
  return "ok";
}

function calculateRiskScore(labs: ManualLabs, latest: DailyMetric | null): number {
  let score = 85;
  if (labs.a1c != null) {
    if (labs.a1c >= 6.5) score -= 8;
    else if (labs.a1c >= 5.7) score -= 4;
  }
  if (labs.ldl != null) {
    if (labs.ldl >= 190) score -= 8;
    else if (labs.ldl >= 130) score -= 4;
  }
  if (labs.bpSystolic != null) {
    if (labs.bpSystolic >= 140 || (labs.bpDiastolic != null && labs.bpDiastolic >= 90)) score -= 6;
  }
  if (labs.fastingGlucose != null && labs.fastingGlucose >= 126) score -= 5;
  if (labs.triglycerides != null && labs.triglycerides >= 200) score -= 4;
  if (labs.egfr != null && labs.egfr < 60) score -= 4;
  if (latest?.spo2 != null && latest.spo2 < 95) score -= 6;
  if (latest?.heartRate != null && (latest.heartRate < 50 || latest.heartRate > 100)) score -= 4;
  return Math.max(40, Math.min(95, score));
}

function riskLabel(score: number): string {
  if (score >= 75) return "Low risk";
  if (score >= 55) return "Moderate risk";
  return "High risk";
}

type AuthResult =
  | { kind: "family"; requesterId: string; patientId: string }
  | { kind: "patient"; requesterId: string; patientId: string }
  | { kind: "deny"; status: number; message: string; debug?: unknown };

async function resolveAuth(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!m) return { kind: "deny", status: 401, message: "authorization required" };
    const token = m[1].trim();
    if (!token) return { kind: "deny", status: 401, message: "authorization required" };
    if (!SUPABASE_URL || !ANON_KEY) {
      return { kind: "deny", status: 500, message: "server misconfigured", debug: { env: "supabase env missing" } };
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!userRes.ok) {
      return { kind: "deny", status: 401, message: "invalid token", debug: { auth_status: userRes.status } };
    }
    const user = (await userRes.json()) as { id: string };
    const sb = getServiceClient();
    const { data: ccRow, error: ccErr } = await sb
      .from("care_circle")
      .select("patient_id")
      .eq("member_user_id", user.id)
      .maybeSingle();
    if (ccErr) {
      return { kind: "deny", status: 500, message: "care_circle lookup failed", debug: { code: ccErr.code } };
    }
    if (!ccRow) {
      return { kind: "deny", status: 403, message: "no care circle membership" };
    }
    return {
      kind: "family",
      requesterId: user.id,
      patientId: (ccRow as { patient_id: string }).patient_id,
    };
  }

  const session = readSession();
  if (session.patientId) {
    return { kind: "patient", requesterId: session.patientId, patientId: session.patientId };
  }

  return { kind: "deny", status: 401, message: "authentication required" };
}

// ---------------------------------------------------------------------------
// Biomarker resolution.
// ---------------------------------------------------------------------------

interface BiomarkerResponse {
  value: number | null;
  unit: string;
  precision: number;
  date_collected: string | null;
  source: Source | null;
  normal_low: number | null;
  normal_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
  bar_min: number;
  bar_max: number;
  status: BiomarkerStatus;
  trend: "improving" | "stable" | "declining" | null;
}

type CategoryGroup = Record<string, BiomarkerResponse>;
type BiomarkerPanel = Record<BiomarkerCategory, CategoryGroup>;

function emptyPanel(): BiomarkerPanel {
  return {
    metabolic: {},
    cardiovascular: {},
    organ: {},
    blood: {},
    hormonal: {},
    longevity: {},
    cognitive: {},
  };
}

function resolveSourceValue(
  spec: BiomarkerSpec,
  blob: HistoryPlaintext,
  latestWearable: DailyMetric | null,
): { value: number | null; date_collected: string | null; source: Source | null } {
  // 1. Wearable-sourced biomarkers come from the latest wearable_data row.
  if (spec.wearable_field && latestWearable) {
    const v = latestWearable[spec.wearable_field];
    if (typeof v === "number") {
      return {
        value: v,
        date_collected: latestWearable.date ?? null,
        source: "wearable",
      };
    }
  }

  // 2. New structured biomarkers blob keyed by spec.key.
  const entry = blob.biomarkers?.[spec.key];
  if (entry && typeof entry.value === "number") {
    return {
      value: entry.value,
      date_collected: entry.date_collected ?? null,
      source: entry.source ?? null,
    };
  }

  // 3. Legacy flat ManualLabs (camelCase) fallback.
  if (spec.legacy_keys && blob.manualLabs) {
    const labs = blob.manualLabs as Record<string, unknown>;
    for (const lk of spec.legacy_keys) {
      const v = labs[lk];
      if (typeof v === "number") {
        return { value: v, date_collected: null, source: "self_reported" };
      }
    }
  }

  return { value: null, date_collected: null, source: null };
}

function buildBiomarkerPanel(
  blob: HistoryPlaintext,
  latestWearable: DailyMetric | null,
  sex: Sex,
): BiomarkerPanel {
  const panel = emptyPanel();
  for (const spec of BIOMARKER_SPECS) {
    const src = resolveSourceValue(spec, blob, latestWearable);
    const th = getThresholds(spec, sex);
    const status = computeStatus(src.value, th);
    const entry: BiomarkerResponse = {
      value: src.value,
      unit: spec.unit,
      precision: spec.precision,
      date_collected: src.date_collected,
      source: src.source,
      normal_low: th.normal_low,
      normal_high: th.normal_high,
      optimal_low: th.optimal_low,
      optimal_high: th.optimal_high,
      bar_min: spec.bar_min,
      bar_max: spec.bar_max,
      status,
      // Trend requires a time series (planned phase 2). Always null today.
      trend: null,
    };
    panel[spec.category][spec.key] = entry;
  }
  return panel;
}

function summarizePanel(panel: BiomarkerPanel): {
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
} {
  let inRange = 0;
  let flagged = 0;
  for (const cat of Object.keys(panel) as BiomarkerCategory[]) {
    const group = panel[cat];
    for (const k of Object.keys(group)) {
      const entry = group[k];
      if (entry.status === "ok") inRange += 1;
      else if (entry.status === "suboptimal" || entry.status === "outside_normal") flagged += 1;
    }
  }
  const total = inRange + flagged;
  let grade = "-";
  if (total > 0) {
    const pct = inRange / total;
    if (pct >= 1) grade = "A";
    else if (pct >= 0.8) grade = "B";
    else if (pct >= 0.6) grade = "C";
    else if (pct >= 0.4) grade = "D";
    else grade = "F";
  }
  return { panel_grade: grade, panel_flagged: flagged, panel_in_range: inRange };
}

// ---------------------------------------------------------------------------
// Decrypt orchestration.
// ---------------------------------------------------------------------------

interface DecryptedPayload {
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hdl: number | null;
  total_cholesterol: number | null;
  fasting_glucose: number | null;
  triglycerides: number | null;
  egfr: number | null;
  crp: number | null;
  hr: number | null;
  steps: number | null;
  spo2: number | null;
  sleep_hours: number | null;
  hrv: number | null;
  active_calories: number | null;
  calories: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  updated_at: string | null;
  biomarkers: BiomarkerPanel;
  sex: Sex;
}

async function decryptPayload(patientId: string): Promise<DecryptedPayload> {
  const sb = getServiceClient();

  // Profile (for sex).
  const { data: pat } = await sb
    .from("patients")
    .select("profile_encrypted")
    .eq("id", patientId)
    .maybeSingle();
  let sex: Sex = "unknown";
  if (pat?.profile_encrypted) {
    try {
      const profile = decryptJson<ProfilePlaintext>(pat.profile_encrypted, `profile:${patientId}`);
      if (profile.sex === "male" || profile.sex === "female") sex = profile.sex;
    } catch {
      // unreadable, treat as unknown
    }
  }

  // Health history (manual labs + structured biomarkers).
  const { data: hh } = await sb
    .from("health_history")
    .select("data_encrypted, updated_at")
    .eq("patient_id", patientId)
    .maybeSingle();

  let blob: HistoryPlaintext = {};
  let historyUpdatedAt: string | null = null;
  if (hh?.data_encrypted) {
    historyUpdatedAt = (hh as { updated_at?: string }).updated_at ?? null;
    try {
      blob = decryptJson<HistoryPlaintext>(hh.data_encrypted, `history:${patientId}`);
    } catch {
      // Decryption failed (key rotation, corruption). Treat as empty.
      blob = {};
    }
  }
  const labs: ManualLabs = blob.manualLabs ?? {};

  // Wearable (latest).
  const { data: wd } = await sb
    .from("wearable_data")
    .select("data_encrypted, uploaded_at")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestMetric: DailyMetric | null = null;
  let wearableUpdatedAt: string | null = null;
  if (wd?.data_encrypted) {
    wearableUpdatedAt = (wd as { uploaded_at?: string }).uploaded_at ?? null;
    try {
      const parsed = decryptJson<WearablePlaintext>(wd.data_encrypted, `wearable:${patientId}`);
      const metrics = parsed.metrics || [];
      latestMetric = metrics[metrics.length - 1] || null;
    } catch {
      // ignore
    }
  }

  const updatedAt =
    historyUpdatedAt && wearableUpdatedAt
      ? historyUpdatedAt > wearableUpdatedAt
        ? historyUpdatedAt
        : wearableUpdatedAt
      : historyUpdatedAt || wearableUpdatedAt || null;

  // Build biomarker panel and summary.
  const biomarkers = buildBiomarkerPanel(blob, latestMetric, sex);
  const { panel_grade, panel_flagged, panel_in_range } = summarizePanel(biomarkers);

  // Risk score still derived from the original simple model. Phase 2 can
  // expand it across the full panel.
  const riskScore = calculateRiskScore(labs, latestMetric);

  // Resolve legacy flat fields. We prefer the structured biomarker if it
  // has a value (so the legacy fields stay consistent with the panel).
  const flat = (k: string): number | null => {
    for (const cat of Object.keys(biomarkers) as BiomarkerCategory[]) {
      const entry = biomarkers[cat][k];
      if (entry && typeof entry.value === "number") return entry.value;
    }
    return null;
  };

  // BP is not in BIOMARKER_SPECS (vitals, not a biomarker); keep direct.
  const bpStatusValue = bpStatus(labs.bpSystolic ?? null, labs.bpDiastolic ?? null);
  void bpStatusValue;

  return {
    bp_systolic: labs.bpSystolic ?? null,
    bp_diastolic: labs.bpDiastolic ?? null,
    a1c: flat("a1c"),
    ldl: flat("ldl"),
    hdl: flat("hdl"),
    total_cholesterol: flat("total_cholesterol"),
    fasting_glucose: flat("fasting_glucose"),
    triglycerides: flat("triglycerides"),
    egfr: flat("egfr"),
    crp: flat("hs_crp"),
    hr: latestMetric?.heartRate ?? null,
    steps: latestMetric?.steps ?? null,
    spo2: latestMetric?.spo2 ?? null,
    sleep_hours: latestMetric?.sleepHours ?? null,
    hrv: latestMetric?.hrv ?? null,
    active_calories: latestMetric?.activeCalories ?? null,
    calories: latestMetric?.calories ?? null,
    risk_score: riskScore,
    risk_label: riskLabel(riskScore),
    panel_grade,
    panel_flagged,
    panel_in_range,
    updated_at: updatedAt,
    biomarkers,
    sex,
  };
}

function fieldsAccessed(panel: BiomarkerPanel): string {
  const fields: string[] = [];
  for (const cat of Object.keys(panel) as BiomarkerCategory[]) {
    const group = panel[cat];
    for (const k of Object.keys(group)) {
      if (group[k].value !== null) fields.push(k);
    }
  }
  fields.push("risk");
  fields.push("grade");
  // Truncate to 256 chars (audit metadata cap is 256).
  const joined = fields.join(",");
  return joined.length > 256 ? joined.slice(0, 256) : joined;
}

async function handle(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const auth = await resolveAuth(req);

  if (auth.kind === "deny") {
    await logAudit({
      sessionId,
      action: "shield.failed",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: auth.message.slice(0, 64) },
    });
    return bad(auth.message, auth.status, auth.debug);
  }

  const payload = await decryptPayload(auth.patientId);
  const decryptedAt = new Date().toISOString();

  await logAudit({
    sessionId,
    action: "shield.decrypt",
    dataType: "health_history",
    success: true,
    metadata: {
      requester_hash: sha256Hex(auth.requesterId),
      patient_hash: sha256Hex(auth.patientId),
      fields_accessed: fieldsAccessed(payload.biomarkers),
      requester_role: auth.kind,
      shield_version: SHIELD_VERSION,
    },
  });

  return NextResponse.json(
    {
      patient_id: auth.patientId,
      ...payload,
      decrypted_at: decryptedAt,
      shield_version: SHIELD_VERSION,
    },
    { headers: CORS_HEADERS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
