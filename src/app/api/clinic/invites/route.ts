import { NextRequest } from "next/server";
import { createInviteLink, listInviteLinks, revokeInviteLink } from "@/lib/clinic/onboarding/logic";
import { csrfReject, onboardingDeps, reply, storeDown } from "@/lib/clinic/onboarding/route-helpers";
import { enforceStaffClinic } from "@/lib/clinic/staff-auth";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { readClinicActor } from "@/lib/clinic/token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function actorFor(req: NextRequest) {
  const token = req.cookies.get("sov_clinic")?.value || "";
  return enforceStaffClinic(new SupabaseClinicStore(), readClinicActor(token, process.env.CSRF_SECRET || "", Date.now()));
}

/** GET: list invite links (clinic admin). Tokens are never returned after creation. */
export async function GET(req: NextRequest) {
  try {
    return reply(await listInviteLinks(onboardingDeps(req), await actorFor(req)));
  } catch (err) {
    return storeDown(err);
  }
}

/** POST { action: "create", role, admin } or { action: "revoke", id } (clinic admin). */
export async function POST(req: NextRequest) {
  const bad = csrfReject(req);
  if (bad) return bad;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const deps = onboardingDeps(req);
    const actor = await actorFor(req);
    if (body.action === "revoke") return reply(await revokeInviteLink(deps, actor, body.id));
    return reply(await createInviteLink(deps, actor, { role: body.role, admin: body.admin }));
  } catch (err) {
    return storeDown(err);
  }
}
