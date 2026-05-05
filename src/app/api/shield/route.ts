import { NextRequest, NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { headers } from "next/headers";
import Anthropic from "@anthropic-ai/sdk";
import { getServiceClient } from "@/lib/supabase-server";
import { decryptJson } from "@/lib/crypto";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MODEL = "claude-haiku-4-5-20251001";
const SHIELD_VERSION = "5.0.0-shield-modes";
const MAX_TOKENS = 900;

const SAFE_FALLBACK =
  "CareIQ insights are temporarily unavailable. Your data remains encrypted and untouched. Please try again in a few minutes, or reach out to your FQHC care team for any urgent concern.";

const BLOCKED_FALLBACK =
  "Sovereign Shield blocked this request because it appears to contain personally identifying information (such as a Social Security number, phone number, date of birth, or other HIPAA identifier). Re-send your question without those details. Your patient data is already protected and never needs to be re-typed.";

interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
}

interface HistoryPlaintext {
  chronicConditions?: string[];
  medications?: string;
  allergies?: string;
  familyHistory?: string;
}

interface WearableSummary {
  device: string;
  metrics: Array<{
    date: string;
    heartRate?: number;
    steps?: number;
    sleepHours?: number;
    spo2?: number;
    calories?: number;
  }>;
}

/* ------------------------------------------------------------------------- */
/* Sovereign Shield v5: PII pattern detection                                */
/* ------------------------------------------------------------------------- */

type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

interface PiiFlag {
  type: string;
  severity: Severity;
  count: number;
  hipaaIdentifier?: number;
}

const SEVERITY_SCORE: Record<Severity, number> = {
  CRITICAL: 95,
  HIGH: 65,
  MEDIUM: 35,
  LOW: 0,
};

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

const PII_PATTERNS: Array<{ type: string; severity: Severity; pattern: RegExp }> = [
  { type: "ssn_formatted", severity: "CRITICAL", pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { type: "ssn_raw", severity: "CRITICAL", pattern: /(?<!\d)\d{9}(?!\d)/g },
  { type: "phone_formatted", severity: "HIGH", pattern: /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g },
  { type: "phone_raw", severity: "HIGH", pattern: /(?<!\d)\d{10}(?!\d)/g },
  { type: "dob", severity: "HIGH", pattern: /(?<!\d)(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})(?!\d)/g },
  { type: "email", severity: "HIGH", pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: "long_numeric", severity: "HIGH", pattern: /(?<!\d)\d{11,}(?!\d)/g },
  { type: "numeric_6_to_8", severity: "MEDIUM", pattern: /(?<!\d)\d{6,8}(?!\d)/g },
];

/* ------------------------------------------------------------------------- */
/* HIPAA Safe Harbor: 18-identifier scanner (second layer after Shield)      */
/* Reference: 45 CFR 164.514(b)(2)(i)(A) through (R)                         */
/* ------------------------------------------------------------------------- */

const HIPAA_PATTERNS: Array<{
  hipaaIdentifier: number;
  type: string;
  severity: Severity;
  pattern: RegExp;
}> = [
  // (A) Names
  { hipaaIdentifier: 1, type: "hipaa_name_title", severity: "HIGH",
    pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof|Rev)\.?\s+[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30})?\b/g },
  // (B) Geographic subdivisions smaller than state
  { hipaaIdentifier: 2, type: "hipaa_us_zip", severity: "MEDIUM",
    pattern: /\b\d{5}(?:-\d{4})?\b/g },
  { hipaaIdentifier: 2, type: "hipaa_street_address", severity: "HIGH",
    pattern: /\b\d{1,5}\s+[A-Z][A-Za-z]{1,30}(?:\s+[A-Z][A-Za-z]{1,30})?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Ter|Terrace|Hwy|Highway|Pkwy|Parkway)\.?\b/gi },
  // (C) Dates (other than year) directly related to individual
  { hipaaIdentifier: 3, type: "hipaa_specific_date", severity: "HIGH",
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b/gi },
  // (D) Phone numbers
  { hipaaIdentifier: 4, type: "hipaa_phone", severity: "HIGH",
    pattern: /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g },
  // (E) Fax numbers
  { hipaaIdentifier: 5, type: "hipaa_fax", severity: "HIGH",
    pattern: /\bfax\s*[:#]?\s*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi },
  // (F) Email
  { hipaaIdentifier: 6, type: "hipaa_email", severity: "HIGH",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // (G) SSN
  { hipaaIdentifier: 7, type: "hipaa_ssn", severity: "CRITICAL",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  // (H) Medical record numbers
  { hipaaIdentifier: 8, type: "hipaa_mrn", severity: "CRITICAL",
    pattern: /\b(?:MRN|Medical\s+Record(?:\s+Number)?|Patient\s+ID|Chart\s+No\.?)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  // (I) Health plan beneficiary numbers
  { hipaaIdentifier: 9, type: "hipaa_health_plan_id", severity: "CRITICAL",
    pattern: /\b(?:Member\s+ID|Policy\s+(?:No\.?|Number)|Plan\s+ID|Group\s+(?:No\.?|Number))\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  // (J) Account numbers
  { hipaaIdentifier: 10, type: "hipaa_account_number", severity: "HIGH",
    pattern: /\b(?:Account|Acct\.?)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi },
  // (K) Certificate / license numbers
  { hipaaIdentifier: 11, type: "hipaa_license_number", severity: "HIGH",
    pattern: /\b(?:License|Lic\.?|Cert\.?|Certificate|DEA)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  // (L) Vehicle identifiers (VIN + license plate heuristic)
  { hipaaIdentifier: 12, type: "hipaa_vin", severity: "HIGH",
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g },
  { hipaaIdentifier: 12, type: "hipaa_plate", severity: "MEDIUM",
    pattern: /\b(?:plate|license\s+plate)\s*[:#]?\s*[A-Z0-9]{2,3}[-\s]?[A-Z0-9]{3,5}\b/gi },
  // (M) Device identifiers / serial numbers
  { hipaaIdentifier: 13, type: "hipaa_device_serial", severity: "MEDIUM",
    pattern: /\b(?:S\/N|SN|Serial(?:\s+(?:No\.?|Number))?|Device\s+ID)\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi },
  // (N) Web URLs
  { hipaaIdentifier: 14, type: "hipaa_url", severity: "LOW",
    pattern: /\bhttps?:\/\/[^\s<>"']+/g },
  // (O) IP addresses (IPv4 + IPv6)
  { hipaaIdentifier: 15, type: "hipaa_ipv4", severity: "MEDIUM",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g },
  { hipaaIdentifier: 15, type: "hipaa_ipv6", severity: "MEDIUM",
    pattern: /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g },
  // (P) Biometric identifier hints (textual references)
  { hipaaIdentifier: 16, type: "hipaa_biometric_ref", severity: "MEDIUM",
    pattern: /\b(?:fingerprint|retina(?:l)?\s+scan|iris\s+scan|voiceprint|gait\s+pattern|facial\s+template)\b/gi },
  // (Q) Photographic image hints
  { hipaaIdentifier: 17, type: "hipaa_photo_ref", severity: "MEDIUM",
    pattern: /\b(?:full[-\s]face\s+(?:photo|photograph|image)|patient\s+photo)\b/gi },
  // (R) Any other unique identifying number / characteristic / code
  { hipaaIdentifier: 18, type: "hipaa_generic_uid", severity: "MEDIUM",
    pattern: /\b(?:UID|Unique\s+ID|Patient\s+Code|Beneficiary\s+Code)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
];

function detectHipaa(text: string): PiiFlag[] {
  if (!text || typeof text !== "string") return [];
  const out: PiiFlag[] = [];
  for (const rule of HIPAA_PATTERNS) {
    const matches = text.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    out.push({
      type: rule.type,
      severity: rule.severity,
      count: matches.length,
      hipaaIdentifier: rule.hipaaIdentifier,
    });
  }
  return out;
}

function detectPii(text: string): { flags: PiiFlag[]; severity: Severity; score: number } {
  if (!text || typeof text !== "string") {
    return { flags: [], severity: "LOW", score: 0 };
  }
  const flags: PiiFlag[] = [];
  let topSeverity: Severity = "LOW";
  let score = 0;
  for (const rule of PII_PATTERNS) {
    const matches = text.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    flags.push({ type: rule.type, severity: rule.severity, count: matches.length });
    if (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[topSeverity]) {
      topSeverity = rule.severity;
    }
    score += SEVERITY_SCORE[rule.severity] * matches.length;
  }
  // Second layer: HIPAA Safe Harbor scanner.
  const hipaaFlags = detectHipaa(text);
  for (const f of hipaaFlags) {
    flags.push(f);
    if (SEVERITY_RANK[f.severity] > SEVERITY_RANK[topSeverity]) {
      topSeverity = f.severity;
    }
    score += SEVERITY_SCORE[f.severity] * f.count;
  }
  return { flags, severity: topSeverity, score: Math.min(100, score) };
}

function actionFor(severity: Severity): "block" | "anonymize" | "warn" | "allow" {
  switch (severity) {
    case "CRITICAL": return "block";
    case "HIGH":     return "anonymize";
    case "MEDIUM":   return "warn";
    default:         return "allow";
  }
}

function shieldResponseFields(
  detection: { flags: PiiFlag[]; severity: Severity; score: number },
) {
  const hipaaFlags = detection.flags.filter((f) => typeof f.hipaaIdentifier === "number");
  return {
    flags: detection.flags,
    pii_detected: detection.flags,
    hipaa_flags: hipaaFlags,
    hipaaIdentifiersTriggered: Array.from(
      new Set(hipaaFlags.map((f) => f.hipaaIdentifier as number)),
    ).sort((a, b) => a - b),
    flagCount: detection.flags.length,
    serverRiskScore: detection.score,
    riskLevel: detection.severity,
    action: actionFor(detection.severity),
  };
}

/* ------------------------------------------------------------------------- */
/* Mode-specific prompts                                                     */
/* ------------------------------------------------------------------------- */

type Mode = "insight" | "workout" | "meal_plan" | "narrative";

const SYSTEM_INSIGHT = [
  "You are CareIQ, the clinical AI for community health centers and the safety net.",
  "All inputs are anonymized: any name token is COMMUNITY_PATIENT, locales are COMMUNITY_LOCATION.",
  "Never invent identifying details. Speak in calm, plain language.",
  "Provide a 3 to 5 sentence summary covering: cardiovascular signals, metabolic signals,",
  "sleep and recovery, and one gentle next step. Never give emergency advice.",
  "If anything is concerning, recommend reaching out to the FQHC care team.",
  "Do not use em dashes.",
].join(" ");

const SYSTEM_WORKOUT = [
  "You are a clinical exercise specialist for CareIQ, serving FQHC and community health populations.",
  "All inputs are anonymized: any name token is COMMUNITY_PATIENT, locales are COMMUNITY_LOCATION.",
  "Given the anonymized patient context, write a safe, personalized one-day workout plan",
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
  "All inputs are anonymized: any name token is COMMUNITY_PATIENT, locales are COMMUNITY_LOCATION.",
  "Given the anonymized patient context, write a one-day meal plan built from heart-healthy, affordable, widely available community-health foods",
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
  "All inputs are anonymized: any name token is COMMUNITY_PATIENT, locales are COMMUNITY_LOCATION.",
  "Given the anonymized patient context (vitals, domain scores, conditions),",
  "write a 3 to 5 sentence plain-language paragraph explaining what these numbers mean for this patient specifically.",
  "Use calm, non-alarming language. Highlight what is going well and what needs attention.",
  "End with one practical next step the patient can take in the next week.",
  "Never give emergency advice. If anything is concerning, recommend reaching out to the FQHC care team.",
  "Do not use em dashes.",
].join(" ");

function systemFor(mode: Mode): string {
  switch (mode) {
    case "workout":   return SYSTEM_WORKOUT;
    case "meal_plan": return SYSTEM_MEAL_PLAN;
    case "narrative": return SYSTEM_NARRATIVE;
    default:          return SYSTEM_INSIGHT;
  }
}

function userInstructionFor(mode: Mode): string {
  switch (mode) {
    case "workout":   return "Generate today's workout plan for this patient.";
    case "meal_plan": return "Generate today's meal plan for this patient.";
    case "narrative": return "Explain what these numbers mean for this patient.";
    default:          return "Write the patient-facing health insight now in 3 to 5 sentences.";
  }
}

/* ------------------------------------------------------------------------- */
/* Client-supplied context                                                   */
/* ------------------------------------------------------------------------- */

interface ClientContext {
  patientAge?: number;
  vitals?: Array<{ name?: string; val?: string; unit?: string; status?: string }>;
  domains?: Array<{ name?: string; score?: number }>;
  conditions?: string[];
  communityAffiliation?: string;
}

function formatClientContext(ctx: ClientContext | null): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (typeof ctx.patientAge === "number" && ctx.patientAge > 0 && ctx.patientAge < 120) {
    const decade = Math.floor(ctx.patientAge / 10) * 10;
    lines.push(`Age range: ${decade}-${decade + 9}`);
  }
  if (ctx.communityAffiliation && ctx.communityAffiliation.trim().length > 0) {
    lines.push("Community: COMMUNITY_LOCATION");
  }
  if (Array.isArray(ctx.conditions) && ctx.conditions.length > 0) {
    const safe = ctx.conditions
      .map((c) => (typeof c === "string" ? c.replace(/[<>]/g, "").slice(0, 64) : ""))
      .filter(Boolean);
    if (safe.length > 0) lines.push("Conditions on file: " + safe.join(", "));
  }
  if (Array.isArray(ctx.vitals) && ctx.vitals.length > 0) {
    lines.push("Current vitals:");
    for (const v of ctx.vitals.slice(0, 12)) {
      const name = (v?.name || "").replace(/[<>]/g, "").slice(0, 48);
      const val = (v?.val || "").replace(/[<>]/g, "").slice(0, 24);
      const unit = (v?.unit || "").replace(/[<>]/g, "").slice(0, 16);
      const status = (v?.status || "").replace(/[<>]/g, "").slice(0, 16);
      if (name && val) lines.push(`  - ${name}: ${val}${unit ? " " + unit : ""}${status ? " (" + status + ")" : ""}`);
    }
  }
  if (Array.isArray(ctx.domains) && ctx.domains.length > 0) {
    lines.push("Risk domain scores (0-100, higher is healthier):");
    for (const d of ctx.domains.slice(0, 12)) {
      const name = (d?.name || "").replace(/[<>]/g, "").slice(0, 48);
      const score = typeof d?.score === "number" && d.score >= 0 && d.score <= 100 ? d.score : null;
      if (name && score !== null) lines.push(`  - ${name}: ${score}/100`);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------------- */
/* POST /api/shield                                                          */
/* ------------------------------------------------------------------------- */

export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  let prompt = "";
  let mode: Mode = "insight";
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
    await logAudit({
      sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "blocked_pii_critical" },
    });
    return NextResponse.json(
      {
        insight: BLOCKED_FALLBACK,
        ok: false,
        ...fields,
        meta: {
          shieldVersion: SHIELD_VERSION,
          mode,
          blocked: true,
        },
      },
      { status: 200 },
    );
  }

  const sb = getServiceClient();
  let profile: ProfilePlaintext | null = null;
  let history: HistoryPlaintext | null = null;
  let wearable: WearableSummary | null = null;
  try {
    const { data: pat } = await sb.from("patients").select("profile_encrypted").eq("id", session.patientId).maybeSingle();
    if (pat?.profile_encrypted) profile = decryptJson<ProfilePlaintext>(pat.profile_encrypted, `profile:${session.patientId}`);

    const { data: hh } = await sb.from("health_history").select("data_encrypted").eq("patient_id", session.patientId).maybeSingle();
    if (hh?.data_encrypted) history = decryptJson<HistoryPlaintext>(hh.data_encrypted, `history:${session.patientId}`);

    const { data: wd } = await sb.from("wearable_data").select("data_encrypted").eq("patient_id", session.patientId).order("uploaded_at", { ascending: false }).limit(1).maybeSingle();
    if (wd?.data_encrypted) {
      const parsed = decryptJson<{ device: string; metrics: WearableSummary["metrics"] }>(wd.data_encrypted, `wearable:${session.patientId}`);
      wearable = { device: parsed.device, metrics: parsed.metrics };
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[shield] decrypt threw:", (err as Error)?.message || err);
    await logAudit({
      sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "decrypt" },
    });
    return NextResponse.json({ insight: SAFE_FALLBACK, ok: false, ...fields, meta: { shieldVersion: SHIELD_VERSION, mode } }, { status: 200 });
  }

  const anon = anonymize({ profile, history, wearable });
  const clientContextBlock = formatClientContext(clientCtx);
  const combinedContext = [anon.summary, clientContextBlock].filter(Boolean).join("\n\n");
  const promptHash = sha256Hex(systemFor(mode) + "\n" + combinedContext);

  // Display name for de-anonymizing the LLM output. The prompt sent to
  // Anthropic always uses COMMUNITY_PATIENT as the name token (see
  // anonymize() above), so the model can echo it back. After generation
  // we replace COMMUNITY_PATIENT with the patient's actual first name
  // (and last name when present) from the decrypted profile so the
  // user-facing insight reads naturally. Falls back to "you" so the
  // placeholder token never leaks into the UI.
  const displayName =
    (((profile?.firstName || "").trim() + " " + (profile?.lastName || "").trim()).trim()) ||
    "you";

  const apiKey = (process.env.ANTHROPIC_API_KEY || "").trim();
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
    await logAudit({
      sessionId,
      action: "shield.unavailable",
      dataType: "ai_inference",
      success: false,
      metadata: { reason_code: "missing_token", anonymized_hash: promptHash },
    });
    return NextResponse.json({ insight: SAFE_FALLBACK, ok: false, ...fields, meta: { shieldVersion: SHIELD_VERSION, mode } }, { status: 200 });
  }

  await logAudit({
    sessionId,
    action: "shield.invoked",
    dataType: "ai_inference",
    success: true,
    metadata: {
      anonymized_hash: promptHash,
      shield_version: SHIELD_VERSION,
      model_id: MODEL,
    },
  });

  const client = new Anthropic({ apiKey });
  const start = Date.now();
  const userBody =
    "Patient context (anonymized):\n" +
    combinedContext +
    "\n\n" +
    userInstructionFor(mode);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        { type: "text", text: systemFor(mode), cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: userBody }],
    });

    let generated = "";
    for (const block of response.content) {
      if (block.type === "text") generated += block.text;
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
      await logAudit({
        sessionId,
        action: "shield.unavailable",
        dataType: "ai_inference",
        success: false,
        metadata: {
          reason_code: "empty_response",
          anonymized_hash: promptHash,
          duration_ms: Date.now() - start,
        },
      });
      return NextResponse.json({ insight: SAFE_FALLBACK, ok: false, ...fields, meta: { shieldVersion: SHIELD_VERSION, mode } }, { status: 200 });
    }

    generated = sanitizeOutput(generated);
    // De-anonymize for the user-facing surface only. The Anthropic prompt
    // already saw the COMMUNITY_PATIENT token; the patient's real name is
    // never sent to the model.
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

    return NextResponse.json(
      {
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
      },
      { status: 200 },
    );
  } catch (err) {
    let reason = "unknown";
    let status = 0;
    if (err instanceof Anthropic.AuthenticationError)      { reason = "auth_401";       status = err.status; }
    else if (err instanceof Anthropic.PermissionDeniedError) { reason = "permission_403"; status = err.status; }
    else if (err instanceof Anthropic.NotFoundError)         { reason = "not_found_404";  status = err.status; }
    else if (err instanceof Anthropic.RateLimitError)        { reason = "rate_limit_429"; status = err.status; }
    else if (err instanceof Anthropic.BadRequestError)       { reason = "bad_request_400";status = err.status; }
    else if (err instanceof Anthropic.APIError)              { reason = "api_" + err.status; status = err.status; }
    else if ((err as Error)?.name === "AbortError")          { reason = "timeout"; }
    else                                                      { reason = "network"; }

    // eslint-disable-next-line no-console
    console.error(
      "[shield] Anthropic error",
      JSON.stringify({
        mode,
        reason,
        status,
        name: (err as Error)?.name || "unknown",
        message: (err as Error)?.message || "unknown",
        duration_ms: Date.now() - start,
      }),
    );
    await logAudit({
      sessionId,
      action: "shield.failed",
      dataType: "ai_inference",
      success: false,
      metadata: {
        reason_code: reason,
        anonymized_hash: promptHash,
        duration_ms: Date.now() - start,
      },
    });
    return NextResponse.json({ insight: SAFE_FALLBACK, ok: false, ...fields, meta: { shieldVersion: SHIELD_VERSION, mode } }, { status: 200 });
  }
}

/* ------------------------------------------------------------------------- */
/* Anonymization                                                             */
/* ------------------------------------------------------------------------- */

interface AnonInputs {
  profile: ProfilePlaintext | null;
  history: HistoryPlaintext | null;
  wearable: WearableSummary | null;
}

function anonymize(input: AnonInputs): { summary: string; map: Record<string, string> } {
  const map: Record<string, string> = {};
  const lines: string[] = [];

  const dayOffset = randomInt(-365, 366);

  lines.push("Patient: COMMUNITY_PATIENT");
  if (input.profile?.dateOfBirth) {
    const decade = ageDecadeFromDob(input.profile.dateOfBirth);
    if (decade) lines.push(`Age range: ${decade}`);
  }
  if (input.profile?.communityAffiliation && input.profile.communityAffiliation.trim().length > 0) {
    lines.push("Community: COMMUNITY_LOCATION");
    map["community_affiliation"] = "COMMUNITY_LOCATION";
  }

  if (input.history?.chronicConditions && input.history.chronicConditions.length > 0) {
    lines.push("Chronic conditions: " + input.history.chronicConditions.join(", "));
  }
  if (input.history?.medications) {
    lines.push("Medications present: " + (input.history.medications.length > 0 ? "yes" : "no"));
  }
  if (input.history?.allergies) {
    lines.push("Allergies recorded: " + (input.history.allergies.length > 0 ? "yes" : "no"));
  }
  if (input.history?.familyHistory) {
    lines.push("Family history recorded: " + (input.history.familyHistory.length > 0 ? "yes" : "no"));
  }

  if (input.wearable && input.wearable.metrics.length > 0) {
    const recent = input.wearable.metrics.slice(-7);
    lines.push("Wearable signal (anonymized, last week):");
    for (const m of recent) {
      const shifted = shiftIsoDate(m.date, dayOffset);
      const parts: string[] = [`day=${shifted}`];
      if (m.heartRate != null) parts.push(`hr=${m.heartRate}`);
      if (m.steps != null) parts.push(`steps=${m.steps}`);
      if (m.sleepHours != null) parts.push(`sleep_h=${m.sleepHours}`);
      if (m.spo2 != null) parts.push(`spo2=${m.spo2}`);
      if (m.calories != null) parts.push(`kcal=${m.calories}`);
      lines.push("  " + parts.join(" "));
    }
  }

  return { summary: lines.join("\n"), map };
}

function ageDecadeFromDob(dob: string): string | null {
  const d = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  const decadeStart = Math.floor(age / 10) * 10;
  return `${decadeStart}-${decadeStart + 9}`;
}

function shiftIsoDate(iso: string, dayOffset: number): string {
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return "REDACTED";
  d.setUTCDate(d.getUTCDate() + dayOffset);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

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
