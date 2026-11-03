import { NextRequest } from "next/server";
import { redeemInviteLink } from "@/lib/clinic/onboarding/logic";
import { csrfReject, onboardingDeps, reply, storeDown } from "@/lib/clinic/onboarding/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/clinic/join: redeem a single-use staff invite link. */
export async function POST(req: NextRequest) {
  const bad = csrfReject(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return reply(await redeemInviteLink(onboardingDeps(req), { token: body.token, displayName: body.displayName, email: body.email }));
  } catch (err) {
    return storeDown(err);
  }
}
