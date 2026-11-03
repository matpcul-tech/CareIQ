import { isAiEnabled } from "@/lib/ai-flag";
import { glucoseRangeSentence, glucoseRangeLabel, kdigoGStage, kdigoSentence, PREVENT_TODO, USPSTF_TODO } from "@/lib/clinical-info";
import { resolveLabs } from "@/lib/lab-values";
import { scoreLe8, type Le8Input } from "@/lib/le8";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getServiceClient } from "@/lib/supabase-server";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import CareIQHealthOS, {
  type ClinicalData,
  type ClinicalVital,
  type ClinicalDomain,
  type ClinicalInsight,
  type ClinicalTimelineItem,
} from "@/components/CareIQHealthOS";

export const dynamic = "force-dynamic";

interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
  sex?: "male" | "female";
}

interface ManualLabs {
  a1c?: number;
  ldl?: number;
  hdl?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
  tsh?: number;
  vitaminD?: number;
}

interface HistoryPlaintext {
  chronicConditions?: string[];
  medications?: string;
  allergies?: string;
  familyHistory?: string;
  manualLabs?: ManualLabs;
  biomarkers?: Record<string, unknown>;
  le8?: Le8Input;
}

interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function ClinicalPage() {
  const session = readSession();
  if (!session.patientId) redirect("/onboard");

  const sb = getServiceClient();

  const [patRes, hhRes, labRes, wdRes] = await Promise.all([
    sb.from("patients").select("profile_encrypted, created_at").eq("id", session.patientId).maybeSingle(),
    sb.from("health_history").select("data_encrypted").eq("patient_id", session.patientId).maybeSingle(),
    sb.from("lab_files").select("id, file_type, uploaded_at").eq("patient_id", session.patientId).order("uploaded_at", { ascending: false }),
    sb.from("wearable_data").select("data_encrypted, device_type, uploaded_at").eq("patient_id", session.patientId).order("uploaded_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  let profile: ProfilePlaintext | null = null;
  if (patRes.data?.profile_encrypted) {
    try {
      profile = decryptJson<ProfilePlaintext>(patRes.data.profile_encrypted, `profile:${session.patientId}`);
    } catch { /* leave null */ }
  }

  let history: HistoryPlaintext | null = null;
  if (hhRes.data?.data_encrypted) {
    try {
      history = decryptJson<HistoryPlaintext>(hhRes.data.data_encrypted, `history:${session.patientId}`);
    } catch { /* leave null */ }
  }

  const labFiles = labRes.data ?? [];

  let metrics: DailyMetric[] = [];
  let deviceType = "";
  if (wdRes.data?.data_encrypted) {
    try {
      const parsed = decryptJson<{ device: string; metrics: DailyMetric[] }>(
        wdRes.data.data_encrypted,
        `wearable:${session.patientId}`,
      );
      deviceType = parsed.device || "";
      metrics = parsed.metrics ?? [];
    } catch { /* leave empty */ }
  }

  const hasAnyData = !!profile || !!history || metrics.length > 0 || labFiles.length > 0;

  await logAudit({
    sessionId: session.sessionId,
    action: "patient.profile.read",
    dataType: "profile",
    success: true,
  });

  const aiEnabled = isAiEnabled();

  if (!hasAnyData) {
    return <CareIQHealthOS demoMode={true} aiEnabled={aiEnabled} />;
  }

  const clinicalData = buildClinicalData({
    patientId: session.patientId,
    profile,
    history,
    labFileCount: labFiles.length,
    metrics,
    deviceType,
    enrolledAt: patRes.data?.created_at ?? null,
    sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : "unknown",
  });

  return <CareIQHealthOS demoMode={false} clinicalData={clinicalData} aiEnabled={aiEnabled} />;
}

/* ------------------------------------------------------------------------- */
/* Real-data to ClinicalData derivation                                      */
/* ------------------------------------------------------------------------- */

function buildClinicalData(args: {
  patientId: string;
  profile: ProfilePlaintext | null;
  history: HistoryPlaintext | null;
  labFileCount: number;
  metrics: DailyMetric[];
  deviceType: string;
  enrolledAt: string | null;
  sex: "male" | "female" | "unknown";
}): ClinicalData {
  const { patientId, profile, history, labFileCount, metrics, deviceType, enrolledAt, sex } = args;

  const fullName = [profile?.firstName, profile?.lastName]
    .map((s) => (s || "").trim())
    .filter(Boolean)
    .join(" ");
  const patient = {
    name: fullName || "Community Patient",
    id: `CIQ-${patientId.slice(0, 8).toUpperCase()}`,
    age: ageFromDob(profile?.dateOfBirth) ?? 0,
    score: 0,
  };

  // Manually-entered labs override demo defaults wherever the patient typed
  // a value. Status (ok/warn/alert) is derived from the typed value too.
  const manual = resolveLabs(history);
  const last = metrics.length > 0 ? metrics[metrics.length - 1] : null;

  const bpVital: ClinicalVital = manual.bpSystolic != null && manual.bpDiastolic != null
    ? { icon: "BP", val: `${manual.bpSystolic}/${manual.bpDiastolic}`, unit: "mmHg", name: "Blood Pressure", s: bpStatus(manual.bpSystolic, manual.bpDiastolic) }
    : { icon: "BP", val: "-", unit: "mmHg", name: "Blood Pressure", s: "unknown" };

  const a1cVital: ClinicalVital = manual.a1c != null
    ? { icon: "A1C", val: manual.a1c.toFixed(1), unit: "A1C %", name: "Glycemic", s: a1cStatus(manual.a1c) }
    : { icon: "A1C", val: "-", unit: "A1C %", name: "Glycemic", s: "unknown" };

  const ldlVital: ClinicalVital = manual.ldl != null
    ? { icon: "LDL", val: String(Math.round(manual.ldl)), unit: "mg/dL", name: "LDL Chol.", s: ldlStatus(manual.ldl) }
    : { icon: "LDL", val: "-", unit: "mg/dL", name: "LDL Chol.", s: "unknown" };

  const hrVital: ClinicalVital = last?.heartRate != null
    ? { icon: "HR", val: String(last.heartRate), unit: "bpm", name: "Heart Rate", s: hrStatus(last.heartRate) }
    : { icon: "HR", val: "-", unit: "bpm", name: "Heart Rate", s: "ok" };

  const spo2Vital: ClinicalVital = last?.spo2 != null
    ? { icon: "O2", val: String(last.spo2), unit: "SpO2 %", name: "Oxygen Sat", s: spo2Status(last.spo2) }
    : { icon: "O2", val: "-", unit: "SpO2 %", name: "Oxygen Sat", s: "ok" };

  // Fasting glucose when the patient entered one. There is no weight field
  // on the manual lab record, so the tile stays empty instead of a sample weight.
  const sixthVital: ClinicalVital = manual.fastingGlucose != null
    ? { icon: "GLU", val: String(Math.round(manual.fastingGlucose)), unit: "mg/dL", name: "Fasting Glucose", s: glucoseStatus(manual.fastingGlucose) }
    : { icon: "WT", val: "-", unit: "lbs", name: "Body Weight", s: "unknown" };

  const vitals: ClinicalVital[] = [bpVital, a1cVital, ldlVital, hrVital, spo2Vital, sixthVital];

  const conditions = (history?.chronicConditions ?? []).map((c) => c.toLowerCase());
  const has = (k: string) => conditions.some((c) => c.includes(k));
  const domains: ClinicalDomain[] = [];
  const heartHealth = scoreLe8({
    sex,
    mepa: history?.le8?.mepa,
    moderateMinutesPerWeek: history?.le8?.moderateMinutesPerWeek,
    vigorousMinutesPerWeek: history?.le8?.vigorousMinutesPerWeek,
    nicotine: history?.le8?.nicotine,
    livesWithIndoorSmoker: history?.le8?.livesWithIndoorSmoker,
    sleepHours: history?.le8?.sleepHours,
    weightLb: manual.weight,
    heightIn: manual.height,
    totalCholesterol: manual.totalCholesterol,
    hdl: manual.hdl,
    lipidTreated: history?.le8?.lipidTreated,
    a1c: manual.a1c,
    fastingGlucose: manual.fastingGlucose,
    diabetesRecorded: has("diabet"),
    bpSystolic: manual.bpSystolic,
    bpDiastolic: manual.bpDiastolic,
    bpTreated: history?.le8?.bpTreated,
  });
  const glucoseLabel = glucoseRangeLabel({ a1c: manual.a1c, fastingGlucose: manual.fastingGlucose });
  const gStage = manual.egfr != null ? kdigoGStage(manual.egfr) : null;

  const insights: ClinicalInsight[] = [];
  if (has("diabet") || (manual.a1c != null && manual.a1c >= 5.7)) {
    insights.push({
      type: "watch",
      icon: "GLU",
      title: "Glycemic Monitoring Recommended",
      body: "Diabetes is recorded in chronic conditions. Talk with your FQHC care team about monitoring. CareIQ does not track continuous glucose or RPM time.",
      cta: "",
      conf: "92%",
    });
  }
  if (has("hypert") || (manual.bpSystolic != null && manual.bpSystolic >= 130)) {
    insights.push({
      type: "crit",
      icon: "BP",
      title: "Hypertension Follow-Up",
      body: "Blood pressure on file is above target. Regular BP monitoring and FQHC care team review recommended within 30 days.",
      cta: "",
      conf: "94%",
    });
  }
  if (manual.ldl != null && manual.ldl >= 130) {
    insights.push({
      type: "watch",
      icon: "LDL",
      title: "Elevated LDL on File",
      body: `LDL of ${Math.round(manual.ldl)} mg/dL elevates 10-year cardiovascular risk. Discuss lipid management with your FQHC care team.`,
      cta: "",
      conf: "92%",
    });
  }
  if (history?.allergies) {
    insights.push({
      type: "watch",
      icon: "ALG",
      title: "Allergy History on File",
      body: "Allergy history is recorded and visible to your FQHC care team during medication review.",
      cta: "",
      conf: "100%",
    });
  }
  if (labFileCount > 0) {
    insights.push({
      type: "pos",
      icon: "LAB",
      title: `${labFileCount} Lab File${labFileCount === 1 ? "" : "s"} Uploaded`,
      body: "Lab files are encrypted at rest with AES-256-GCM on the application server.",
      cta: "",
      conf: "100%",
    });
  }
  if (insights.length === 0) {
    insights.push({
      type: "pos",
      icon: "OK",
      title: "Profile Active, Building Baseline",
      body: "Your record is set up. Later summaries can include wearable files, labs, and history you add. The model is not trained on your record.",
      cta: "",
      conf: "100%",
    });
  }

  const timeline: ClinicalTimelineItem[] = [];
  if (last?.date) {
    timeline.push({
      dot: "#00d4b8",
      date: friendlyDate(last.date),
      title: "Wearable Sync",
      text: `Latest reading from ${deviceType || "wearable device"}.`,
    });
  }
  if (Object.keys(manual).length > 0) {
    timeline.push({
      dot: "#d4a843",
      date: "Recent",
      title: "Manual Lab Values Recorded",
      text: `${Object.keys(manual).length} lab value${Object.keys(manual).length === 1 ? "" : "s"} typed in by patient.`,
    });
  }
  if (labFileCount > 0) {
    timeline.push({
      dot: "#d4a843",
      date: "Recent",
      title: `${labFileCount} Lab File${labFileCount === 1 ? "" : "s"} on File`,
      text: "Encrypted at rest with AES-256-GCM. The key is in the application server environment.",
    });
  }
  if (history) {
    timeline.push({
      dot: "#8060cc",
      date: "Recorded",
      title: "Health History Captured",
      text: "Conditions, medications, and family history saved in the encrypted record.",
    });
  }
  if (enrolledAt) {
    timeline.push({
      dot: "#00d4b8",
      date: friendlyDate(enrolledAt),
      title: "Enrollment",
      text: "CareIQ record created.",
    });
  }

  const last7 = metrics.slice(-7);
  const wearHr7Day = last7.map((m) => m.heartRate ?? 0).filter((v) => v > 0);
  const wearSteps7Day = last7.map((m) => m.steps ?? 0);
  const wearDays = last7.map((m) => dayLabel(m.date));

  const result: ClinicalData = {
    patient,
    vitals,
    domains,
    insights,
    timeline: timeline.length > 0 ? timeline : [
      { dot: "#00d4b8", date: "Today", title: "Vault Active", text: "No timeline events yet." },
    ],
    meals: DEFAULT_MEALS,
    wearHr7Day,
    wearSteps7Day,
    wearDays,
    wearableSource: deviceType ? "upload" : "none",
    primaryDeviceLabel: deviceType ? humanDevice(deviceType) : undefined,
    labs: manual,
    sex,
    recordedConditions: (history?.chronicConditions ?? []).map((c) => c.trim()).filter(Boolean),
    heartHealth,
    glucoseNote: glucoseLabel ? glucoseRangeSentence(glucoseLabel) : null,
    kdigoNote: gStage && manual.egfr != null ? kdigoSentence(gStage, manual.egfr) : null,
    preventTodo: PREVENT_TODO,
    uspstfTodo: USPSTF_TODO,
  };
  return result;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function ageFromDob(dob?: string): number | null {
  if (!dob) return null;
  const d = new Date(dob + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < d.getUTCMonth() ||
    (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate());
  if (beforeBirthday) age -= 1;
  if (age < 0 || age > 120) return null;
  return age;
}

function hrStatus(hr: number): string {
  if (hr < 50 || hr > 100) return "alert";
  if (hr < 55 || hr > 95) return "warn";
  return "ok";
}

function spo2Status(spo2: number): string {
  if (spo2 < 90) return "alert";
  if (spo2 < 95) return "warn";
  return "ok";
}

function a1cStatus(v: number): string {
  if (v >= 6.5) return "alert";
  if (v >= 5.7) return "warn";
  return "ok";
}

function ldlStatus(v: number): string {
  if (v >= 190) return "alert";
  if (v >= 130) return "warn";
  return "ok";
}

function glucoseStatus(v: number): string {
  if (v >= 126) return "alert";
  if (v >= 100) return "warn";
  return "ok";
}

function bpStatus(sys: number, dia: number): string {
  if (sys >= 140 || dia >= 90) return "alert";
  if (sys >= 130 || dia >= 80) return "warn";
  return "ok";
}

function friendlyDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return DAY_LABELS[d.getUTCDay()];
}

function humanDevice(t: string): string {
  const map: Record<string, string> = {
    fitbit: "Fitbit",
    apple_watch: "Apple Watch",
    garmin: "Garmin",
    samsung: "Samsung",
    google_fit: "Google Fit",
    generic: "Wearable",
  };
  return map[t] ?? t;
}

const DEFAULT_MEALS = [
  { time: "Breakfast 7:00 AM", name: "Steel-Cut Oats with Berries", desc: "Steel-cut oatmeal topped with fresh blueberries, walnuts, and a drizzle of olive oil.", tags: ["Heart-Healthy", "High Fiber", "Low Sodium"] },
  { time: "Lunch 12:00 PM", name: "Lentil and Vegetable Bowl", desc: "Stewed lentils with brown rice, leafy greens, tomatoes, and lemon. Lean plant protein with complete fiber.", tags: ["Plant Protein", "Low GI", "Affordable"] },
  { time: "Dinner 6:30 PM", name: "Baked Salmon with Sweet Potato", desc: "Baked salmon, roasted sweet potato, and steamed collards. Omega-3s, potassium, and folate in one plate.", tags: ["Cardioprotective", "Low Sodium", "High Potassium"] },
];
