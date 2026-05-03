import "server-only";

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

/**
 * Service-role client. Bypasses RLS and MUST only be used in server-side
 * code that has already authenticated the caller. Never expose to clients.
 */
export function getServiceClient(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Supabase credentials not configured");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        "X-Client-Info": "careiq-sovereign/3.1",
      },
    },
  });
  return cached;
}

/**
 * Build a per-request anonymous-key client constrained to the user's JWT,
 * so RLS applies. Use this when acting on behalf of an authenticated patient
 * for read/write of their own rows.
 */
export function getUserClient(accessToken: string): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !anonKey) {
    throw new Error("Supabase credentials not configured");
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}
