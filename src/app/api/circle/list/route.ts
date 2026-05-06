import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read all care_circle members for the cookie-authed patient. Used by
 * the CareIQ Patient dashboard's Family Hub tab to render avatars
 * and names. Service-role bypass is safe here because the cookie
 * session itself is the authorization boundary.
 */
export async function GET() {
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json(
      { error: "authentication required" },
      { status: 401 },
    );
  }
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("care_circle")
    .select(
      "id,member_user_id,member_email,member_name,member_phone,relationship,alert_level,created_at",
    )
    .eq("patient_id", session.patientId)
    .order("created_at", { ascending: true });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ members: data || [] });
}
