import { z } from "zod";

/**
 * Daily wearable summary. Raw exports stay on the device.
 * The server accepts only this shape.
 *
 * Life's Essential 8 uses device weight only when a height is already
 * on file. A missing height is not filled in.
 */

export const DEVICE_TYPES = [
  "fitbit",
  "apple_watch",
  "garmin",
  "samsung",
  "google_fit",
  "generic",
  "withings",
  "omron",
  "dexcom",
  "libre",
  "health_connect",
  "oura",
  "polar",
  "other",
] as const;

export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Labels the live database check already allows. New labels need the migration. */
export const LEGACY_DEVICE_TYPES = [
  "fitbit",
  "apple_watch",
  "garmin",
  "samsung",
  "google_fit",
  "generic",
] as const;

export const SOURCE_FORMATS = ["csv", "json", "xml", "zip", "fit"] as const;
export type SourceFormat = (typeof SOURCE_FORMATS)[number];

export interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  glucose?: number;
  weightLb?: number;
  hrv?: number;
}

export interface WearableSummary {
  deviceType: DeviceType;
  sourceFormat: SourceFormat;
  metrics: DailyMetric[];
}

const METRIC_RANGES = {
  heartRate: [20, 250],
  steps: [0, 200000],
  sleepHours: [0, 24],
  spo2: [50, 100],
  calories: [0, 20000],
  bpSystolic: [40, 300],
  bpDiastolic: [20, 200],
  glucose: [20, 600],
  weightLb: [50, 700],
  hrv: [1, 300],
} as const;

type MetricKey = keyof typeof METRIC_RANGES;

const metricShape: Record<string, z.ZodTypeAny> = {
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};
for (const [key, [min, max]] of Object.entries(METRIC_RANGES)) {
  metricShape[key] = z.number().min(min).max(max).optional();
}

const daySchema = z.object(metricShape).strict().refine(
  (day) => METRIC_KEYS.some((key) => day[key] != null),
  { message: "day has no metric" },
);

export const METRIC_KEYS = Object.keys(METRIC_RANGES) as MetricKey[];

export const wearableSummarySchema = z.object({
  deviceType: z.enum(DEVICE_TYPES),
  sourceFormat: z.enum(SOURCE_FORMATS),
  metrics: z.array(daySchema).min(1).max(3660),
}).strict().refine((summary) => {
  const seen = new Set<string>();
  for (const day of summary.metrics) {
    if (seen.has(day.date)) return false;
    seen.add(day.date);
  }
  return true;
}, { message: "duplicate day" });

export const SUMMARY_MAX_CHARS = 500_000;

export function parseWearableSummary(raw: unknown): WearableSummary {
  const parsed = wearableSummarySchema.parse(raw);
  return {
    deviceType: parsed.deviceType,
    sourceFormat: parsed.sourceFormat,
    metrics: parsed.metrics.map((day) => {
      const metric: DailyMetric = { date: day.date };
      for (const key of METRIC_KEYS) {
        const value = day[key];
        if (typeof value === "number") metric[key] = value;
      }
      return metric;
    }),
  };
}

export function isDeviceTypeCheckError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "23514") return true;
  const message = (error.message || "").toLowerCase();
  return message.includes("device_type") && message.includes("check");
}

const DEVICE_RULES: Array<{ device: DeviceType; pattern: RegExp }> = [
  { device: "fitbit", pattern: /fitbit/i },
  { device: "apple_watch", pattern: /HKQuantityTypeIdentifier|apple\s*health|export\.xml/i },
  { device: "health_connect", pattern: /health\s*connect|androidx\.health/i },
  { device: "samsung", pattern: /samsung\s*health|shealth|com\.samsung\.health/i },
  { device: "google_fit", pattern: /google\s*fit|com\.google\.android\.fit/i },
  { device: "withings", pattern: /withings/i },
  { device: "omron", pattern: /omron/i },
  { device: "dexcom", pattern: /dexcom/i },
  { device: "libre", pattern: /freestyle\s*libre|\blibre\b/i },
  { device: "oura", pattern: /\boura\b/i },
  { device: "polar", pattern: /\bpolar\b/i },
  { device: "garmin", pattern: /garmin/i },
];

export function detectDevice(sample: string, fileName = ""): DeviceType {
  const head = `${fileName}\n${sample}`.slice(0, 12000);
  for (const rule of DEVICE_RULES) {
    if (rule.pattern.test(head)) return rule.device;
  }
  if (/\.fit$/i.test(fileName)) return "garmin";
  return "other";
}

export function normalizeKey(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeDate(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return isoDay(value);
  }
  const str = String(value).trim();
  if (!str) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(str);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str);
    const ms = str.length === 13 ? n : n * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return isoDay(date);
  }
  const parsed = new Date(str);
  if (!Number.isNaN(parsed.getTime())) return isoDay(parsed);
  return null;
}

function isoDay(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function inRange(value: number, key: MetricKey): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  const [min, max] = METRIC_RANGES[key];
  if (value < min || value > max) return undefined;
  return Math.round(value * 10) / 10;
}

export function kgToLb(kg: number): number {
  return Math.round(kg * 2.2046226218 * 10) / 10;
}

interface Bucket {
  hr: number[];
  steps: number[];
  sleep: number[];
  spo2: number[];
  cal: number[];
  sys: number[];
  dia: number[];
  glucose: number[];
  weight: number[];
  hrv: number[];
}

function emptyBucket(): Bucket {
  return {
    hr: [], steps: [], sleep: [], spo2: [], cal: [],
    sys: [], dia: [], glucose: [], weight: [], hrv: [],
  };
}

export function aggregateMetrics(metrics: DailyMetric[]): DailyMetric[] {
  const byDate = new Map<string, Bucket>();
  for (const metric of metrics) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(metric.date)) continue;
    let bucket = byDate.get(metric.date);
    if (!bucket) {
      bucket = emptyBucket();
      byDate.set(metric.date, bucket);
    }
    push(bucket.hr, metric.heartRate);
    push(bucket.steps, metric.steps);
    push(bucket.sleep, metric.sleepHours);
    push(bucket.spo2, metric.spo2);
    push(bucket.cal, metric.calories);
    push(bucket.sys, metric.bpSystolic);
    push(bucket.dia, metric.bpDiastolic);
    push(bucket.glucose, metric.glucose);
    push(bucket.weight, metric.weightLb);
    push(bucket.hrv, metric.hrv);
  }
  const out: DailyMetric[] = [];
  for (const [date, bucket] of byDate) {
    const metric: DailyMetric = { date };
    const hr = avg(bucket.hr);
    const steps = sum(bucket.steps);
    const sleep = sum(bucket.sleep);
    const spo2 = avg(bucket.spo2);
    const cal = sum(bucket.cal);
    const sys = avg(bucket.sys);
    const dia = avg(bucket.dia);
    const glucose = avg(bucket.glucose);
    const weight = bucket.weight.length ? bucket.weight[bucket.weight.length - 1] : undefined;
    const hrv = avg(bucket.hrv);
    if (hr != null) metric.heartRate = inRange(hr, "heartRate");
    if (steps != null) metric.steps = inRange(steps, "steps");
    if (sleep != null) metric.sleepHours = inRange(Math.min(sleep, 24), "sleepHours");
    if (spo2 != null) metric.spo2 = inRange(spo2, "spo2");
    if (cal != null) metric.calories = inRange(cal, "calories");
    if (sys != null) metric.bpSystolic = inRange(sys, "bpSystolic");
    if (dia != null) metric.bpDiastolic = inRange(dia, "bpDiastolic");
    if (glucose != null) metric.glucose = inRange(glucose, "glucose");
    if (weight != null) metric.weightLb = inRange(weight, "weightLb");
    if (hrv != null) metric.hrv = inRange(hrv, "hrv");
    if (METRIC_KEYS.some((key) => metric[key] != null)) out.push(metric);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  if (out.length > 3660) return out.slice(out.length - 3660);
  return out;
}

function push(list: number[], value: number | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) list.push(value);
}

function avg(list: number[]): number | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((sumValue, n) => sumValue + n, 0) / list.length;
}

function sum(list: number[]): number | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((sumValue, n) => sumValue + n, 0);
}

/**
 * Manual weight wins. Device weight is used only when height is already
 * on file. Nothing is filled in when either number is missing.
 */
export function weightLbForLe8(args: {
  manualWeightLb?: number;
  heightIn?: number;
  wearable: Array<{ date: string; weightLb?: number }>;
}): number | undefined {
  if (typeof args.manualWeightLb === "number" && Number.isFinite(args.manualWeightLb)) {
    return args.manualWeightLb;
  }
  if (typeof args.heightIn !== "number" || !Number.isFinite(args.heightIn)) return undefined;
  const weighed = args.wearable.filter(
    (day) => typeof day.weightLb === "number" && Number.isFinite(day.weightLb),
  );
  if (weighed.length === 0) return undefined;
  weighed.sort((a, b) => a.date.localeCompare(b.date));
  return weighed[weighed.length - 1].weightLb;
}

export function toSummary(
  deviceType: DeviceType,
  sourceFormat: SourceFormat,
  metrics: DailyMetric[],
): WearableSummary {
  return {
    deviceType,
    sourceFormat,
    metrics: aggregateMetrics(metrics),
  };
}
