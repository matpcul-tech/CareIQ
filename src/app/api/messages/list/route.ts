import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List recent family_messages for the cookie-authed patient. Used by
 * the CareIQ Family Hub message thread.
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
    .from("family_messages")
    .select("id,sender_role,sender_user_id,sender_label,body,created_at")
    .eq("patient_id", session.patientId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: data || [] });
}
