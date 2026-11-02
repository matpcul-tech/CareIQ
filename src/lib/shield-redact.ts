/**
 * Deterministic identifier redaction for the Prompt Shield.
 * Patterns and allow-lists only. This is not a de-identification model.
 * A match reduces what can reach the model. It does not prove that every
 * possible identifier was found.
 */

import { randomInt } from "crypto";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PiiFlag {
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

/* Safe Harbor category patterns. Used to score, and (separately) to replace. */
const HIPAA_PATTERNS: Array<{
  hipaaIdentifier: number;
  type: string;
  severity: Severity;
  pattern: RegExp;
}> = [
  { hipaaIdentifier: 1, type: "hipaa_name_title", severity: "HIGH",
    pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof|Rev)\.?\s+[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30})?\b/g },
  { hipaaIdentifier: 2, type: "hipaa_us_zip", severity: "MEDIUM",
    pattern: /\b\d{5}(?:-\d{4})?\b/g },
  { hipaaIdentifier: 2, type: "hipaa_street_address", severity: "HIGH",
    pattern: /\b\d{1,5}\s+[A-Z][A-Za-z]{1,30}(?:\s+[A-Z][A-Za-z]{1,30})?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Ter|Terrace|Hwy|Highway|Pkwy|Parkway)\.?\b/gi },
  { hipaaIdentifier: 3, type: "hipaa_specific_date", severity: "HIGH",
    pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b/gi },
  { hipaaIdentifier: 4, type: "hipaa_phone", severity: "HIGH",
    pattern: /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g },
  { hipaaIdentifier: 5, type: "hipaa_fax", severity: "HIGH",
    pattern: /\bfax\s*[:#]?\s*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi },
  { hipaaIdentifier: 6, type: "hipaa_email", severity: "HIGH",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { hipaaIdentifier: 7, type: "hipaa_ssn", severity: "CRITICAL",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
  { hipaaIdentifier: 8, type: "hipaa_mrn", severity: "CRITICAL",
    pattern: /\b(?:MRN|Medical\s+Record(?:\s+Number)?|Patient\s+ID|Chart\s+No\.?)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  { hipaaIdentifier: 9, type: "hipaa_health_plan_id", severity: "CRITICAL",
    pattern: /\b(?:Member\s+ID|Policy\s+(?:No\.?|Number)|Plan\s+ID|Group\s+(?:No\.?|Number))\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  { hipaaIdentifier: 10, type: "hipaa_account_number", severity: "HIGH",
    pattern: /\b(?:Account|Acct\.?)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi },
  { hipaaIdentifier: 11, type: "hipaa_license_number", severity: "HIGH",
    pattern: /\b(?:License|Lic\.?|Cert\.?|Certificate|DEA)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
  { hipaaIdentifier: 12, type: "hipaa_vin", severity: "HIGH",
    pattern: /\b[A-HJ-NPR-Z0-9]{17}\b/g },
  { hipaaIdentifier: 12, type: "hipaa_plate", severity: "MEDIUM",
    pattern: /\b(?:plate|license\s+plate)\s*[:#]?\s*[A-Z0-9]{2,3}[-\s]?[A-Z0-9]{3,5}\b/gi },
  { hipaaIdentifier: 13, type: "hipaa_device_serial", severity: "MEDIUM",
    pattern: /\b(?:S\/N|SN|Serial(?:\s+(?:No\.?|Number))?|Device\s+ID)\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi },
  { hipaaIdentifier: 14, type: "hipaa_url", severity: "LOW",
    pattern: /\bhttps?:\/\/[^\s<>"']+/g },
  { hipaaIdentifier: 15, type: "hipaa_ipv4", severity: "MEDIUM",
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g },
  { hipaaIdentifier: 15, type: "hipaa_ipv6", severity: "MEDIUM",
    pattern: /\b(?:[A-Fa-f0-9]{1,4}:){7}[A-Fa-f0-9]{1,4}\b/g },
  { hipaaIdentifier: 16, type: "hipaa_biometric_ref", severity: "MEDIUM",
    pattern: /\b(?:fingerprint|retina(?:l)?\s+scan|iris\s+scan|voiceprint|gait\s+pattern|facial\s+template)\b/gi },
  { hipaaIdentifier: 17, type: "hipaa_photo_ref", severity: "MEDIUM",
    pattern: /\b(?:full[-\s]face\s+(?:photo|photograph|image)|patient\s+photo)\b/gi },
  { hipaaIdentifier: 18, type: "hipaa_generic_uid", severity: "MEDIUM",
    pattern: /\b(?:UID|Unique\s+ID|Patient\s+Code|Beneficiary\s+Code)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi },
];

export function detectHipaa(text: string): PiiFlag[] {
  if (!text || typeof text !== "string") return [];
  const out: PiiFlag[] = [];
  for (const rule of HIPAA_PATTERNS) {
    rule.pattern.lastIndex = 0;
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

export function detectPii(text: string): { flags: PiiFlag[]; severity: Severity; score: number } {
  if (!text || typeof text !== "string") {
    return { flags: [], severity: "LOW", score: 0 };
  }
  const flags: PiiFlag[] = [];
  let topSeverity: Severity = "LOW";
  let score = 0;
  for (const rule of PII_PATTERNS) {
    rule.pattern.lastIndex = 0;
    const matches = text.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    flags.push({ type: rule.type, severity: rule.severity, count: matches.length });
    if (SEVERITY_RANK[rule.severity] > SEVERITY_RANK[topSeverity]) {
      topSeverity = rule.severity;
    }
    score += SEVERITY_SCORE[rule.severity] * matches.length;
  }
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

export function actionFor(severity: Severity): "block" | "anonymize" | "warn" | "allow" {
  switch (severity) {
    case "CRITICAL": return "block";
    case "HIGH":     return "anonymize";
    case "MEDIUM":   return "warn";
    default:         return "allow";
  }
}

export function shieldResponseFields(
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

interface Replacement {
  pattern: RegExp;
  token: string;
  skipZip?: boolean;
  datesOnly?: boolean;
}

/**
 * Replacement patterns. Order is most specific first.
 * ZIP and calendar dates can be skipped on lines we built from numbers,
 * so a step count or a shifted wearable day is not eaten.
 */
function replacementRules(): Replacement[] {
  return [
    { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, token: "[EMAIL]" },
    { pattern: /\bhttps?:\/\/[^\s<>"']+/g, token: "[URL]" },
    { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, token: "[SSN]" },
    { pattern: /(?<!\d)(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?!\d)/g, token: "[PHONE]" },
    { pattern: /\bfax\s*[:#]?\s*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi, token: "[FAX]" },
    { pattern: /\b(?:MRN|Medical\s+Record(?:\s+Number)?|Patient\s+ID|Chart\s+No\.?)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi, token: "[MRN]" },
    { pattern: /\b(?:Member\s+ID|Policy\s+(?:No\.?|Number)|Plan\s+ID|Group\s+(?:No\.?|Number))\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi, token: "[PLAN_ID]" },
    { pattern: /\b(?:Account|Acct\.?)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi, token: "[ACCOUNT]" },
    { pattern: /\b(?:License|Lic\.?|Cert\.?|Certificate|DEA)\s*(?:No\.?|Number|#)?\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi, token: "[LICENSE]" },
    { pattern: /\b(?:S\/N|SN|Serial(?:\s+(?:No\.?|Number))?|Device\s+ID)\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi, token: "[DEVICE_ID]" },
    { pattern: /\b(?:UID|Unique\s+ID|Patient\s+Code|Beneficiary\s+Code)\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi, token: "[ID]" },
    { pattern: /\b(?:CDIB|tribal\s+(?:id|enrollment))\s*[:#-]?\s*[A-Z0-9-]{4,}\b/gi, token: "[ID]" },
    { pattern: /\bCDIB\s+[A-Z]{1,4}-\d{2,5}-\d{3,8}\b/gi, token: "[ID]" },
    { pattern: /\b\d{1,5}\s+[A-Z][A-Za-z]{1,30}(?:\s+[A-Z][A-Za-z]{1,30})?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place|Ter|Terrace|Hwy|Highway|Pkwy|Parkway)\.?\b/gi, token: "[ADDRESS]" },
    { pattern: /\b(?:Mr|Mrs|Ms|Dr|Prof|Rev)\.?\s+[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30})?\b/g, token: "[NAME]" },
    { pattern: /\bPatient\s+[A-Z][a-z]{1,30}(?:\s+[A-Z][a-z]{1,30})?\b/g, token: "[NAME]" },
    { pattern: /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{2,4})?\b/gi, token: "[DATE]", datesOnly: true },
    { pattern: /(?<!\d)(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})(?!\d)/g, token: "[DATE]", datesOnly: true },
    { pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g, token: "[IP]" },
    { pattern: /\b\d{5}(?:-\d{4})?\b/g, token: "[ZIP]", skipZip: true },
  ];
}

export interface RedactOptions {
  skipZip?: boolean;
  skipDates?: boolean;
}

export function redactIdentifiers(text: string, options: RedactOptions = {}): string {
  if (!text) return "";
  let out = text;
  for (const rule of replacementRules()) {
    if (options.skipZip && rule.skipZip) continue;
    if (options.skipDates && rule.datesOnly) continue;
    rule.pattern.lastIndex = 0;
    out = out.replace(rule.pattern, rule.token);
  }
  return out;
}

/** Words that are clinical labels. A stored given or family name that is only
 * one of these tokens is not stripped out of those labels. */
const CLINICAL_SAFE_WORDS = new Set<string>([
  "a1c", "active", "asthma", "blood", "body", "calories", "cancer", "cholesterol",
  "cognitive", "community", "copd", "diabetes", "disease", "dyslipidemia",
  "fasting", "glucose", "hdl", "health", "heart", "hrv", "hypertension", "kidney",
  "ldl", "mental", "metabolic", "obesity", "oncology", "oxygen", "patient",
  "prediabetes", "pressure", "range", "rate", "renal", "saturation", "sleep",
  "spo2", "steps", "type", "weight",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function replaceKnownNames(text: string, names: string[]): string {
  const cleaned = names
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n.length >= 2);
  const full = cleaned.filter((n) => n.includes(" "));
  const singles = cleaned.filter((n) => !n.includes(" ") && n.length >= 3);
  const ordered = [...full, ...singles].sort((a, b) => b.length - a.length);
  let out = text;
  const seen = new Set<string>();
  for (const name of ordered) {
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (!name.includes(" ") && CLINICAL_SAFE_WORDS.has(key)) continue;
    const pattern = new RegExp(`(?<![\\p{L}])${escapeRegExp(name).replace(/\s+/g, "\\s+")}(?![\\p{L}])`, "giu");
    out = out.replace(pattern, "[NAME]");
  }
  return out;
}

export function namesFromProfile(profile: { firstName?: string; lastName?: string } | null): string[] {
  if (!profile) return [];
  const first = (profile.firstName || "").trim();
  const last = (profile.lastName || "").trim();
  const names: string[] = [];
  if (first && last) names.push(`${first} ${last}`);
  if (first) names.push(first);
  if (last) names.push(last);
  return names;
}

function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_./]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CONDITION_LABELS: Record<string, string> = {
  "diabetes": "Type 2 diabetes",
  "type 2 diabetes": "Type 2 diabetes",
  "t2 diabetes": "Type 2 diabetes",
  "t2dm": "Type 2 diabetes",
  "hypertension": "Hypertension",
  "high blood pressure": "Hypertension",
  "heart disease": "Heart disease",
  "heart failure": "Heart failure",
  "obesity": "Obesity",
  "asthma": "Asthma",
  "kidney disease": "Kidney disease",
  "ckd": "Kidney disease",
  "ckd stage 3": "Kidney disease",
  "cancer": "Cancer",
  "other": "Other recorded condition",
  "prediabetes": "Prediabetes",
  "pre diabetes": "Prediabetes",
  "dyslipidemia": "Dyslipidemia",
  "copd": "COPD",
  "anxiety": "Anxiety",
  "osteoporosis": "Osteoporosis",
  "depression": "Depression",
};

const VITAL_LABELS: Record<string, string> = {
  "blood pressure": "Blood pressure",
  "bp": "Blood pressure",
  "glycemic": "A1C",
  "a1c": "A1C",
  "a1c glycemic": "A1C",
  "ldl chol": "LDL cholesterol",
  "ldl": "LDL cholesterol",
  "ldl cholesterol": "LDL cholesterol",
  "heart rate": "Heart rate",
  "resting hr": "Heart rate",
  "hr": "Heart rate",
  "oxygen sat": "Oxygen saturation",
  "spo2": "Oxygen saturation",
  "oxygen": "Oxygen saturation",
  "body weight": "Body weight",
  "weight": "Body weight",
  "steps": "Steps",
  "active cal": "Active calories",
  "active calories": "Active calories",
  "sleep": "Sleep",
  "hrv": "HRV",
  "fasting glucose": "Fasting glucose",
  "glucose": "Fasting glucose",
};

const UNIT_LABELS: Record<string, string> = {
  "mmhg": "mmHg",
  "a1c %": "%",
  "%": "%",
  "mg/dl": "mg/dL",
  "bpm": "bpm",
  "spo2 %": "%",
  "lbs": "lbs",
  "lb": "lbs",
  "ms": "ms",
  "kcal": "kcal",
  "today": "today",
  "last night": "last night",
  "mg/l": "mg/L",
  "ml/min": "mL/min",
};

const DOMAIN_LABELS: Record<string, string> = {
  "metabolic": "Metabolic",
  "cardiovascular": "Cardiovascular",
  "cognitive": "Cognitive",
  "oncology": "Oncology",
  "renal": "Renal",
  "mental health": "Mental Health",
};

const STATUS_LABELS = new Set(["ok", "warn", "alert", "suboptimal", "outside_normal", "unknown"]);

const SAFE_MEASUREMENT = /^(?:[<>]=?\s*)?\d{1,6}(?:,\d{3})*(?:\.\d+)?(?:\s*\/\s*\d{1,3}(?:\.\d+)?)?$/;
const SAFE_DURATION = /^\d{1,2}h(?:\s*\d{1,2}m)?$/i;

export function allowListedConditions(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const label = CONDITION_LABELS[normalizeLabel(raw)];
    if (!label || seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

function allowListedUnit(raw: string): string | null {
  const key = raw.toLowerCase().replace(/\s+/g, " ").trim();
  return UNIT_LABELS[key] ?? null;
}

export interface ClientContext {
  patientAge?: number;
  vitals?: Array<{ name?: string; val?: string; unit?: string; status?: string }>;
  domains?: Array<{ name?: string; score?: number }>;
  conditions?: string[];
  communityAffiliation?: string;
}

export function formatClientContext(ctx: ClientContext | null): string {
  if (!ctx) return "";
  const lines: string[] = [];
  if (typeof ctx.patientAge === "number" && ctx.patientAge > 0 && ctx.patientAge < 120) {
    const decade = Math.floor(ctx.patientAge / 10) * 10;
    lines.push(`Age range: ${decade}-${decade + 9}`);
  }
  if (ctx.communityAffiliation && ctx.communityAffiliation.trim().length > 0) {
    lines.push("Community: COMMUNITY_LOCATION");
  }
  const conditions = allowListedConditions(ctx.conditions);
  if (conditions.length > 0) {
    lines.push("Conditions on file: " + conditions.join(", "));
  }
  if (Array.isArray(ctx.vitals) && ctx.vitals.length > 0) {
    const vitalLines: string[] = [];
    for (const v of ctx.vitals.slice(0, 12)) {
      const name = VITAL_LABELS[normalizeLabel(String(v?.name || ""))];
      const rawVal = String(v?.val || "").trim();
      const valueOk = SAFE_MEASUREMENT.test(rawVal) || SAFE_DURATION.test(rawVal);
      if (!name || !valueOk) continue;
      const unit = allowListedUnit(String(v?.unit || ""));
      const statusKey = normalizeLabel(String(v?.status || "")).replace(/\s+/g, "_");
      const status = STATUS_LABELS.has(statusKey) ? statusKey : "";
      vitalLines.push(
        `  - ${name}: ${rawVal}${unit ? " " + unit : ""}${status ? " (" + status + ")" : ""}`,
      );
    }
    if (vitalLines.length > 0) {
      lines.push("Current vitals:");
      lines.push(...vitalLines);
    }
  }
  if (Array.isArray(ctx.domains) && ctx.domains.length > 0) {
    const domainLines: string[] = [];
    for (const d of ctx.domains.slice(0, 12)) {
      const name = DOMAIN_LABELS[normalizeLabel(String(d?.name || ""))];
      const score = typeof d?.score === "number" && d.score >= 0 && d.score <= 100 ? d.score : null;
      if (!name || score === null) continue;
      domainLines.push(`  - ${name}: ${score}/100`);
    }
    if (domainLines.length > 0) {
      lines.push("Risk domain scores (0-100, higher is healthier):");
      lines.push(...domainLines);
    }
  }
  return lines.join("\n");
}

export interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
}

export interface HistoryPlaintext {
  chronicConditions?: string[];
  medications?: string;
  allergies?: string;
  familyHistory?: string;
}

export interface WearableSummary {
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

export interface AnonInputs {
  profile: ProfilePlaintext | null;
  history: HistoryPlaintext | null;
  wearable: WearableSummary | null;
}

export function anonymize(input: AnonInputs): { summary: string } {
  const lines: string[] = [];
  let dayOffset = randomInt(-365, 365);
  if (dayOffset >= 0) dayOffset += 1;

  lines.push("Patient: COMMUNITY_PATIENT");
  if (input.profile?.dateOfBirth) {
    const decade = ageDecadeFromDob(input.profile.dateOfBirth);
    if (decade) lines.push(`Age range: ${decade}`);
  }
  if (input.profile?.communityAffiliation && input.profile.communityAffiliation.trim().length > 0) {
    lines.push("Community: COMMUNITY_LOCATION");
  }

  const conditions = allowListedConditions(input.history?.chronicConditions);
  if (conditions.length > 0) {
    lines.push("Chronic conditions: " + conditions.join(", "));
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
    lines.push("Wearable signal (dates shifted, last week):");
    for (const m of recent) {
      const shifted = shiftIsoDate(m.date, dayOffset);
      const parts: string[] = [`day=${shifted}`];
      if (typeof m.heartRate === "number" && Number.isFinite(m.heartRate)) parts.push(`hr=${m.heartRate}`);
      if (typeof m.steps === "number" && Number.isFinite(m.steps)) parts.push(`steps=${m.steps}`);
      if (typeof m.sleepHours === "number" && Number.isFinite(m.sleepHours)) parts.push(`sleep_h=${m.sleepHours}`);
      if (typeof m.spo2 === "number" && Number.isFinite(m.spo2)) parts.push(`spo2=${m.spo2}`);
      if (typeof m.calories === "number" && Number.isFinite(m.calories)) parts.push(`kcal=${m.calories}`);
      lines.push("  " + parts.join(" "));
    }
  }

  return { summary: lines.join("\n") };
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

export function scrubOutboundText(text: string, knownNames: string[]): string {
  const named = replaceKnownNames(text, knownNames);
  return named
    .split("\n")
    .map((line) => {
      const wearable = /^\s*day=/.test(line) || /^\s+day=/.test(line);
      const measurement = /^\s+-\s/.test(line) || /^Age range:/.test(line);
      return redactIdentifiers(line, {
        skipZip: wearable || measurement,
        skipDates: wearable,
      });
    })
    .join("\n");
}

export type ShieldMode = "insight" | "workout" | "meal_plan" | "narrative";

function userInstructionFor(mode: ShieldMode): string {
  switch (mode) {
    case "workout":   return "Generate today's workout plan for this patient.";
    case "meal_plan": return "Generate today's meal plan for this patient.";
    case "narrative": return "Explain what these numbers mean for this patient.";
    default:          return "Write the patient-facing health insight now in 3 to 5 sentences.";
  }
}

export function buildShieldUserContent(input: {
  profile: ProfilePlaintext | null;
  history: HistoryPlaintext | null;
  wearable: WearableSummary | null;
  clientCtx: ClientContext | null;
  mode: ShieldMode;
}): string {
  const anon = anonymize({
    profile: input.profile,
    history: input.history,
    wearable: input.wearable,
  });
  const clientContextBlock = formatClientContext(input.clientCtx);
  const combined = scrubOutboundText(
    [anon.summary, clientContextBlock].filter(Boolean).join("\n\n"),
    namesFromProfile(input.profile),
  );
  return (
    "Patient context (reduced):\n" +
    combined +
    "\n\n" +
    userInstructionFor(input.mode)
  );
}
