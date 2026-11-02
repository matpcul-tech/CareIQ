/**
 * Prompt Shield request handler. The Next.js route wires real session,
 * decrypt, audit, and Anthropic calls. Tests call this with stubs.
 * The typed question is scanned and is not copied into the model payload.
 * CRITICAL still blocks before any model call.
 */

import { createHash } from "crypto";
import {
  buildShieldUserContent,
  type ClientContext,
  detectPii,
  type HistoryPlaintext,
  type ProfilePlaintext,
  type Severity,
  shieldResponseFields,
  type ShieldMode,
  type WearableSummary,
} from "./shield-redact";

export const MODEL = "claude-haiku-4-5-20251001";
export const SHIELD_VERSION = "5.1.0-redact-allowlist";
const MAX_TOKENS = 900;

const SAFE_FALLBACK =
  "CareIQ insights are temporarily unavailable. Your data remains encrypted and untouched. Please try again in a few minutes, or reach out to your FQHC care team for any urgent concern.";

const BLOCKED_FALLBACK =
  "Sovereign Shield blocked this request because it appears to contain personally identifying information (such as a Social Security number, phone number, date of birth, or other HIPAA identifier). Re-send your question without those details. Your patient data is already protected and never needs to be re-typed.";

const REDUCED_INPUT =
  "The name token is COMMUNITY_PATIENT and locales are COMMUNITY_LOCATION. Do not invent identifiers.";

const SYSTEM_INSIGHT = [
  "You are CareIQ, the clinical AI for community health centers and the safety net.",
  REDUCED_INPUT,
  "Never invent identifying details. Speak in calm, plain language.",
  "Provide a 3 to 5 sentence summary covering: cardiovascular signals, metabolic signals,",
  "sleep and recovery, and one gentle next step. Never give emergency advice.",
  "If anything is concerning, recommend reaching out to the FQHC care team.",
  "Do not use em dashes.",
].join(" ");

const SYSTEM_WORKOUT = [
  "You are a clinical exercise specialist for CareIQ, serving FQHC and community health populations.",
  REDUCED_INPUT,
  "Given the reduced patient context, write a safe, personalized one-day workout plan",
  "tailored to the patient's age, conditions, and current vitals.",
  "The plan MUST be safe for any listed chronic conditions: avoid maximal-intensity intervals or heavy Valsalva-loaded lifting if hypertension is present;",
  "favor moderate steady-state cardio, mobility work, and submaximal resistance instead.",
  "Format the response as three short labelled blocks: Warm-up (1 to 2 sentences), Main work (3 to 4 specific exercises with sets, reps, or duration),",
  "and Cool-down (1 sentence). Total length 6 to 8 sentences.",
  "Never give emergency advice. End with one line telling the patient to contact the FQHC care team if anything feels off.",
  "Do not use em dashes.",
].join(" ");

const SYSTEM_MEAL_PLAN = [
  "You are a clinical nutritionist for CareIQ, serving FQHC and community health populations.",
  REDUCED_INPUT,
  "Given the reduced patient context, write a one-day meal plan built from heart-healthy, affordable, widely available community-health foods",
  "(oatmeal, brown rice, quinoa, barley, black beans, lentils, chickpeas, leafy greens such as spinach kale and collards, sweet potatoes, tomatoes, peppers, berries, citrus, baked fish such as salmon or sardines, skinless chicken, tofu, olive oil, avocado, nuts, seeds, low-sodium broth)",
  "with simple preparation suitable for a household kitchen.",
  "Address the patient's listed conditions: lower sodium for hypertension, lower glycemic load for prediabetes or diabetes, lean protein and fiber for cardiovascular concerns.",
  "Format as three labelled lines, exactly: Breakfast: ..., Lunch: ..., Dinner: ...",
  "Each line should describe the dish in one sentence and call out the clinical rationale.",
  "Never give emergency advice.",
  "Do not use em dashes.",
].join(" ");

const SYSTEM_NARRATIVE = [
  "You are CareIQ, the clinical AI for community health centers and the safety net.",
  REDUCED_INPUT,
  "Given the reduced patient context (vitals, domain scores, conditions),",
  "write a 3 to 5 sentence plain-language paragraph explaining what these numbers mean for this patient specifically.",
  "Use calm, non-alarming language. Highlight what is going well and what needs attention.",
  "End with one practical next step the patient can take in the next week.",
  "Never give emergency advice. If anything is concerning, recommend reaching out to the FQHC care team.",
  "Do not use em dashes.",
].join(" ");

function systemFor(mode: ShieldMode): string {
  switch (mode) {
    case "workout":   return SYSTEM_WORKOUT;
    case "meal_plan": return SYSTEM_MEAL_PLAN;
    case "narrative": return SYSTEM_NARRATIVE;
    default:          return SYSTEM_INSIGHT;
  }
}

export interface ShieldPatientRecord {
  profile: ProfilePlaintext | null;
  history: HistoryPlaintext | null;
  wearable: WearableSummary | null;
}

export interface ShieldAuditEntry {
  sessionId: string;
  action: "shield.failed" | "shield.unavailable" | "shield.invoked";
  dataType: "ai_inference";
  success: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ShieldModelRequest {
  model: string;
  max_tokens: number;
  system: Array<{ type: "text"; text: string; cache_control: { type: "ephemeral" } }>;
  messages: Array<{ role: "user"; content: string }>;
}

export interface ShieldModelResponse {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
}

export interface ShieldDeps {
  sessionId: string;
  readSession: () => { patientId: string | null };
  loadPatient: (patientId: string) => Promise<ShieldPatientRecord>;
  logAudit: (entry: ShieldAuditEntry) => Promise<void>;
  getApiKey: () => string;
  createMessage: (body: ShieldModelRequest) => Promise<ShieldModelResponse>;
  classifyError?: (err: unknown) => { reason: string; status: number };
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const CONTROL_CHARS = new RegExp("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]", "g");
const EM_DASH_RE = new RegExp("\\u2014", "g");

function sanitizeOutput(text: string): string {
  return text
    .replace(EM_DASH_RE, ",")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, 4000);
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function handleShieldPost(req: Request, deps: ShieldDeps): Promise<Response> {
  const session = deps.readSession();
  if (!session.patientId) {
    return json({ error: "authentication required" }, 401);
  }

  let prompt = "";
  let mode: ShieldMode = "insight";
  let clientCtx: ClientContext | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.prompt === "string") prompt = body.prompt;
    if (typeof body?.mode === "string") {
      const m = body.mode;
      if (m === "workout" || m === "meal_plan" || m === "narrative" || m === "insight") {
        mode = m;
      }
    }
    if (body?.context && typeof body.context === "object") {
      clientCtx = body.context as ClientContext;
    }
  } catch {
    // Fall through with defaults.
  }

  const ctxString = clientCtx ? JSON.stringify(clientCtx) : "";
  const promptDetection = detectPii(prompt);
  const contextDetection = detectPii(ctxString);
  const combinedSeverity: Severity =
    SEVERITY_RANK[promptDetection.severity] >= SEVERITY_RANK[contextDetection.severity]
      ? promptDetection.severity
      : contextDetection.severity;
  const detection = {
    flags: [...promptDetection.flags, ...contextDetection.flags],
    severity: combinedSeverity,
    score: Math.min(100, promptDetection.score + contextDetection.score),
  };
  const fields = shieldResponseFields(detection);

  // eslint-disable-next-line no-console
  console.log(
    "[shield] pii_scan",
    JSON.stringify({
      mode,
      hasPrompt: prompt.length > 0,
      promptChars: prompt.length,
      hasContext: Boolean(clientCtx),
      contextChars: ctxString.length,
      severity: detection.severity,
      score: detection.score,
      action: fields.action,
      flagCount: fields.flagCount,
      flags: detection.flags,
      hipaaIdentifiersTriggered: fields.hipaaIdentifiersTriggered,
    }),
  );

  if (detection.severity === "CRITICAL") {
    await deps.logAudit({
      sessionId: deps.sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "blocked_pii_critical" },
    });
    return json({
      insight: BLOCKED_FALLBACK,
      ok: false,
      ...fields,
      meta: {
        shieldVersion: SHIELD_VERSION,
        mode,
        blocked: true,
      },
    });
  }

  let record: ShieldPatientRecord;
  try {
    record = await deps.loadPatient(session.patientId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[shield] decrypt threw:", (err as Error)?.message || err);
    await deps.logAudit({
      sessionId: deps.sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "decrypt" },
    });
    return json({
      insight: SAFE_FALLBACK,
      ok: false,
      ...fields,
      meta: { shieldVersion: SHIELD_VERSION, mode },
    });
  }

  const userBody = buildShieldUserContent({
    profile: record.profile,
    history: record.history,
    wearable: record.wearable,
    clientCtx,
    mode,
  });
  const promptHash = sha256Hex(systemFor(mode) + "\n" + userBody);

  const displayName =
    (((record.profile?.firstName || "").trim() + " " + (record.profile?.lastName || "").trim()).trim()) ||
    "you";

  const apiKey = deps.getApiKey().trim();
  const keyPrefix10 = apiKey.slice(0, 10);

  // eslint-disable-next-line no-console
  console.log(
    "[shield] config",
    JSON.stringify({
      provider: "anthropic",
      model: MODEL,
      mode,
      hasKey: Boolean(apiKey),
      keyLength: apiKey.length,
      keyPrefix10,
      keyPrefixOk: keyPrefix10.startsWith("sk-ant-"),
      shieldVersion: SHIELD_VERSION,
      promptHash,
    }),
  );

  if (!apiKey) {
    // eslint-disable-next-line no-console
    console.error("[shield] ANTHROPIC_API_KEY is not set in this environment");
    await deps.logAudit({
      sessionId: deps.sessionId,
      action: "shield.unavailable",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "missing_token", anonymized_hash: promptHash },
    });
    return json({
      insight: SAFE_FALLBACK,
      ok: false,
      ...fields,
      meta: { shieldVersion: SHIELD_VERSION, mode },
    });
  }

  await deps.logAudit({
    sessionId: deps.sessionId,
    action: "shield.invoked",
    dataType: "ai_inference",
    success: true,
    metadata: {
      anonymized_hash: promptHash,
      shield_version: SHIELD_VERSION,
      model_id: MODEL,
    },
  });

  const modelRequest: ShieldModelRequest = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: [
      { type: "text", text: systemFor(mode), cache_control: { type: "ephemeral" } },
    ],
    messages: [{ role: "user", content: userBody }],
  };

  const start = Date.now();
  try {
    const response = await deps.createMessage(modelRequest);

    let generated = "";
    for (const block of response.content) {
      if (block.type === "text" && typeof block.text === "string") generated += block.text;
    }

    if (!generated.trim()) {
      // eslint-disable-next-line no-console
      console.error(
        "[shield] Anthropic returned no text",
        JSON.stringify({
          mode,
          stop_reason: response.stop_reason,
          content_types: response.content.map((b) => b.type),
          duration_ms: Date.now() - start,
        }),
      );
      await deps.logAudit({
        sessionId: deps.sessionId,
        action: "shield.unavailable",
        dataType: "ai_inference",
        success: false,
        metadata: {
          reason_code: "empty_response",
          anonymized_hash: promptHash,
          duration_ms: Date.now() - start,
        },
      });
      return json({
        insight: SAFE_FALLBACK,
        ok: false,
        ...fields,
        meta: { shieldVersion: SHIELD_VERSION, mode },
      });
    }

    generated = sanitizeOutput(generated);
    generated = generated.replace(/COMMUNITY_PATIENT/g, displayName);

    // eslint-disable-next-line no-console
    console.log(
      "[shield] ok",
      JSON.stringify({
        mode,
        duration_ms: Date.now() - start,
        chars: generated.length,
        stop_reason: response.stop_reason,
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
        cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
      }),
    );

    return json({
      insight: generated,
      ok: true,
      ...fields,
      meta: {
        shieldVersion: SHIELD_VERSION,
        mode,
        anonymizedHash: promptHash,
        model: MODEL,
        duration_ms: Date.now() - start,
      },
    });
  } catch (err) {
    const classified = deps.classifyError
      ? deps.classifyError(err)
      : { reason: "network", status: 0 };
    // eslint-disable-next-line no-console
    console.error(
      "[shield] Anthropic error",
      JSON.stringify({
        mode,
        reason: classified.reason,
        status: classified.status,
        name: (err as Error)?.name || "unknown",
        message: (err as Error)?.message || "unknown",
        duration_ms: Date.now() - start,
      }),
    );
    await deps.logAudit({
      sessionId: deps.sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: {
        reason_code: classified.reason,
        anonymized_hash: promptHash,
        duration_ms: Date.now() - start,
      },
    });
    return json({
      insight: SAFE_FALLBACK,
      ok: false,
      ...fields,
      meta: { shieldVersion: SHIELD_VERSION, mode },
    });
  }
}
