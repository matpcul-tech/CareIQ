import { NextRequest } from "next/server";
import { redeemSetupToken } from "@/lib/clinic/onboarding/logic";
import { csrfReject, onboardingDeps, reply, storeDown } from "@/lib/clinic/onboarding/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST /api/clinic/setup: redeem a one-time operator setup token to create a clinic and its first admin. */
export async function POST(req: NextRequest) {
  const bad = csrfReject(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    return reply(await redeemSetupToken(onboardingDeps(req), {
      token: body.token, clinicName: body.clinicName, adminName: body.adminName, adminEmail: body.adminEmail, adminRole: body.adminRole,
    }));
  } catch (err) {
    return storeDown(err);
  }
}
