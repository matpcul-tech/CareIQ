import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { getServiceClient } from "@/lib/supabase-server";
import { exchangeCode, subscribeNotify } from "@/lib/withings/api";
import { WITHINGS_APPLIS, notifyCallbackUrl, readWithingsConfig } from "@/lib/withings/config";
import { isWithingsEnabled } from "@/lib/withings/flag";
import { supabaseWithingsStore } from "@/lib/withings/store-supabase";
import { connectionFromTokens, syncConnection, withinBudget } from "@/lib/withings/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATE_COOKIE = "withings_oauth_state";

function sameToken(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function done(req: NextRequest, status: string) {
  const res = NextResponse.redirect(new URL(`/clinical?withings=${status}`, req.url));
  res.cookies.set(STATE_COOKIE, "", { path: "/api/withings/callback", maxAge: 0 });
  return res;
}

/** OAuth redirect target. Exchanges the code, stores encrypted tokens, subscribes to Notify. */
export async function GET(req: NextRequest) {
  if (!isWithingsEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cfg = readWithingsConfig();
  if (!cfg) return NextResponse.json({ error: "withings not configured" }, { status: 503 });
  const session = readSession();
  if (!session.patientId) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const code = req.nextUrl.searchParams.get("code") || "";
  const state = req.nextUrl.searchParams.get("state") || "";
  const expected = req.cookies.get(STATE_COOKIE)?.value || "";
  if (!code || !sameToken(state, expected)) return done(req, "error");

  const fetchImpl = fetch as unknown as Parameters<typeof exchangeCode>[1];
  const nowMs = Date.now();
  try {
    const tokens = await exchangeCode(cfg, fetchImpl, code, Math.floor(nowMs / 1000));
    const store = supabaseWithingsStore(getServiceClient());
    const conn = connectionFromTokens(session.patientId, tokens, nowMs, null);
    await store.saveConnection(conn);
    const callbackUrl = notifyCallbackUrl(cfg);
    for (const appli of WITHINGS_APPLIS) {
      await subscribeNotify(fetchImpl, conn.accessToken, callbackUrl, appli);
    }
    // First pull of recent readings. Bounded so the redirect is not held up.
    await withinBudget(syncConnection(conn, { cfg, store, fetchImpl }), 8000);
    return done(req, "connected");
  } catch {
    return done(req, "error");
  }
}
