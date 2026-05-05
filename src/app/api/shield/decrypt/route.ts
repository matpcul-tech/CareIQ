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
 * Returns the patient's latest non-PHI vital summary, decrypted server-side.
 * The decryption key never leaves the server.
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
 *   so plaintext identifiers never sit in the audit row, but an
 *   investigator can confirm a known requester by hashing it.
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
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
}

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
}

interface DailyMetric {
  date: string;
  heartRate?: number;
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

type AuthResult =
  | { kind: "family"; requesterId: string; patientId: string }
  | { kind: "patient"; requesterId: string; patientId: string }
  | { kind: "deny"; status: number; message: string; debug?: unknown };

async function resolveAuth(req: NextRequest): Promise<AuthResult> {
  // 1. Family JWT path. The presence of an Authorization header means the
  //    caller is a Supabase-authenticated family member. We verify with
  //    Supabase and look up care_circle to pick the linked patient_id.
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

  // 2. Cookie session path. Patient self-access (or clinician on the
  //    patient's account in the CareIQ clinical view). The middleware has
  //    already gated /api/shield/decrypt as a public path; the route owns
  //    the cookie check itself.
  const session = readSession();
  if (session.patientId) {
    return { kind: "patient", requesterId: session.patientId, patientId: session.patientId };
  }

  return { kind: "deny", status: 401, message: "authentication required" };
}

interface DecryptedVitals {
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hr: number | null;
  spo2: number | null;
  risk_score: number;
  updated_at: string | null;
}

async function decryptVitals(patientId: string): Promise<DecryptedVitals> {
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

  return {
    bp_systolic: labs.bpSystolic ?? null,
    bp_diastolic: labs.bpDiastolic ?? null,
    a1c: labs.a1c ?? null,
    ldl: labs.ldl ?? null,
    hr: latestMetric?.heartRate ?? null,
    spo2: latestMetric?.spo2 ?? null,
    risk_score: calculateRiskScore(labs, latestMetric),
    updated_at: updatedAt,
  };
}

function fieldsAccessed(v: DecryptedVitals): string {
  const fields: string[] = [];
  if (v.bp_systolic !== null || v.bp_diastolic !== null) fields.push("bp");
  if (v.a1c !== null) fields.push("a1c");
  if (v.ldl !== null) fields.push("ldl");
  if (v.hr !== null) fields.push("hr");
  if (v.spo2 !== null) fields.push("spo2");
  fields.push("risk_score");
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

  const vitals = await decryptVitals(auth.patientId);
  const decryptedAt = new Date().toISOString();

  await logAudit({
    sessionId,
    action: "shield.decrypt",
    dataType: "health_history",
    success: true,
    metadata: {
      requester_hash: sha256Hex(auth.requesterId),
      patient_hash: sha256Hex(auth.patientId),
      fields_accessed: fieldsAccessed(vitals),
      requester_role: auth.kind,
      shield_version: SHIELD_VERSION,
    },
  });

  return NextResponse.json(
    {
      patient_id: auth.patientId,
      bp_systolic: vitals.bp_systolic,
      bp_diastolic: vitals.bp_diastolic,
      a1c: vitals.a1c,
      ldl: vitals.ldl,
      hr: vitals.hr,
      spo2: vitals.spo2,
      risk_score: vitals.risk_score,
      updated_at: vitals.updated_at,
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
