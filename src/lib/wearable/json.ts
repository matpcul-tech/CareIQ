import {
  type DailyMetric,
  inRange,
  kgToLb,
  normalizeDate,
  normalizeKey,
} from "./model";

export function metricsFromJson(text: string): DailyMetric[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const records = collect(data);
  const out: DailyMetric[] = [];
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const row = record as Record<string, unknown>;
    const named = fromTypedRecord(row);
    if (named) {
      out.push(named);
      continue;
    }
    const flat = flatten(row);
    const date = pickDate(flat);
    if (!date) continue;
    const metric: DailyMetric = { date };
    copyNumber(metric, "heartRate", flat, ["heartrate", "bpm", "beatsperminute", "averageheartrate"]);
    copyNumber(metric, "steps", flat, ["steps", "stepcount", "totalsteps"]);
    const sleep = pick(flat, ["sleephours", "sleep", "minutesasleep", "sleepduration"]);
    if (sleep != null) {
      const hours = sleep > 24 ? sleep / 60 : sleep;
      const ranged = inRange(hours, "sleepHours");
      if (ranged != null) metric.sleepHours = ranged;
    }
    copyNumber(metric, "spo2", flat, ["spo2", "oxygensaturation"]);
    copyNumber(metric, "calories", flat, ["calories", "activecalories", "totalcalories"]);
    copyNumber(metric, "bpSystolic", flat, ["systolic", "bpsystolic"]);
    copyNumber(metric, "bpDiastolic", flat, ["diastolic", "bpdiastolic"]);
    copyNumber(metric, "glucose", flat, ["glucose", "bloodglucose"]);
    copyNumber(metric, "hrv", flat, ["hrv", "rmssd", "sdnn"]);
    const weight = pick(flat, ["weightlb"]);
    const weightKg = pick(flat, ["weightkg", "weight"]);
    if (weight != null) {
      const ranged = inRange(weight, "weightLb");
      if (ranged != null) metric.weightLb = ranged;
    } else if (weightKg != null && hasKey(flat, ["weightkg"])) {
      const ranged = inRange(kgToLb(weightKg), "weightLb");
      if (ranged != null) metric.weightLb = ranged;
    }
    out.push(metric);
  }
  return out;
}

function fromTypedRecord(row: Record<string, unknown>): DailyMetric | null {
  const type = String(row.recordType || row.type || "");
  if (!type) return null;
  const date = normalizeDate(row.startTime || row.startDate || row.time || row.date);
  if (!date) return null;
  const metric: DailyMetric = { date };
  const name = normalizeKey(type);
  if (name.includes("heartrate") && !name.includes("variab")) {
    const sample = firstSample(row);
    const bpm = num(sample?.beatsPerMinute ?? row.beatsPerMinute ?? row.value);
    const ranged = bpm == null ? undefined : inRange(bpm, "heartRate");
    if (ranged == null) return null;
    metric.heartRate = ranged;
  } else if (name.includes("step")) {
    const count = num(row.count ?? row.value);
    const ranged = count == null ? undefined : inRange(count, "steps");
    if (ranged == null) return null;
    metric.steps = ranged;
  } else if (name.includes("oxygen") || name.includes("spo2")) {
    const value = num(nested(row, "percentage") ?? row.value);
    const ranged = value == null ? undefined : inRange(value <= 1 ? value * 100 : value, "spo2");
    if (ranged == null) return null;
    metric.spo2 = ranged;
  } else if (name.includes("calorie")) {
    const value = num(nested(row, "inKilocalories") ?? row.value);
    const ranged = value == null ? undefined : inRange(value, "calories");
    if (ranged == null) return null;
    metric.calories = ranged;
  } else if (name.includes("bloodpressure")) {
    const sys = num(nested(row.systolic, "inMillimetersOfMercury"));
    const dia = num(nested(row.diastolic, "inMillimetersOfMercury"));
    if (sys == null || dia == null) return null;
    const sysR = inRange(sys, "bpSystolic");
    const diaR = inRange(dia, "bpDiastolic");
    if (sysR == null || diaR == null) return null;
    metric.bpSystolic = sysR;
    metric.bpDiastolic = diaR;
  } else if (name.includes("glucose")) {
    const mg = num(nested(row.level, "inMilligramsPerDeciliter"));
    const mmol = num(nested(row.level, "inMillimolesPerLiter"));
    const value = mg ?? (mmol == null ? undefined : mmol * 18.01559);
    const ranged = value == null ? undefined : inRange(value, "glucose");
    if (ranged == null) return null;
    metric.glucose = ranged;
  } else if (name.includes("weight")) {
    const kg = num(nested(row.weight, "inKilograms"));
    const lb = num(nested(row.weight, "inPounds"));
    const pounds = lb ?? (kg == null ? undefined : kgToLb(kg));
    const ranged = pounds == null ? undefined : inRange(pounds, "weightLb");
    if (ranged == null) return null;
    metric.weightLb = ranged;
  } else if (name.includes("hrv") || name.includes("rmssd") || name.includes("variab")) {
    const value = num(nested(row.heartRateVariabilityMillis, "value") ?? row.heartRateVariabilityMillis ?? row.value);
    const ranged = value == null ? undefined : inRange(value, "hrv");
    if (ranged == null) return null;
    metric.hrv = ranged;
  } else if (name.includes("sleep")) {
    const start = Date.parse(String(row.startTime || ""));
    const end = Date.parse(String(row.endTime || ""));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const hours = (end - start) / 3_600_000;
    const ranged = inRange(hours, "sleepHours");
    if (ranged == null) return null;
    metric.sleepHours = ranged;
  } else {
    return null;
  }
  return metric;
}

function collect(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["records", "data", "items", "entries", "sessions", "activities", "summary", "samples"]) {
      if (Array.isArray(obj[key])) return obj[key] as unknown[];
    }
    return [data];
  }
  return [];
}

function flatten(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const next = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      Object.assign(out, flatten(value as Record<string, unknown>, next));
    } else {
      out[next] = value;
    }
  }
  return out;
}

function pickDate(flat: Record<string, unknown>): string | null {
  for (const [key, value] of Object.entries(flat)) {
    const name = normalizeKey(key);
    if (name === "date" || name.endsWith("date") || name.endsWith("starttime") || name.endsWith("timestamp")) {
      const date = normalizeDate(value instanceof Date ? value : String(value));
      if (date) return date;
    }
  }
  return null;
}

function pick(flat: Record<string, unknown>, keys: string[]): number | undefined {
  for (const [key, value] of Object.entries(flat)) {
    const name = normalizeKey(key);
    if (keys.some((item) => name === item || name.endsWith(item))) {
      const n = num(value);
      if (n != null) return n;
    }
  }
  return undefined;
}

function hasKey(flat: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(flat).some((key) => keys.some((item) => normalizeKey(key).endsWith(item)));
}

function copyNumber(
  metric: DailyMetric,
  key: "heartRate" | "steps" | "spo2" | "calories" | "bpSystolic" | "bpDiastolic" | "glucose" | "hrv",
  flat: Record<string, unknown>,
  keys: string[],
) {
  const value = pick(flat, keys);
  if (value == null) return;
  const ranged = inRange(value, key);
  if (ranged != null) metric[key] = ranged;
}

function firstSample(row: Record<string, unknown>): Record<string, unknown> | null {
  const samples = row.samples;
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const first = samples[0];
  return first && typeof first === "object" ? first as Record<string, unknown> : null;
}

function nested(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return (value as Record<string, unknown>)[key];
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}
