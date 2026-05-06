import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Insert a new family_messages row from the patient (CareIQ side).
 * Cookie auth + service_role; sender_role is fixed to 'patient'.
 */
export async function POST(req: NextRequest) {
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json(
      { error: "authentication required" },
      { status: 401 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { body?: string };
  const text = (body.body || "").trim();
  if (!text || text.length > 4000) {
    return NextResponse.json(
      { error: "body must be 1 to 4000 chars" },
      { status: 400 },
    );
  }
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("family_messages")
    .insert({
      patient_id: session.patientId,
      sender_role: "patient",
      sender_label: "Patient",
      body: text,
    })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ message: data });
}
