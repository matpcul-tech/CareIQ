import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { decryptJson, sha256Hex } from "@/lib/crypto";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";
import {
  BIOMARKER_SPECS,
  computeStatus,
  computeTrend,
  getThresholds,
  type BiomarkerCategory,
  type BiomarkerSpec,
  type BiomarkerStatus,
  type BiomarkerTrend,
  type Sex,
} from "@/lib/biomarker-ranges";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SHIELD_VERSION = "v5";

// Demo wearable fallback (set SHIELD_DEMO_WEARABLE=true on Vercel).
const DEMO_WEARABLE_ENABLED = process.env.SHIELD_DEMO_WEARABLE === "true";
const DEMO_WEARABLE: DailyMetric = {
  date: new Date().toISOString().slice(0, 10),
  heartRate: 62,
  steps: 8540,
  sleepHours: 7.4,
  spo2: 97,
  calories: 2090,
  hrv: 58,
  activeCalories: 540,
};

// Demo plan generation (set SHIELD_DEMO_PLANS=true on Vercel). Generates
// a workout + nutrition plan tailored to the patient's current biomarker
// values; plans are flagged is_demo:true so the UI labels them clearly.
const DEMO_PLANS_ENABLED = process.env.SHIELD_DEMO_PLANS === "true";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function bad(message: string, status = 400, debug?: unknown) {
  const body: Record<string, unknown> = { error: message };
  if (debug !== undefined) body.debug = debug;
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

type Source = "lab" | "wearable" | "self_reported";

interface BiomarkerEntryStored {
  value?: number | null;
  date_collected?: string;
  source?: Source;
}

interface ManualLabs {
  a1c?: number;
  ldl?: number;
  hdl?: number;
  totalCholesterol?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
  crp?: number;
  hsCrp?: number;
  hs_crp?: number;
}

interface BiomarkerBlob {
  [key: string]: BiomarkerEntryStored | undefined;
}

interface HistoryPlaintext {
  manualLabs?: ManualLabs;
  biomarkers?: BiomarkerBlob;
}

interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
  sex?: Sex;
}

interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
  hrv?: number;
  activeCalories?: number;
}

interface WearablePlaintext {
  device: string;
  metrics: DailyMetric[];
}

type RangeStatus = "ok" | "warn" | "alert" | "none";

function bpStatus(sys: number | null, dia: number | null): RangeStatus {
  if (sys === null && dia === null) return "none";
  if ((sys ?? 0) >= 140 || (dia ?? 0) >= 90) return "alert";
  if ((sys ?? 0) >= 130 || (dia ?? 0) >= 80) return "warn";
  return "ok";
}

function calculateRiskScore(labs: ManualLabs, latest: DailyMetric | null): number {
  let score = 85;
  if (labs.a1c != null) {
    if (labs.a1c >= 6.5) score -= 8;
    else if (labs.a1c >= 5.7) score -= 4;
  }
  if (labs.ldl != null) {
    if (labs.ldl >= 190) score -= 8;
    else if (labs.ldl >= 130) score -= 4;
  }
  if (labs.bpSystolic != null) {
    if (labs.bpSystolic >= 140 || (labs.bpDiastolic != null && labs.bpDiastolic >= 90)) score -= 6;
  }
  if (labs.fastingGlucose != null && labs.fastingGlucose >= 126) score -= 5;
  if (labs.triglycerides != null && labs.triglycerides >= 200) score -= 4;
  if (labs.egfr != null && labs.egfr < 60) score -= 4;
  if (latest?.spo2 != null && latest.spo2 < 95) score -= 6;
  if (latest?.heartRate != null && (latest.heartRate < 50 || latest.heartRate > 100)) score -= 4;
  return Math.max(40, Math.min(95, score));
}

function riskLabel(score: number): string {
  if (score >= 75) return "Low risk";
  if (score >= 55) return "Moderate risk";
  return "High risk";
}

type AuthResult =
  | { kind: "family"; requesterId: string; patientId: string }
  | { kind: "patient"; requesterId: string; patientId: string }
  | { kind: "deny"; status: number; message: string; debug?: unknown };

async function resolveAuth(req: NextRequest): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (authHeader) {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader);
    if (!m) return { kind: "deny", status: 401, message: "authorization required" };
    const token = m[1].trim();
    if (!token) return { kind: "deny", status: 401, message: "authorization required" };
    if (!SUPABASE_URL || !ANON_KEY) {
      return { kind: "deny", status: 500, message: "server misconfigured", debug: { env: "supabase env missing" } };
    }
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!userRes.ok) {
      return { kind: "deny", status: 401, message: "invalid token", debug: { auth_status: userRes.status } };
    }
    const user = (await userRes.json()) as { id: string };
    const sb = getServiceClient();
    const { data: ccRow, error: ccErr } = await sb
      .from("care_circle")
      .select("patient_id")
      .eq("member_user_id", user.id)
      .maybeSingle();
    if (ccErr) {
      return { kind: "deny", status: 500, message: "care_circle lookup failed", debug: { code: ccErr.code } };
    }
    if (!ccRow) {
      return { kind: "deny", status: 403, message: "no care circle membership" };
    }
    return {
      kind: "family",
      requesterId: user.id,
      patientId: (ccRow as { patient_id: string }).patient_id,
    };
  }

  const session = readSession();
  if (session.patientId) {
    return { kind: "patient", requesterId: session.patientId, patientId: session.patientId };
  }

  return { kind: "deny", status: 401, message: "authentication required" };
}

type TrendMap = Record<string, BiomarkerTrend>;

async function loadTrends(patientId: string, sex: Sex): Promise<TrendMap> {
  const sb = getServiceClient();
  const { data, error } = await sb
    .from("biomarker_log")
    .select("biomarker_key, value_encrypted, date_collected")
    .eq("patient_id", patientId)
    .order("date_collected", { ascending: false })
    .limit(300);

  const out: TrendMap = {};
  if (error || !data) return out;

  const byKey: Record<string, Array<{ value: number; date: string }>> = {};
  for (const row of data as Array<{
    biomarker_key: string;
    value_encrypted: string;
    date_collected: string;
  }>) {
    const list = byKey[row.biomarker_key] ?? (byKey[row.biomarker_key] = []);
    if (list.length >= 2) continue;
    try {
      const dec = decryptJson<{ value: number }>(
        row.value_encrypted,
        `biomarker_log:${patientId}:${row.biomarker_key}`,
      );
      if (typeof dec.value === "number" && Number.isFinite(dec.value)) {
        list.push({ value: dec.value, date: row.date_collected });
      }
    } catch {
      // skip
    }
  }

  for (const spec of BIOMARKER_SPECS) {
    const history = byKey[spec.key];
    if (!history || history.length < 2) {
      out[spec.key] = null;
      continue;
    }
    const th = getThresholds(spec, sex);
    out[spec.key] = computeTrend(history[0].value, history[1].value, th);
  }

  return out;
}

interface BiomarkerResponse {
  value: number | null;
  unit: string;
  precision: number;
  date_collected: string | null;
  source: Source | null;
  normal_low: number | null;
  normal_high: number | null;
  optimal_low: number | null;
  optimal_high: number | null;
  bar_min: number;
  bar_max: number;
  status: BiomarkerStatus;
  trend: BiomarkerTrend;
}

type CategoryGroup = Record<string, BiomarkerResponse>;
type BiomarkerPanel = Record<BiomarkerCategory, CategoryGroup>;

function emptyPanel(): BiomarkerPanel {
  return {
    metabolic: {},
    cardiovascular: {},
    organ: {},
    blood: {},
    hormonal: {},
    longevity: {},
    cognitive: {},
  };
}

function resolveSourceValue(
  spec: BiomarkerSpec,
  blob: HistoryPlaintext,
  latestWearable: DailyMetric | null,
): { value: number | null; date_collected: string | null; source: Source | null } {
  if (spec.wearable_field && latestWearable) {
    const v = latestWearable[spec.wearable_field];
    if (typeof v === "number") {
      return {
        value: v,
        date_collected: latestWearable.date ?? null,
        source: "wearable",
      };
    }
  }

  const entry = blob.biomarkers?.[spec.key];
  if (entry && typeof entry.value === "number") {
    return {
      value: entry.value,
      date_collected: entry.date_collected ?? null,
      source: entry.source ?? null,
    };
  }

  if (spec.legacy_keys && blob.manualLabs) {
    const labs = blob.manualLabs as Record<string, unknown>;
    for (const lk of spec.legacy_keys) {
      const v = labs[lk];
      if (typeof v === "number") {
        return { value: v, date_collected: null, source: "self_reported" };
      }
    }
  }

  return { value: null, date_collected: null, source: null };
}

function buildBiomarkerPanel(
  blob: HistoryPlaintext,
  latestWearable: DailyMetric | null,
  sex: Sex,
  trends: TrendMap,
): BiomarkerPanel {
  const panel = emptyPanel();
  for (const spec of BIOMARKER_SPECS) {
    const src = resolveSourceValue(spec, blob, latestWearable);
    const th = getThresholds(spec, sex);
    const status = computeStatus(src.value, th);
    const entry: BiomarkerResponse = {
      value: src.value,
      unit: spec.unit,
      precision: spec.precision,
      date_collected: src.date_collected,
      source: src.source,
      normal_low: th.normal_low,
      normal_high: th.normal_high,
      optimal_low: th.optimal_low,
      optimal_high: th.optimal_high,
      bar_min: spec.bar_min,
      bar_max: spec.bar_max,
      status,
      trend: trends[spec.key] ?? null,
    };
    panel[spec.category][spec.key] = entry;
  }
  return panel;
}

function summarizePanel(panel: BiomarkerPanel): {
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
} {
  let inRange = 0;
  let flagged = 0;
  for (const cat of Object.keys(panel) as BiomarkerCategory[]) {
    const group = panel[cat];
    for (const k of Object.keys(group)) {
      const entry = group[k];
      if (entry.status === "ok") inRange += 1;
      else if (entry.status === "suboptimal" || entry.status === "outside_normal") flagged += 1;
    }
  }
  const total = inRange + flagged;
  let grade = "-";
  if (total > 0) {
    const pct = inRange / total;
    if (pct >= 1) grade = "A";
    else if (pct >= 0.8) grade = "B";
    else if (pct >= 0.6) grade = "C";
    else if (pct >= 0.4) grade = "D";
    else grade = "F";
  }
  return { panel_grade: grade, panel_flagged: flagged, panel_in_range: inRange };
}

// ===========================================================================
// Demo plan generation. Pulls signal from the biomarker panel + wearable
// and emits a workout + nutrition plan with rationale tied to specific
// out-of-optimal markers. Both plans carry is_demo: true so UI can label.
// ===========================================================================

export interface WorkoutPlan {
  title: string;
  weekly_target: string;
  cardio: string;
  strength: string;
  flexibility: string;
  emphasis: string[];
  rationale: string;
  is_demo: boolean;
}

export interface NutritionPlan {
  title: string;
  pattern: string;
  daily_calories: number;
  macros: { protein_g: number; carb_g: number; fat_g: number };
  emphasize: string[];
  limit: string[];
  sample_day: { meal: string; foods: string }[];
  rationale: string;
  is_demo: boolean;
}

function valOf(panel: BiomarkerPanel, key: string): number | null {
  for (const cat of Object.keys(panel) as BiomarkerCategory[]) {
    const e = panel[cat][key];
    if (e && typeof e.value === "number") return e.value;
  }
  return null;
}

function generateWorkoutPlan(panel: BiomarkerPanel, latestWearable: DailyMetric | null): WorkoutPlan {
  const ldl = valOf(panel, "ldl");
  const a1c = valOf(panel, "a1c");
  const tg = valOf(panel, "triglycerides");
  const hsCrp = valOf(panel, "hs_crp");
  const vitD = valOf(panel, "vitamin_d");
  const restingHr = latestWearable?.heartRate ?? valOf(panel, "resting_hr");
  const steps = latestWearable?.steps ?? null;

  const emphasis: string[] = [];
  const reasons: string[] = [];

  let weekly = "4 sessions per week";
  let cardio = "30 minutes moderate cardio (brisk walk, cycling) 3x per week";
  let strength = "Full-body resistance training 2x per week";
  let flexibility = "10 minutes mobility / stretching daily";

  if ((ldl !== null && ldl >= 130) || (tg !== null && tg >= 150)) {
    emphasis.push("Aerobic endurance");
    cardio = "35-45 minutes moderate-intensity cardio (brisk walk, cycling, swimming) 5x per week";
    weekly = "5 sessions per week";
    if (ldl !== null && ldl >= 130) reasons.push(`elevated LDL (${Math.round(ldl)} mg/dL)`);
    if (tg !== null && tg >= 150) reasons.push(`elevated triglycerides (${Math.round(tg)} mg/dL)`);
  }

  if (a1c !== null && a1c >= 5.7) {
    emphasis.push("Post-meal walks");
    flexibility = "10 minute walk after each main meal, plus 10 minutes stretching";
    if (a1c >= 6.5) {
      cardio = "40 minutes brisk walking 5-6x per week, plus 1-2 short HIIT sessions";
      reasons.push(`A1C ${a1c.toFixed(1)}% (diabetic range)`);
    } else {
      reasons.push(`A1C ${a1c.toFixed(1)}% (prediabetic range)`);
    }
  }

  if (hsCrp !== null && hsCrp >= 3) {
    emphasis.push("Moderate intensity (avoid high-impact)");
    reasons.push(`elevated hs-CRP (${hsCrp.toFixed(2)} mg/L)`);
  }

  if (vitD !== null && vitD < 30) {
    emphasis.push("Outdoor sessions");
    reasons.push(`vitamin D ${Math.round(vitD)} ng/mL (low)`);
  }

  if (restingHr !== null && restingHr > 75) {
    emphasis.push("Zone 2 cardio for resting HR improvement");
    reasons.push(`resting HR ${restingHr} bpm`);
  }

  if (steps !== null && steps < 5000) {
    emphasis.push("Daily step target 8,000+");
    reasons.push(`current ${steps} daily steps`);
  }

  if (emphasis.length === 0) {
    emphasis.push("Maintenance");
    reasons.push("all monitored markers within optimal range");
  }

  const rationale =
    reasons.length > 0
      ? `Plan tailored to: ${reasons.join("; ")}. Strength training preserves lean mass and supports glucose disposal independent of cardio.`
      : "Balanced plan suitable for ongoing maintenance.";

  return {
    title: "Weekly Movement Plan",
    weekly_target: weekly,
    cardio,
    strength,
    flexibility,
    emphasis,
    rationale,
    is_demo: true,
  };
}

function generateNutritionPlan(panel: BiomarkerPanel): NutritionPlan {
  const ldl = valOf(panel, "ldl");
  const a1c = valOf(panel, "a1c");
  const fg = valOf(panel, "fasting_glucose");
  const tg = valOf(panel, "triglycerides");
  const hsCrp = valOf(panel, "hs_crp");
  const vitD = valOf(panel, "vitamin_d");
  const ferritin = valOf(panel, "ferritin");
  const b12 = valOf(panel, "vitamin_b12");
  const homocysteine = valOf(panel, "homocysteine");

  const reasons: string[] = [];
  const emphasize: string[] = [];
  const limit: string[] = [];
  let pattern = "Balanced whole foods";
  let dailyCalories = 2000;
  let macros = { protein_g: 100, carb_g: 220, fat_g: 70 };

  if (ldl !== null && ldl >= 130) {
    pattern = "Mediterranean";
    emphasize.push("Extra-virgin olive oil (2-3 tbsp/day)", "Fatty fish (salmon, sardines) 2-3x per week", "Mixed nuts (1 oz/day)", "Soluble fiber: oats, legumes, apples");
    limit.push("Saturated fat (red meat, butter, full-fat dairy)", "Trans fats and fried foods");
    reasons.push(`LDL ${Math.round(ldl)} mg/dL`);
  }

  if ((a1c !== null && a1c >= 5.7) || (fg !== null && fg >= 100)) {
    pattern = pattern === "Mediterranean" ? "Mediterranean (low glycemic)" : "Low glycemic";
    emphasize.push("Non-starchy vegetables at every meal", "Protein at every meal (25-35g)", "Whole intact grains over flour-based grains");
    limit.push("Refined carbohydrates and added sugars", "Sugar-sweetened beverages");
    macros = { protein_g: 120, carb_g: 180, fat_g: 80 };
    if (a1c !== null) reasons.push(`A1C ${a1c.toFixed(1)}%`);
    if (fg !== null) reasons.push(`fasting glucose ${Math.round(fg)} mg/dL`);
  }

  if (tg !== null && tg >= 150) {
    emphasize.push("Omega-3 sources: salmon, sardines, walnuts, flax");
    limit.push("Alcohol", "Refined carbohydrates", "Added sugars");
    reasons.push(`triglycerides ${Math.round(tg)} mg/dL`);
  }

  if (hsCrp !== null && hsCrp >= 3) {
    emphasize.push("Berries, leafy greens, turmeric, fatty fish (anti-inflammatory)");
    limit.push("Processed meats", "Ultra-processed snacks");
    reasons.push(`hs-CRP ${hsCrp.toFixed(2)} mg/L`);
  }

  if (vitD !== null && vitD < 30) {
    emphasize.push("Fortified dairy or non-dairy milk", "Egg yolks, mushrooms (UV-exposed)");
    reasons.push(`vitamin D ${Math.round(vitD)} ng/mL`);
  }

  if (ferritin !== null && ferritin < 30) {
    emphasize.push("Iron-rich foods: lean red meat, lentils, spinach (with vitamin C)");
    reasons.push(`ferritin ${Math.round(ferritin)} ng/mL`);
  }

  if (b12 !== null && b12 < 400) {
    emphasize.push("B12-rich foods: clams, sardines, beef, fortified nutritional yeast");
    reasons.push(`B12 ${Math.round(b12)} pg/mL`);
  }

  if (homocysteine !== null && homocysteine >= 10) {
    emphasize.push("Folate, B6, B12 cofactors: leafy greens, eggs, lentils");
    reasons.push(`homocysteine ${homocysteine.toFixed(1)} µmol/L`);
  }

  if (emphasize.length === 0) {
    pattern = "Mediterranean (maintenance)";
    emphasize.push("Olive oil, fatty fish weekly, vegetables at every meal", "Whole intact grains, legumes, nuts");
    limit.push("Ultra-processed foods", "Added sugars");
    reasons.push("all monitored markers within optimal range");
  }

  const sampleDay = [
    {
      meal: "Breakfast",
      foods:
        pattern.includes("glycemic")
          ? "Greek yogurt with berries and walnuts; 2 boiled eggs"
          : "Steel-cut oats with berries, walnuts, and ground flax; black coffee",
    },
    {
      meal: "Lunch",
      foods:
        "Mixed greens with grilled salmon, chickpeas, olives, cucumber, tomato; olive-oil + lemon dressing",
    },
    {
      meal: "Snack",
      foods: "Apple with almond butter or 1 oz mixed nuts",
    },
    {
      meal: "Dinner",
      foods:
        pattern.includes("glycemic")
          ? "Grilled chicken or tofu, roasted non-starchy vegetables, small portion of quinoa or lentils"
          : "Roasted salmon, sweet potato, sauteed greens with garlic and olive oil",
    },
  ];

  const rationale =
    reasons.length > 0
      ? `Plan tailored to: ${reasons.join("; ")}. Pattern emphasizes whole-food sources of micronutrients and fiber, with macronutrient ratio adjusted to support the specific markers above.`
      : "Balanced longevity-oriented pattern suitable for ongoing maintenance.";

  return {
    title: pattern,
    pattern,
    daily_calories: dailyCalories,
    macros,
    emphasize,
    limit,
    sample_day: sampleDay,
    rationale,
    is_demo: true,
  };
}

interface DecryptedPayload {
  bp_systolic: number | null;
  bp_diastolic: number | null;
  a1c: number | null;
  ldl: number | null;
  hdl: number | null;
  total_cholesterol: number | null;
  fasting_glucose: number | null;
  triglycerides: number | null;
  egfr: number | null;
  crp: number | null;
  hr: number | null;
  steps: number | null;
  spo2: number | null;
  sleep_hours: number | null;
  hrv: number | null;
  active_calories: number | null;
  calories: number | null;
  risk_score: number;
  risk_label: string;
  panel_grade: string;
  panel_flagged: number;
  panel_in_range: number;
  updated_at: string | null;
  biomarkers: BiomarkerPanel;
  sex: Sex;
  wearable_is_demo: boolean;
  workout_plan: WorkoutPlan | null;
  nutrition_plan: NutritionPlan | null;
}

async function decryptPayload(patientId: string): Promise<DecryptedPayload> {
  const sb = getServiceClient();

  const { data: pat } = await sb
    .from("patients")
    .select("profile_encrypted")
    .eq("id", patientId)
    .maybeSingle();
  let sex: Sex = "unknown";
  if (pat?.profile_encrypted) {
    try {
      const profile = decryptJson<ProfilePlaintext>(pat.profile_encrypted, `profile:${patientId}`);
      if (profile.sex === "male" || profile.sex === "female") sex = profile.sex;
    } catch {
      // unreadable, treat as unknown
    }
  }

  const { data: hh } = await sb
    .from("health_history")
    .select("data_encrypted, updated_at")
    .eq("patient_id", patientId)
    .maybeSingle();

  let blob: HistoryPlaintext = {};
  let historyUpdatedAt: string | null = null;
  if (hh?.data_encrypted) {
    historyUpdatedAt = (hh as { updated_at?: string }).updated_at ?? null;
    try {
      blob = decryptJson<HistoryPlaintext>(hh.data_encrypted, `history:${patientId}`);
    } catch {
      blob = {};
    }
  }
  const labs: ManualLabs = blob.manualLabs ?? {};

  const { data: wd } = await sb
    .from("wearable_data")
    .select("data_encrypted, uploaded_at")
    .eq("patient_id", patientId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let latestMetric: DailyMetric | null = null;
  let wearableUpdatedAt: string | null = null;
  if (wd?.data_encrypted) {
    wearableUpdatedAt = (wd as { uploaded_at?: string }).uploaded_at ?? null;
    try {
      const parsed = decryptJson<WearablePlaintext>(wd.data_encrypted, `wearable:${patientId}`);
      const metrics = parsed.metrics || [];
      latestMetric = metrics[metrics.length - 1] || null;
    } catch {
      // ignore
    }
  }

  let wearableIsDemo = false;
  if (!latestMetric && DEMO_WEARABLE_ENABLED) {
    latestMetric = DEMO_WEARABLE;
    wearableIsDemo = true;
  }

  const updatedAt =
    historyUpdatedAt && wearableUpdatedAt
      ? historyUpdatedAt > wearableUpdatedAt
        ? historyUpdatedAt
        : wearableUpdatedAt
      : historyUpdatedAt || wearableUpdatedAt || null;

  let trends: TrendMap = {};
  try {
    trends = await loadTrends(patientId, sex);
  } catch {
    trends = {};
  }

  const biomarkers = buildBiomarkerPanel(blob, latestMetric, sex, trends);
  const { panel_grade, panel_flagged, panel_in_range } = summarizePanel(biomarkers);

  const riskScore = calculateRiskScore(labs, latestMetric);

  const flat = (k: string): number | null => {
    for (const cat of Object.keys(biomarkers) as BiomarkerCategory[]) {
      const entry = biomarkers[cat][k];
      if (entry && typeof entry.value === "number") return entry.value;
    }
    return null;
  };

  const bpStatusValue = bpStatus(labs.bpSystolic ?? null, labs.bpDiastolic ?? null);
  void bpStatusValue;

  // Demo plan generation. Gated; when off, plan fields stay null and
  // clients render the existing "Not yet generated" placeholders.
  let workoutPlan: WorkoutPlan | null = null;
  let nutritionPlan: NutritionPlan | null = null;
  if (DEMO_PLANS_ENABLED) {
    try {
      workoutPlan = generateWorkoutPlan(biomarkers, latestMetric);
      nutritionPlan = generateNutritionPlan(biomarkers);
    } catch {
      workoutPlan = null;
      nutritionPlan = null;
    }
  }

  return {
    bp_systolic: labs.bpSystolic ?? null,
    bp_diastolic: labs.bpDiastolic ?? null,
    a1c: flat("a1c"),
    ldl: flat("ldl"),
    hdl: flat("hdl"),
    total_cholesterol: flat("total_cholesterol"),
    fasting_glucose: flat("fasting_glucose"),
    triglycerides: flat("triglycerides"),
    egfr: flat("egfr"),
    crp: flat("hs_crp"),
    hr: latestMetric?.heartRate ?? null,
    steps: latestMetric?.steps ?? null,
    spo2: latestMetric?.spo2 ?? null,
    sleep_hours: latestMetric?.sleepHours ?? null,
    hrv: latestMetric?.hrv ?? null,
    active_calories: latestMetric?.activeCalories ?? null,
    calories: latestMetric?.calories ?? null,
    risk_score: riskScore,
    risk_label: riskLabel(riskScore),
    panel_grade,
    panel_flagged,
    panel_in_range,
    updated_at: updatedAt,
    biomarkers,
    sex,
    wearable_is_demo: wearableIsDemo,
    workout_plan: workoutPlan,
    nutrition_plan: nutritionPlan,
  };
}

function fieldsAccessed(panel: BiomarkerPanel): string {
  const fields: string[] = [];
  for (const cat of Object.keys(panel) as BiomarkerCategory[]) {
    const group = panel[cat];
    for (const k of Object.keys(group)) {
      if (group[k].value !== null) fields.push(k);
    }
  }
  fields.push("risk");
  fields.push("grade");
  const joined = fields.join(",");
  return joined.length > 256 ? joined.slice(0, 256) : joined;
}

async function handle(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const auth = await resolveAuth(req);

  if (auth.kind === "deny") {
    await logAudit({
      sessionId,
      action: "shield.failed",
      dataType: "health_history",
      success: false,
      metadata: { reason_code: auth.message.slice(0, 64) },
    });
    return bad(auth.message, auth.status, auth.debug);
  }

  const payload = await decryptPayload(auth.patientId);
  const decryptedAt = new Date().toISOString();

  await logAudit({
    sessionId,
    action: "shield.decrypt",
    dataType: "health_history",
    success: true,
    metadata: {
      requester_hash: sha256Hex(auth.requesterId),
      patient_hash: sha256Hex(auth.patientId),
      fields_accessed: fieldsAccessed(payload.biomarkers),
      requester_role: auth.kind,
      shield_version: SHIELD_VERSION,
    },
  });

  return NextResponse.json(
    {
      patient_id: auth.patientId,
      ...payload,
      decrypted_at: decryptedAt,
      shield_version: SHIELD_VERSION,
    },
    { headers: CORS_HEADERS },
  );
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
