/**
 * Operator script: make a one-time clinic setup link.
 *
 * Required env: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL.
 * Optional: SETUP_TOKEN_HOURS (default 24, max 72), SETUP_TOKEN_NOTE (short label, no patient data).
 *
 * Prints the link once. Only the SHA-256 hash of the token is stored. The token goes in the
 * URL fragment (#token=...), which the browser does not send to the server or in a Referer.
 * Run: npx tsx scripts/create-clinic-setup-token.ts
 */
import { createClient } from "@supabase/supabase-js";
import { hashToken, newToken, SETUP_TOKEN_DEFAULT_HOURS, SETUP_TOKEN_MAX_HOURS } from "../src/lib/clinic/onboarding/tokens";
import { resolveServiceRoleKey } from "../src/lib/supabase-env";

export function setupHours(raw: string | undefined): number {
  const n = Number(raw || SETUP_TOKEN_DEFAULT_HOURS);
  if (!Number.isFinite(n) || n <= 0) return SETUP_TOKEN_DEFAULT_HOURS;
  return Math.min(SETUP_TOKEN_MAX_HOURS, n);
}

async function main() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = resolveServiceRoleKey();
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "").trim().replace(/\/+$/, "");
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  if (!site) throw new Error("NEXT_PUBLIC_SITE_URL is required");
  const hours = setupHours(process.env.SETUP_TOKEN_HOURS);
  const token = newToken();
  const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await sb.from("clinic_setup_tokens").insert({
    token_hash: hashToken(token), expires_at: expiresAt, note: (process.env.SETUP_TOKEN_NOTE || "").slice(0, 80) || null,
  });
  if (error) throw new Error(error.message);
  console.log(`Setup link (works once, expires ${expiresAt}):`);
  console.log(`${site}/clinic/setup#token=${token}`);
}

if (process.argv[1] && /create-clinic-setup-token/.test(process.argv[1])) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : "failed");
    process.exitCode = 1;
  });
}
