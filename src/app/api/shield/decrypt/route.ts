import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { decryptJson, sha256Hex } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sovereign Prompt Shield decryption endpoint.
 *
 * GET or POST /api/shield/decrypt
 *
 * Returns the patient's latest non-PHI vital + full blood panel + wearable
 * summary, decrypted server-side. The decryption key never leaves the server.
 *
 * Auth (one of, in this order):
 *   1. Family JWT path: Authorization: Bearer <Supabase access_token>.
 *      We verify the JWT with Supabase, then look up care_circle to find
 *      which patient this family member is linked to.
 *   2. Cookie session path (sov_auth): the patient viewing their own data,
 *      or a clinician operating on the patient's account in the CareIQ
 *      clinical view. Self-access; patient_id = session.patientId.
 *
 * Audit:
 *   Every successful decrypt writes one row to audit_log with action
 *   "shield.decrypt" and metadata { requester_hash, patient_hash,
 *   fields_accessed, requester_role, shield_version }. Hashes are SHA-256
 *   so plaintext identifiers never sit in the audit row.
 *
 * Forward-compat fields:
 *   total_cholesterol, crp, hrv, active_calories ship in the response shape
 *   with null values today. They become populated automatically once the
 *   CareIQ encryption schema gains the matching ManualLabs / DailyMetric
 *   keys (totalCholesterol / crp / hrv / activeCalories). Clients should
 *   tolerate null and not render UI for absent values.
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

interface ManualLabs {
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
}

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
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

interface BandSpec {
  ok: (v: number) => boolean;
  warn: (v: number) => boolean;
}

const LAB_BANDS: Record<string, BandSpec> = {
  a1c: { ok: (v) => v < 5.7, warn: (v) => v < 6.5 },
  ldl: { ok: (v) => v < 130, warn: (v) => v < 190 },
  hdl: { ok: (v) => v >= 40, warn: (v) => v >= 30 },
  total_cholesterol: { ok: (v) => v < 200, warn: (v) => v < 240 },
  fasting_glucose: { ok: (v) => v >= 70 && v < 100, warn: (v) => v < 126 },
  triglycerides: { ok: (v) => v < 150, warn: (v) => v < 200 },
  egfr: { ok: (v) => v >= 90, warn: (v) => v >= 60 },
  crp: { ok: (v) => v < 1, warn: (v) => v < 3 },
  bp: { ok: (v) => false, warn: (v) => false },
};

function bpStatus(sys: number | null, dia: number | null): RangeStatus {
  if (sys === null && dia === null) return "none";
  if ((sys ?? 0) >= 140 || (dia ?? 0) >= 90) return "alert";
  if ((sys ?? 0) >= 130 || (dia ?? 0) >= 80) return "warn";
  return "ok";
}

function bandStatus(key: string, value: number | null): RangeStatus {
  if (value === null) return "none";
  const b = LAB_BANDS[key];
  if (!b) return "none";
  if (b.ok(value)) return "ok";
  if (b.warn(value)) return "warn";
  return "alert";
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

interface DecryptedPayload {
  // Vitals (from manualLabs)
  bp_systolic: number | null;
  bp_diastolic: number | null;
  // Blood panel
  a1c: number | null;
  ldl: number | null;
  hdl: number | null;
  total_cholesterol: number | null;
  fasting_glucose: number | null;
  triglycerides: number | null;
  egfr: number | null;
  crp: number | null;
  // Wearable (latest day)
  hr: number | null;
  steps: number | null;
  spo2: number | null;
  sleep_hours: number | null;
  hrv: number | null;
  active_calories: number | null;
  calories: number | null;
  // Summary
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  updated_at: string | null;
}

async function decryptPayload(patientId: string): Promise<DecryptedPayload> {
  const sb = getServiceClient();

  const { data: hh } = await sb
    .from("health_history")
    .select("data_encrypted, updated_at")
    .eq("patient_id", patientId)
    .maybeSingle();

  let labs: ManualLabs = {};
  let historyUpdatedAt: string | null = null;
  if (hh?.data_encrypted) {
    historyUpdatedAt = (hh as { updated_at?: string }).updated_at ?? null;
    try {
      const parsed = decryptJson<HistoryPlaintext>(hh.data_encrypted, `history:${patientId}`);
      labs = parsed.manualLabs ?? {};
    } catch {
      // Decryption failed (key rotation, corruption). Treat as no labs.
    }
  }

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
      // Decryption failed. Treat as no wearable.
    }
  }

  const updatedAt =
    historyUpdatedAt && wearableUpdatedAt
      ? historyUpdatedAt > wearableUpdatedAt
        ? historyUpdatedAt
        : wearableUpdatedAt
      : historyUpdatedAt || wearableUpdatedAt || null;

  // Compute panel grade based on the blood panel + BP. Wearable is graded
  // separately and excluded from the panel grade.
  const panel: Array<{ key: string; value: number | null }> = [
    { key: "bp", value: labs.bpSystolic ?? null },
    { key: "a1c", value: labs.a1c ?? null },
    { key: "ldl", value: labs.ldl ?? null },
    { key: "hdl", value: labs.hdl ?? null },
    { key: "total_cholesterol", value: labs.totalCholesterol ?? null },
    { key: "fasting_glucose", value: labs.fastingGlucose ?? null },
    { key: "triglycerides", value: labs.triglycerides ?? null },
    { key: "egfr", value: labs.egfr ?? null },
    { key: "crp", value: labs.crp ?? null },
  ];

  let inRange = 0;
  let flagged = 0;
  for (const item of panel) {
    if (item.value === null) continue;
    let s: RangeStatus;
    if (item.key === "bp") {
      s = bpStatus(labs.bpSystolic ?? null, labs.bpDiastolic ?? null);
    } else {
      s = bandStatus(item.key, item.value);
    }
    if (s === "ok") inRange += 1;
    else if (s === "warn" || s === "alert") flagged += 1;
  }

  const totalGraded = inRange + flagged;
  let grade = "-";
  if (totalGraded > 0) {
    const pct = inRange / totalGraded;
    if (pct >= 1) grade = "A";
    else if (pct >= 0.8) grade = "B";
    else if (pct >= 0.6) grade = "C";
    else if (pct >= 0.4) grade = "D";
    else grade = "F";
  }

  const riskScore = calculateRiskScore(labs, latestMetric);

  return {
    bp_systolic: labs.bpSystolic ?? null,
    bp_diastolic: labs.bpDiastolic ?? null,
    a1c: labs.a1c ?? null,
    ldl: labs.ldl ?? null,
    hdl: labs.hdl ?? null,
    total_cholesterol: labs.totalCholesterol ?? null,
    fasting_glucose: labs.fastingGlucose ?? null,
    triglycerides: labs.triglycerides ?? null,
    egfr: labs.egfr ?? null,
    crp: labs.crp ?? null,
    hr: latestMetric?.heartRate ?? null,
    steps: latestMetric?.steps ?? null,
    spo2: latestMetric?.spo2 ?? null,
    sleep_hours: latestMetric?.sleepHours ?? null,
    hrv: latestMetric?.hrv ?? null,
    active_calories: latestMetric?.activeCalories ?? null,
    calories: latestMetric?.calories ?? null,
    risk_score: riskScore,
    risk_label: riskLabel(riskScore),
    panel_grade: grade,
    panel_flagged: flagged,
    panel_in_range: inRange,
    updated_at: updatedAt,
  };
}

function fieldsAccessed(v: DecryptedPayload): string {
  const fields: string[] = [];
  if (v.bp_systolic !== null || v.bp_diastolic !== null) fields.push("bp");
  if (v.a1c !== null) fields.push("a1c");
  if (v.ldl !== null) fields.push("ldl");
  if (v.hdl !== null) fields.push("hdl");
  if (v.total_cholesterol !== null) fields.push("chol");
  if (v.fasting_glucose !== null) fields.push("glucose");
  if (v.triglycerides !== null) fields.push("trig");
  if (v.egfr !== null) fields.push("egfr");
  if (v.crp !== null) fields.push("crp");
  if (v.hr !== null) fields.push("hr");
  if (v.steps !== null) fields.push("steps");
  if (v.spo2 !== null) fields.push("spo2");
  if (v.sleep_hours !== null) fields.push("sleep");
  if (v.hrv !== null) fields.push("hrv");
  fields.push("risk");
  fields.push("grade");
  return fields.join(",");
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
      fields_accessed: fieldsAccessed(payload),
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
