import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { readSession } from "@/lib/session";
import { buildAuthorizeUrl, readWithingsConfig } from "@/lib/withings/config";
import { isWithingsEnabled } from "@/lib/withings/flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WITHINGS_STATE_COOKIE = "withings_oauth_state";

/** Starts the Withings OAuth 2.0 authorization code flow for the signed-in patient. */
export async function GET() {
  if (!isWithingsEnabled()) return NextResponse.json({ error: "not found" }, { status: 404 });
  const cfg = readWithingsConfig();
  if (!cfg) return NextResponse.json({ error: "withings not configured" }, { status: 503 });
  const session = readSession();
  if (!session.patientId) return NextResponse.json({ error: "authentication required" }, { status: 401 });

  const state = randomBytes(24).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(cfg, state));
  res.cookies.set(WITHINGS_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/withings/callback",
    maxAge: 600,
  });
  return res;
}
