import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { randomBytes } from "node:crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { resolveServiceRoleKey } from "@/lib/supabase-env";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/circle/generate-invite
 *
 * Creates a single-use invite code and emails the signup link directly
 * to the family member via Resend. Removes the copy/paste step.
 *
 * Auth: cookie session (sov_auth) via readSession().
 *
 * Body:
 *   recipient_email          required, where to send the invite
 *   recipient_name           optional, used in greeting
 *   personal_note            optional, short note from the patient
 *   patient_name             optional, shown to the family member
 *   suggested_relationship   optional
 *   suggested_alert_level    optional, "critical" or "informational"
 *   expires_in_days          optional, 1 to 30, default 7
 *
 * Response: { code, signup_url, expires_at, email_sent, email_id?, email_error? }
 *
 * The signup_url and code are still returned so the patient can fall
 * back to copy/paste if email delivery fails.
 */

const ALERT_LEVELS = ["critical", "informational"] as const;
type AlertLevel = (typeof ALERT_LEVELS)[number];

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CARECIRCLE_APP_URL =
  process.env.NEXT_PUBLIC_CARECIRCLE_APP_URL ||
  "https://care-os-uo7x.vercel.app";

const RESEND_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "CareIQ <noreply@sovereignhealthcareos.com>";

interface InviteBody {
  recipient_email?: string;
  recipient_name?: string;
  personal_note?: string;
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

function patientIdTag(id: string): string {
  return `pid:${id.slice(0, 8)}`;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

// Lightweight HTML escape for values dropped into the email body.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendInviteEmail(args: {
  to: string;
  recipientName: string | null;
  patientName: string | null;
  signupUrl: string;
  code: string;
  personalNote: string | null;
  relationship: string | null;
  alertLevel: AlertLevel;
}): Promise<{ sent: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { sent: false, error: "RESEND_API_KEY not configured" };
  }

  const greeting = args.recipientName
    ? `Hi ${esc(args.recipientName)},`
    : "Hi,";
  const patientLabel = args.patientName ? esc(args.patientName) : "a CareCircle patient";
  const relationshipLine = args.relationship
    ? `<p style="color:#444;font-size:14px;margin:8px 0">They suggested adding you as their <strong>${esc(args.relationship)}</strong>.</p>`
    : "";
  const alertLine =
    args.alertLevel === "critical"
      ? "You will receive critical health alerts only."
      : "You will receive informational and critical health alerts.";
  const noteBlock = args.personalNote
    ? `<div style="margin:18px 0;padding:14px 16px;background:#f7faf9;border-left:3px solid #00a890;border-radius:6px;color:#333;font-size:14px;line-height:1.6"><div style="font-size:11px;color:#666;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;margin-bottom:6px">Personal note</div>${esc(args.personalNote).replace(/\n/g, "<br>")}</div>`
    : "";

  const subject = args.patientName
    ? `${args.patientName} invited you to their Care Circle`
    : "You have been invited to a Care Circle";

  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;padding:16px">
  <h2 style="color:#00a890;margin:0 0 12px;font-size:22px">Welcome to the Care Circle</h2>
  <p style="font-size:15px;line-height:1.6;margin:8px 0">${greeting}</p>
  <p style="font-size:15px;line-height:1.6;margin:8px 0">
    <strong>${patientLabel}</strong> has invited you to join their CareCircle. CareCircle is a family
    coordination tool that lets you receive health alerts about them without exposing any raw medical
    data. ${esc(alertLine)}
  </p>
  ${relationshipLine}
  ${noteBlock}
  <p style="margin:24px 0">
    <a href="${esc(args.signupUrl)}" style="display:inline-block;padding:13px 26px;background:#00a890;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px">
      Accept and Set Up Your Account
    </a>
  </p>
  <p style="font-size:13px;color:#555;line-height:1.6;margin:8px 0">
    Or paste this link into your browser:<br>
    <a href="${esc(args.signupUrl)}" style="color:#00a890;word-break:break-all">${esc(args.signupUrl)}</a>
  </p>
  <p style="font-size:13px;color:#555;line-height:1.6;margin:8px 0">
    Invite code: <code style="font-family:'DM Mono',monospace;background:#f0f0f0;padding:2px 8px;border-radius:4px;letter-spacing:0.15em">${esc(args.code)}</code>
  </p>
  <p style="font-size:12px;color:#888;margin-top:32px;padding-top:14px;border-top:1px solid #eee;line-height:1.55">
    This invite is single-use and expires soon. CareCircle and CareIQ are protected by the Sovereign
    Prompt Shield. No raw vitals or PHI are included in any alert.
  </p>
</div>`.trim();

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: args.to,
      subject,
      html,
    }),
  });

  if (!r.ok) {
    return { sent: false, error: `Resend ${r.status}: ${await r.text()}` };
  }
  const data = (await r.json()) as { id?: string };
  return { sent: true, id: data.id };
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

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("[generate-invite]", tag, "NEXT_PUBLIC_SUPABASE_URL not set");
    return NextResponse.json(
      { error: "server misconfigured: NEXT_PUBLIC_SUPABASE_URL" },
      { status: 500 },
    );
  }
  if (!resolveServiceRoleKey()) {
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
    // Body is optional but recipient_email is required for sending.
  }

  const recipient_email = (body.recipient_email || "").trim().toLowerCase();
  if (!recipient_email) {
    return NextResponse.json(
      { error: "recipient_email required" },
      { status: 400 },
    );
  }
  if (!isEmail(recipient_email)) {
    return NextResponse.json(
      { error: "recipient_email is not a valid email address" },
      { status: 400 },
    );
  }

  const recipient_name = body.recipient_name?.trim() || null;
  const personal_note = body.personal_note?.trim() || null;
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

  const signupUrl = `${CARECIRCLE_APP_URL}/signup?code=${inviteRow.code}`;

  // Send the email. If Resend is not configured or fails, we still
  // return the URL so the patient can fall back to copy/paste.
  const emailResult = await sendInviteEmail({
    to: recipient_email,
    recipientName: recipient_name,
    patientName: patient_name,
    signupUrl,
    code: inviteRow.code,
    personalNote: personal_note,
    relationship: suggested_relationship,
    alertLevel: suggested_alert_level,
  });

  if (!emailResult.sent) {
    console.error("[generate-invite]", tag, "email failed:", emailResult.error);
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
    signup_url: signupUrl,
    expires_at,
    email_sent: emailResult.sent,
    ...(emailResult.id ? { email_id: emailResult.id } : {}),
    ...(emailResult.error ? { email_error: emailResult.error } : {}),
  });
}
