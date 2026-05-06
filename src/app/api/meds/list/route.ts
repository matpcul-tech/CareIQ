import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read the patient's active medications + today's "taken" log entries
 * from the care-os Supabase project (same physical project as CareIQ).
 *
 * Used by the CareIQ Patient dashboard's Medication Schedule tab to
 * show the read-only mirror of what's tracked on the CareCircle Meds
 * tab. All writes still happen on care-os.
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
  const today = new Date().toISOString().slice(0, 10);
  const [mRes, lRes] = await Promise.all([
    sb
      .from("medications")
      .select(
        "id,name,dose,frequency,time_of_day,prescribing_doctor,start_date,active,created_at",
      )
      .eq("patient_id", session.patientId)
      .eq("active", true)
      .order("created_at", { ascending: false }),
    sb
      .from("medication_logs")
      .select("id,medication_id,taken_on")
      .eq("patient_id", session.patientId)
      .eq("taken_on", today),
  ]);
  if (mRes.error) {
    return NextResponse.json({ error: mRes.error.message }, { status: 500 });
  }
  if (lRes.error) {
    return NextResponse.json({ error: lRes.error.message }, { status: 500 });
  }
  return NextResponse.json({
    medications: mRes.data || [],
    todays_logs: lRes.data || [],
  });
}
