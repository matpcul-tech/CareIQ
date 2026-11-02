const LEGACY_WARNING =
  "[supabase] SUPABASE_SERVICE_KEY is deprecated. Set SUPABASE_SERVICE_ROLE_KEY. The old name still works.";

let warnedLegacy = false;

/**
 * Service role key for server-side Supabase calls.
 * SUPABASE_SERVICE_ROLE_KEY is the name to set. SUPABASE_SERVICE_KEY is
 * accepted so existing deployments keep working, and a warning is logged.
 */
export function resolveServiceRoleKey(
  env: NodeJS.ProcessEnv = process.env,
  warn?: (message: string) => void,
): string {
  const primary = (env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (primary) return primary;
  const legacy = (env.SUPABASE_SERVICE_KEY || "").trim();
  if (!legacy) return "";
  const log = warn || warnLegacyOnce;
  log(LEGACY_WARNING);
  return legacy;
}

function warnLegacyOnce(message: string) {
  if (warnedLegacy) return;
  warnedLegacy = true;
  console.warn(message);
}

export const SERVICE_ROLE_ENV_WARNING = LEGACY_WARNING;
