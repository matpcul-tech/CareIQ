import { NextRequest, NextResponse } from "next/server";

/**
 * The /auth/callback route is excluded at the matcher level so middleware
 * never runs for it. The magic-link callback must reach its route handler
 * with no rate-limit, no session rotation, no CSRF check, and no cookie
 * writes that could collide with the sov_auth cookie the handler sets on
 * its redirect response.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|auth/callback).*)",
  ],
};

const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60_000;
const SESSION_IDLE_TIMEOUT_MS = 30 * 60_000;
const SESSION_COOKIE = "sov_session";
const CSRF_COOKIE = "sov_csrf";
const SESSION_TS_COOKIE = "sov_session_ts";
const AUTH_COOKIE = "sov_auth";

type Bucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, Bucket>();

const PUBLIC_API_PATHS = new Set<string>([
  "/api/auth/magic-link",
  "/api/csrf",
]);

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

function rateLimit(ip: string): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = rateBuckets.get(ip);
  if (!existing || existing.resetAt <= now) {
    const bucket: Bucket = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateBuckets.set(ip, bucket);
    return { ok: true, remaining: RATE_LIMIT_MAX - 1, resetAt: bucket.resetAt };
  }
  existing.count += 1;
  if (existing.count > RATE_LIMIT_MAX) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt };
  }
  return { ok: true, remaining: RATE_LIMIT_MAX - existing.count, resetAt: existing.resetAt };
}

function pruneRateBuckets() {
  if (rateBuckets.size < 5000) return;
  const now = Date.now();
  for (const [k, v] of rateBuckets) {
    if (v.resetAt <= now) rateBuckets.delete(k);
  }
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function randomToken(byteLength = 32): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

function randomNonce(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return toBase64(buf);
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(new Uint8Array(sig));
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co https://api-inference.huggingface.co",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; ");
}

function isOnboardPath(pathname: string): boolean {
  return pathname === "/onboard" || pathname.startsWith("/onboard/");
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

function isClinicalPath(pathname: string): boolean {
  return pathname === "/clinical" || pathname.startsWith("/clinical/");
}

function isProtectedApi(pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (PUBLIC_API_PATHS.has(pathname)) return false;
  return true;
}

export async function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const pathname = url.pathname;
  const method = req.method.toUpperCase();
  const ip = getClientIp(req);

  pruneRateBuckets();
  const rl = rateLimit(ip);
  if (!rl.ok) {
    return new NextResponse(
      JSON.stringify({ error: "Too many requests" }),
      {
        status: 429,
        headers: {
          "content-type": "application/json",
          "Retry-After": Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000)).toString(),
        },
      },
    );
  }

  const csrfSecret = process.env.CSRF_SECRET || "";
  const existingSession = req.cookies.get(SESSION_COOKIE)?.value || "";
  const existingCsrf = req.cookies.get(CSRF_COOKIE)?.value || "";
  const existingTs = req.cookies.get(SESSION_TS_COOKIE)?.value || "";
  const existingAuth = req.cookies.get(AUTH_COOKIE)?.value || "";

  let sessionExpired = false;
  const now = Date.now();
  if (existingSession && existingTs) {
    const ts = Number(existingTs);
    if (!Number.isFinite(ts) || now - ts > SESSION_IDLE_TIMEOUT_MS) {
      sessionExpired = true;
    }
  }

  const isEditEntry = url.searchParams.get("edit") === "1";
  if (isOnboardPath(pathname) && existingAuth && !sessionExpired && !isEditEntry) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const newSessionId = randomToken(32);
  const newCsrfToken = randomToken(32);
  const newCsrfSig = csrfSecret
    ? await hmacSha256Hex(csrfSecret, newCsrfToken + ":" + newSessionId)
    : "";
  const csrfCookieValue = newCsrfSig ? `${newCsrfToken}.${newCsrfSig}` : newCsrfToken;

  const isApi = pathname.startsWith("/api/");
  const isMutating = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  if (isApi && isMutating) {
    const headerToken = req.headers.get("x-csrf-token") || "";
    const cookieToken = existingCsrf;
    if (!headerToken || !cookieToken) {
      return new NextResponse(
        JSON.stringify({ error: "CSRF token missing" }),
        { status: 403, headers: { "content-type": "application/json" } },
      );
    }
    if (csrfSecret) {
      const [tok, sig] = cookieToken.split(".");
      if (!tok || !sig || !existingSession) {
        return new NextResponse(
          JSON.stringify({ error: "CSRF token invalid" }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      const expected = await hmacSha256Hex(csrfSecret, tok + ":" + existingSession);
      if (!constantTimeEqual(sig, expected)) {
        return new NextResponse(
          JSON.stringify({ error: "CSRF token invalid" }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
      if (!constantTimeEqual(tok, headerToken)) {
        return new NextResponse(
          JSON.stringify({ error: "CSRF token mismatch" }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
    } else {
      if (!constantTimeEqual(cookieToken, headerToken)) {
        return new NextResponse(
          JSON.stringify({ error: "CSRF token mismatch" }),
          { status: 403, headers: { "content-type": "application/json" } },
        );
      }
    }
  }

  const needsIdentity = isDashboardPath(pathname) || isClinicalPath(pathname) || isProtectedApi(pathname);
  if (needsIdentity) {
    if (sessionExpired) {
      const redirectRes = NextResponse.redirect(
        new URL("/onboard?expired=1", req.url),
      );
      redirectRes.cookies.delete(SESSION_COOKIE);
      redirectRes.cookies.delete(CSRF_COOKIE);
      redirectRes.cookies.delete(SESSION_TS_COOKIE);
      redirectRes.cookies.delete(AUTH_COOKIE);
      return redirectRes;
    }
    if (!existingAuth) {
      if (isApi) {
        return new NextResponse(
          JSON.stringify({ error: "Authentication required" }),
          { status: 401, headers: { "content-type": "application/json" } },
        );
      }
      return NextResponse.redirect(new URL("/onboard", req.url));
    }
  }

  const nonce = randomNonce();
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-session-id", newSessionId);
  requestHeaders.set("x-client-ip", ip);
  requestHeaders.set("x-nonce", nonce);

  const res = NextResponse.next({ request: { headers: requestHeaders } });

  res.cookies.set({
    name: SESSION_COOKIE,
    value: newSessionId,
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_IDLE_TIMEOUT_MS / 1000,
  });
  res.cookies.set({
    name: SESSION_TS_COOKIE,
    value: now.toString(),
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_IDLE_TIMEOUT_MS / 1000,
  });
  res.cookies.set({
    name: CSRF_COOKIE,
    value: csrfCookieValue,
    httpOnly: false,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_IDLE_TIMEOUT_MS / 1000,
  });

  res.headers.set("Content-Security-Policy", buildCsp(nonce));
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.headers.set("X-RateLimit-Limit", RATE_LIMIT_MAX.toString());
  res.headers.set("X-RateLimit-Remaining", rl.remaining.toString());

  return res;
}
