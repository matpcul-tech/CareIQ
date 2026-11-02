export interface StaffAuthAdmin {
  inviteUserByEmail(
    email: string,
    options: { redirectTo: string },
  ): Promise<{ error: { message?: string } | null }>;
  generateLink(params: {
    type: "invite" | "magiclink";
    email: string;
    options?: { redirectTo?: string };
  }): Promise<{
    data: { properties?: { hashed_token?: string; verification_type?: string } | null } | null;
    error: { message?: string } | null;
  }>;
}

export type StaffInviteDelivery = "resend" | "supabase" | "existing_user";

function alreadyRegistered(message: string): boolean {
  return /already|registered|exists/i.test(message);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send the staff link through Resend when that key is set.
 * The link points at this app's /auth/callback with token_hash so the
 * staff browser does not need a PKCE cookie from the admin's session.
 */
export async function sendStaffLinkEmail(
  to: string,
  link: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return false;
  const from = process.env.RESEND_FROM_EMAIL || "CareIQ <noreply@sovereignhealthcareos.com>";
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: "Your CareIQ clinic sign-in link",
      html: `<p>Use this link to sign in to your clinic.</p><p><a href="${escapeHtml(link)}">Sign in</a></p><p>This link is for you. Do not forward it.</p>`,
    }),
  });
  return response.ok;
}

export async function deliverStaffInvite(
  admin: StaffAuthAdmin,
  email: string,
  redirectTo: string,
  sendLink?: (link: string) => Promise<boolean>,
): Promise<{ ok: true; delivery: StaffInviteDelivery } | { ok: false; error: string }> {
  if (sendLink) {
    let generated = await admin.generateLink({ type: "invite", email, options: { redirectTo } });
    if (generated.error && alreadyRegistered(generated.error.message || "")) {
      generated = await admin.generateLink({ type: "magiclink", email, options: { redirectTo } });
    }
    const token = generated.data?.properties?.hashed_token || "";
    const type = generated.data?.properties?.verification_type || "invite";
    if (generated.error || !token) return { ok: false, error: "invite email was not sent" };
    const link = `${redirectTo}?token_hash=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
    const sent = await sendLink(link);
    return sent ? { ok: true, delivery: "resend" } : { ok: false, error: "invite email was not sent" };
  }

  const invited = await admin.inviteUserByEmail(email, { redirectTo });
  if (!invited.error) return { ok: true, delivery: "supabase" };
  if (alreadyRegistered(invited.error.message || "")) return { ok: true, delivery: "existing_user" };
  return { ok: false, error: "invite email was not sent" };
}
