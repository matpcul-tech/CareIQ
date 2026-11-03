import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import type { FetchLike } from "@/lib/withings/api";
import { readWithingsConfig } from "@/lib/withings/config";
import { isWithingsEnabled } from "@/lib/withings/flag";
import { supabaseWithingsStore } from "@/lib/withings/store-supabase";
import { handleNotification, parseNotifyBody, withinBudget } from "@/lib/withings/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Withings asks for a 2xx within a few seconds. Work past this keeps running. */
const RESPONSE_BUDGET_MS = 2500;

function tokenOk(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function gate(token: string) {
  if (!isWithingsEnabled()) return { res: new NextResponse(null, { status: 404 }) } as const;
  const cfg = readWithingsConfig();
  if (!cfg || !tokenOk(token, cfg.webhookToken)) return { res: new NextResponse(null, { status: 404 }) } as const;
  return { cfg } as const;
}

/** Withings sends HEAD to check the URL before subscribing. */
export async function HEAD(_req: NextRequest, ctx: { params: { token: string } }) {
  const g = gate(ctx.params.token);
  if ("res" in g) return g.res;
  return new NextResponse(null, { status: 200 });
}

export async function GET(_req: NextRequest, ctx: { params: { token: string } }) {
  const g = gate(ctx.params.token);
  if ("res" in g) return g.res;
  return new NextResponse(null, { status: 200 });
}

/**
 * Notification callback. Withings does not sign notifications, so the
 * URL carries a long random token, and the body is only a hint: CareIQ
 * pulls readings itself with the stored token for a linked user.
 * Always answers 200 for a valid token so Withings does not retry
 * notifications CareIQ chose to ignore.
 */
export async function POST(req: NextRequest, ctx: { params: { token: string } }) {
  const g = gate(ctx.params.token);
  if ("res" in g) return g.res;
  const raw = await req.text().catch(() => "");
  const payload = parseNotifyBody(raw);
  if (!payload) return new NextResponse(null, { status: 200 });
  try {
    const store = supabaseWithingsStore(getServiceClient());
    await withinBudget(
      handleNotification(payload, { cfg: g.cfg, store, fetchImpl: fetch as unknown as FetchLike }),
      RESPONSE_BUDGET_MS,
    );
  } catch {
    // Logged nowhere with user data on purpose. The next notify pulls again.
  }
  return new NextResponse(null, { status: 200 });
}
