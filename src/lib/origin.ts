import { NextRequest } from "next/server";

/**
 * Resolve the canonical public origin (e.g. https://care-iq-sable.vercel.app)
 * for use in outbound URLs like Supabase magic-link redirects, OAuth
 * callbacks, and email templates.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_SITE_URL, explicit, set by ops in Vercel
 *   2. x-forwarded-host + x-forwarded-proto, set by Vercel's edge
 *   3. host header
 *   4. req.nextUrl.origin, last resort, can be wrong on Vercel
 */
export function getPublicOrigin(req: NextRequest): string {
  const explicit = (process.env.NEXT_PUBLIC_SITE_URL || "").trim();
  if (explicit) return stripTrailingSlash(explicit);

  const xfHost = (req.headers.get("x-forwarded-host") || "").split(",")[0].trim();
  const xfProto = (req.headers.get("x-forwarded-proto") || "").split(",")[0].trim();
  if (xfHost) {
    const proto = xfProto || "https";
    return `${proto}://${xfHost}`;
  }

  const host = (req.headers.get("host") || "").trim();
  if (host) {
    const proto = host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https";
    return `${proto}://${host}`;
  }

  return stripTrailingSlash(req.nextUrl.origin);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}
