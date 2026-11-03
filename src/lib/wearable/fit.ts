import { type DailyMetric, inRange, kgToLb, normalizeDate } from "./model";

/**
 * Garmin FIT weight fields are kilograms in the FIT profile.
 * Sleep fields named in seconds are converted from seconds.
 * Other keys are used only when the name says what they are.
 */

type FitTarget =
  | "heartRate"
  | "steps"
  | "spo2"
  | "calories"
  | "bpSystolic"
  | "bpDiastolic"
  | "glucose"
  | "hrv"
  | "weightKg"
  | "sleepSeconds"
  | "sleepMinutes";

const KEYS: Record<string, FitTarget> = {
  heart_rate: "heartRate",
  avg_heart_rate: "heartRate",
  steps: "steps",
  total_steps: "steps",
  spo2: "spo2",
  oxygen_saturation: "spo2",
  total_calories: "calories",
  calories: "calories",
  active_calories: "calories",
  systolic_pressure: "bpSystolic",
  systolic_blood_pressure: "bpSystolic",
  diastolic_pressure: "bpDiastolic",
  diastolic_blood_pressure: "bpDiastolic",
  blood_glucose: "glucose",
  glucose: "glucose",
  hrv: "hrv",
  rmssd: "hrv",
  sdnn: "hrv",
  weight: "weightKg",
  total_sleep_time: "sleepSeconds",
  sleep_time: "sleepSeconds",
  sleep_duration: "sleepMinutes",
};

export function metricsFromFitTree(data: unknown): DailyMetric[] {
  const out: DailyMetric[] = [];
  walk(data, null, out);
  return out;
}

function walk(node: unknown, inheritedDate: string | null, out: DailyMetric[]) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, inheritedDate, out);
    return;
  }
  const row = node as Record<string, unknown>;
  const date = normalizeDate(row.timestamp || row.start_time || row.time || row.local_timestamp) || inheritedDate;
  if (date) {
    const metric: DailyMetric = { date };
    let used = false;
    for (const [key, target] of Object.entries(KEYS)) {
      if (!(key in row)) continue;
      const value = num(row[key]);
      if (value == null) continue;
      used = assign(metric, target, value) || used;
    }
    if (used) out.push(metric);
  }
  for (const value of Object.values(row)) {
    if (value && typeof value === "object") walk(value, date, out);
  }
}

function assign(metric: DailyMetric, target: FitTarget, value: number): boolean {
  if (target === "weightKg") {
    const ranged = inRange(kgToLb(value), "weightLb");
    if (ranged == null) return false;
    metric.weightLb = ranged;
    return true;
  }
  if (target === "sleepSeconds") {
    const ranged = inRange(value / 3600, "sleepHours");
    if (ranged == null) return false;
    metric.sleepHours = ranged;
    return true;
  }
  if (target === "sleepMinutes") {
    const ranged = inRange(value / 60, "sleepHours");
    if (ranged == null) return false;
    metric.sleepHours = ranged;
    return true;
  }
  if (target === "spo2") {
    const ranged = inRange(value <= 1 ? value * 100 : value, "spo2");
    if (ranged == null) return false;
    metric.spo2 = ranged;
    return true;
  }
  const ranged = inRange(value, target);
  if (ranged == null) return false;
  metric[target] = ranged;
  return true;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export async function metricsFromFitBytes(bytes: Uint8Array): Promise<DailyMetric[]> {
  const imported = await import("fit-file-parser");
  const Parser = imported.default;
  const parser = new Parser({ force: true, mode: "list" });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const data = await parser.parseAsync(buffer);
  return metricsFromFitTree(data);
}
