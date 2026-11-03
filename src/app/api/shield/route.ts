import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "@/lib/supabase-server";
import { shieldAnthropic } from "@/lib/shield-anthropic";
import { decryptJson } from "@/lib/crypto";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import { assertTextOnlyModelPayload } from "@/lib/model-outbound";
import { isAiEnabled } from "@/lib/ai-flag";
import {
  aiOffBody,
  handleShieldPost,
  type ShieldModelRequest,
  type ShieldPatientRecord,
} from "@/lib/shield-handler";
import type { HistoryPlaintext, ProfilePlaintext, WearableSummary } from "@/lib/shield-redact";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function classifyError(err: unknown): { reason: string; status: number } {
  if (err instanceof Anthropic.AuthenticationError) return { reason: "auth_401", status: err.status };
  if (err instanceof Anthropic.PermissionDeniedError) return { reason: "permission_403", status: err.status };
  if (err instanceof Anthropic.NotFoundError) return { reason: "not_found_404", status: err.status };
  if (err instanceof Anthropic.RateLimitError) return { reason: "rate_limit_429", status: err.status };
  if (err instanceof Anthropic.BadRequestError) return { reason: "bad_request_400", status: err.status };
  if (err instanceof Anthropic.APIError) return { reason: "api_" + err.status, status: err.status };
  if ((err as Error)?.name === "AbortError") return { reason: "timeout", status: 0 };
  return { reason: "network", status: 0 };
}

async function loadPatient(patientId: string): Promise<ShieldPatientRecord> {
  const sb = getServiceClient();
  let profile: ProfilePlaintext | null = null;
  let history: HistoryPlaintext | null = null;
  let wearable: WearableSummary | null = null;

  const { data: pat } = await sb.from("patients").select("profile_encrypted").eq("id", patientId).maybeSingle();
  if (pat?.profile_encrypted) profile = decryptJson<ProfilePlaintext>(pat.profile_encrypted, `profile:${patientId}`);

  const { data: hh } = await sb.from("health_history").select("data_encrypted").eq("patient_id", patientId).maybeSingle();
  if (hh?.data_encrypted) history = decryptJson<HistoryPlaintext>(hh.data_encrypted, `history:${patientId}`);

  const { data: wd } = await sb.from("wearable_data").select("data_encrypted").eq("patient_id", patientId).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
  if (wd?.data_encrypted) {
    const parsed = decryptJson<{ device: string; metrics: WearableSummary["metrics"] }>(wd.data_encrypted, `wearable:${patientId}`);
    wearable = { device: parsed.device, metrics: parsed.metrics };
  }

  return { profile, history, wearable };
}

export async function POST(req: NextRequest) {
  if (!isAiEnabled()) {
    return NextResponse.json(aiOffBody());
  }

  const sessionId = headers().get("x-session-id") || "";
  const response = await handleShieldPost(req, {
    sessionId,
    readSession: () => {
      const session = readSession();
      return { patientId: session.patientId };
    },
    loadPatient,
    logAudit,
    getApiKey: () => process.env.ANTHROPIC_API_KEY || "",
    isAiEnabled: () => true,
    createMessage: async (body: ShieldModelRequest) => {
      // handleShieldPost already built this from Shield redaction.
      // Refuse document, image, and base64 attachments at the network edge.
      assertTextOnlyModelPayload(body);
      const client = shieldAnthropic.create((process.env.ANTHROPIC_API_KEY || "").trim());
      const result = await client.messages.create({
        model: body.model,
        max_tokens: body.max_tokens,
        system: body.system,
        messages: body.messages,
      });
      return {
        content: result.content.map((block) =>
          block.type === "text" ? { type: block.type, text: block.text } : { type: block.type },
        ),
        stop_reason: result.stop_reason,
        usage: {
          input_tokens: result.usage.input_tokens,
          output_tokens: result.usage.output_tokens,
          cache_read_input_tokens: result.usage.cache_read_input_tokens ?? null,
          cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? null,
        },
      };
    },
    classifyError,
  });
  const payload = await response.json();
  return NextResponse.json(payload, { status: response.status });
}
