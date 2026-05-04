import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/circle/generate-invite
 *
 * Creates a single-use invite code that a family member can redeem on
 * CareCircle (care-os) to set up their account and start receiving
 * scoped, non-PHI alerts about this patient.
 *
 * Auth: cookie session (sov_auth) via readSession(). The CareCircle
 * spec mentioned a JWT bearer token, but CareIQ does not issue
 * Supabase JWTs to patients. Patient identity is sourced from the
 * existing cookie session, matching the pattern used by every other
 * authenticated route in this app (see /api/onboard/manual-labs).
 *
 * Body (all optional):
 *   patient_name             string  shown to the family member at signup
 *   suggested_relationship   string  pre fills relationship dropdown
 *   suggested_alert_level    string  "critical" or "informational"
 *   expires_in_days          number  1 to 30, default 7
 *
 * Response: { code, signup_url, expires_at }
 */

const ALERT_LEVELS = ["critical", "informational"] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

// 8 char codes, unambiguous alphabet (no 0/O/1/I).
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CARECIRCLE_APP_URL =
  process.env.NEXT_PUBLIC_CARECIRCLE_APP_URL ||
  "https://care-os-uo7x.vercel.app";

interface InviteBody {
  patient_name?: string;
  suggested_relationship?: string;
  suggested_alert_level?: string;
  expires_in_days?: number;
}

interface SupabaseInsertError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

function generateCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

// Short, non-PHI handle for the patient_id, used in logs only.
function patientIdTag(id: string): string {
  return `pid:${id.slice(0, 8)}`;
}

export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const session = readSession();
  if (!session.patientId) {
    console.warn("[generate-invite] 401 no session.patientId");
    return NextResponse.json(
      { error: "authentication required" },
      { status: 401 },
    );
  }
  const tag = patientIdTag(session.patientId);

  // Sanity check the env. Surface the missing var in logs immediately
  // rather than letting Supabase return a cryptic auth error.
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("[generate-invite]", tag, "NEXT_PUBLIC_SUPABASE_URL not set");
    return NextResponse.json(
      { error: "server misconfigured: NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 },
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[generate-invite]", tag, "SUPABASE_SERVICE_ROLE_KEY not set");
    return NextResponse.json(
      { error: "server misconfigured: SUPABASE_SERVICE_ROLE_KEY" },
      { status: 500 },
    );
  }

  let body: InviteBody = {};
  try {
    body = (await req.json()) as InviteBody;
  } catch {
    // Empty body is OK; all fields are optional.
  }

  const suggested_relationship = body.suggested_relationship?.trim() || null;
  const rawLevel = (body.suggested_alert_level || "informational").trim();
  if (!ALERT_LEVELS.includes(rawLevel as AlertLevel)) {
    return NextResponse.json(
      { error: 'suggested_alert_level must be "critical" or "informational"' },
      { status: 400 },
    );
  }
  const suggested_alert_level = rawLevel as AlertLevel;
  const patient_name = body.patient_name?.trim() || null;
  const expires_in_days = Math.min(Math.max(body.expires_in_days ?? 7, 1), 30);
  const expires_at = new Date(
    Date.now() + expires_in_days * 86_400_000,
  ).toISOString();

  const sb = getServiceClient();

  let inviteRow: { id: string; code: string } | null = null;
  let lastErr: SupabaseInsertError | null = null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const code = generateCode();
    const { data, error } = await sb
      .from("care_circle_invites")
      .insert({
        code,
        patient_id: session.patientId,
        patient_name,
        suggested_relationship,
        suggested_alert_level,
        expires_at,
      })
      .select("id, code")
      .single();

    if (!error && data) {
      inviteRow = data as { id: string; code: string };
      break;
    }

    lastErr = {
      code: error?.code,
      message: error?.message,
      details: error?.details,
      hint: error?.hint,
    };
    console.error(
      "[generate-invite]",
      tag,
      "insert failed (attempt",
      attempt + 1,
      "of 4):",
      JSON.stringify(lastErr),
    );

    // Retry only on code collision; bail on any other error.
    const isCollision = /duplicate|unique/i.test(lastErr.message || "");
    if (!isCollision) break;
  }

  if (!inviteRow) {
    await logAudit({
      sessionId,
      action: "carecircle.invite.created",
      dataType: "care_circle_invites",
      success: false,
      metadata: { reason_code: "db_write" },
    });

    // Return the Supabase error code in the response so we can see it in
    // browser DevTools without grepping Vercel logs. PHI safe: SQLSTATE
    // codes and PostgREST error codes only.
    return NextResponse.json(
      {
        error: "could not create invite",
        debug: {
          code: lastErr?.code ?? null,
          message: lastErr?.message ?? null,
          hint: lastErr?.hint ?? null,
        },
      },
      { status: 500 },
    );
  }

  await logAudit({
    sessionId,
    action: "carecircle.invite.created",
    dataType: "care_circle_invites",
    success: true,
    metadata: { invite_id: inviteRow.id, expires_in_days },
  });

  return NextResponse.json({
    code: inviteRow.code,
    signup_url: `${CARECIRCLE_APP_URL}/signup?code=${inviteRow.code}`,
    expires_at,
  });
}
