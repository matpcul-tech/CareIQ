import { NextRequest, NextResponse } from "next/server";
import { SupabaseClinicStore } from "@/lib/clinic/supabase-store";
import { handleWellnessInbound } from "@/lib/clinic/twilio-inbound";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  try {
    const result = await handleWellnessInbound(
      {
        url: req.url,
        webhookUrl: process.env.TWILIO_WEBHOOK_URL || "",
        signature: req.headers.get("x-twilio-signature") || "",
        rawBody,
        authToken: process.env.TWILIO_AUTH_TOKEN || "",
        at: new Date().toISOString(),
      },
      new SupabaseClinicStore(),
    );
    return new NextResponse(result.body || null, {
      status: result.status,
      headers: { "cache-control": "private, no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}
