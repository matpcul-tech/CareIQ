import { NextRequest, NextResponse } from "next/server";
import { phoneHash, SupabaseReminderStore } from "@/lib/clinic/reminders/supabase-store";
import { handleReminderInbound } from "@/lib/clinic/reminders/twilio";
import { auditReminders } from "@/lib/clinic/reminders/audit-adapter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Twilio STOP, HELP, START webhook for reminder texts. Ready for later; fails closed until Twilio is set up. */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  try {
    const result = await handleReminderInbound(
      {
        url: req.url,
        webhookUrl: process.env.TWILIO_REMINDER_WEBHOOK_URL || "",
        signature: req.headers.get("x-twilio-signature") || "",
        rawBody,
        authToken: process.env.TWILIO_AUTH_TOKEN || "",
        at: new Date().toISOString(),
      },
      new SupabaseReminderStore(),
      phoneHash,
    );
    if (result.keyword) await auditReminders("")({ action: "clinic.reminders.inbound", count: 1, actorRole: result.keyword });
    return new NextResponse(result.body || null, {
      status: result.status,
      headers: { "content-type": "text/xml", "cache-control": "private, no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
