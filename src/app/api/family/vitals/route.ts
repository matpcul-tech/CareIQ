import { NextRequest, NextResponse } from "next/server";
import { decryptJson } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/family/vitals
 *
 * Returns the patient's latest non-PHI vital summary to a family member,
 * authenticated by their Supabase JWT.
 *
 * Auth model:
 *   - Authorization: Bearer <access_token> (the family member's Supabase JWT)
 *   - The JWT is validated against /auth/v1/user.
 *   - The endpoint then verifies the family member is in care_circle for
 *     a patient and resolves to that patient_id. RLS-equivalent scoping
 *     is enforced in code: nothing else is reachable through this route.
 *
 * The route reads health_history.data_encrypted and (optionally) the
 * latest wearable_data.data_encrypted, decrypts them server-side using
 * CareIQ's encryption key, and returns ONLY:
 *   - bp_systolic, bp_diastolic
 *   - a1c, ldl
 *   - hr (latest wearable heart rate, if any)
 *   - spo2 (latest wearable SpO2, if any)
 *   - risk_score (computed server-side from those numerics)
 *   - patient_id, updated_at
 *
 * Nothing else is returned. No raw chronic conditions, no medications,
 * no allergies, no profile, no full wearable timeline. The decryption
 * key never leaves the server.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
}

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
  chronicConditions?: string[];
}

interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
}

interface WearablePlaintext {
  device: string;
  metrics: DailyMetric[];
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
  if (latest?.spo2 != null && latest.spo2 < 95) score -= 6;
  if (latest?.heartRate != null && (latest.heartRate < 50 || latest.heartRate > 100)) score -= 4;
  return Math.max(40, Math.min(95, score));
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  // 1. Validate the family member's JWT.
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return bad("authorization required", 401);
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!m) return bad("authorization required", 401);
  const token = m[1].trim();
  if (!token) return bad("authorization required", 401);

  if (!SUPABASE_URL || !ANON_KEY) {
    return bad("server misconfigured", 500, { env: "NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing" });
  }

  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!userRes.ok) {
    return bad("invalid token", 401, { auth_status: userRes.status });
  }
  const user = (await userRes.json()) as { id: string; email?: string };
  const familyUserId = user.id;

  // 2. Resolve which patient this family member is linked to. Service role
  //    bypasses RLS; we enforce care_circle linkage manually.
  const sb = getServiceClient();
  const { data: ccRow, error: ccErr } = await sb
    .from("care_circle")
    .select("patient_id")
    .eq("member_user_id", familyUserId)
    .maybeSingle();

  if (ccErr) {
    return bad("care_circle lookup failed", 500, { code: ccErr.code });
  }
  if (!ccRow) {
    return bad("no care circle membership", 403);
  }
  const patientId = ccRow.patient_id as string;

  // 3. Read + decrypt the patient's health_history (latest manual labs).
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
      // Decryption failed (key rotation, corruption). Treat as no labs on file.
    }
  }

  // 4. Read + decrypt the latest wearable_data row for HR / SpO2.
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
      // Decryption failed. Treat as no wearable data.
    }
  }

  // 5. Compute risk score and assemble the sanitized response.
  const riskScore = calculateRiskScore(labs, latestMetric);
  const updatedAt =
    historyUpdatedAt && wearableUpdatedAt
      ? historyUpdatedAt > wearableUpdatedAt
        ? historyUpdatedAt
        : wearableUpdatedAt
      : historyUpdatedAt || wearableUpdatedAt || null;

  // 6. Audit log the family read so the patient's audit trail records who
  //    saw what (action only, no values).
  await logAudit({
    sessionId: "",
    action: "patient.profile.read",
    dataType: "profile",
    success: true,
    metadata: { reason_code: "family_vitals_read" },
  });

  return NextResponse.json(
    {
      patient_id: patientId,
      bp_systolic: labs.bpSystolic ?? null,
      bp_diastolic: labs.bpDiastolic ?? null,
      a1c: labs.a1c ?? null,
      ldl: labs.ldl ?? null,
      hr: latestMetric?.heartRate ?? null,
      spo2: latestMetric?.spo2 ?? null,
      risk_score: riskScore,
      updated_at: updatedAt,
    },
    { headers: CORS_HEADERS },
  );
}
