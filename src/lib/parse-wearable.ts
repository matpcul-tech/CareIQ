import "server-only";

export type DeviceType =
  | "fitbit"
  | "apple_watch"
  | "garmin"
  | "samsung"
  | "google_fit"
  | "generic";

export interface DailyMetric {
  date: string; // ISO date YYYY-MM-DD
  heartRate?: number; // average bpm
  steps?: number;
  sleepHours?: number;
  spo2?: number; // 0-100 percent
  calories?: number;
}

export interface ParsedWearable {
  deviceType: DeviceType;
  metrics: DailyMetric[];
  sourceFormat: "csv" | "json" | "xml";
}

const HEART_KEYS = ["heartrate", "heart_rate", "hr", "averageheartrate", "restingheartrate", "bpm"];
const STEP_KEYS = ["steps", "stepcount", "step_count", "totalsteps"];
const SLEEP_KEYS = ["sleep", "sleephours", "sleep_hours", "asleep", "totalsleep", "minutesasleep"];
const SPO2_KEYS = ["spo2", "oxygensaturation", "oxygen_saturation", "saturation"];
const CAL_KEYS = ["calories", "energyburned", "activecalories", "totalcalories"];
const DATE_KEYS = ["date", "day", "datetime", "startdate", "starttime", "timestamp", "dateofmeasurement"];

const DEVICE_HINTS: Array<{ device: DeviceType; markers: RegExp[] }> = [
  { device: "fitbit", markers: [/fitbit/i] },
  { device: "apple_watch", markers: [/HKQuantityTypeIdentifier/i, /apple\s*health/i] },
  { device: "garmin", markers: [/garmin/i] },
  { device: "samsung", markers: [/samsung\s*health/i, /shealth/i] },
  { device: "google_fit", markers: [/google\s*fit/i, /com\.google\.android\.fit/i] },
];

export function parseWearable(input: string | Uint8Array, format: "csv" | "json" | "xml"): ParsedWearable {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input);
  if (text.length === 0) throw new Error("empty wearable file");
  if (text.length > 25 * 1024 * 1024) throw new Error("wearable file too large to parse");

  const deviceType = detectDevice(text);
  let metrics: DailyMetric[];
  switch (format) {
    case "csv":
      metrics = parseCsv(text);
      break;
    case "json":
      metrics = parseJson(text);
      break;
    case "xml":
      metrics = parseXml(text);
      break;
    default:
      throw new Error("unsupported format");
  }

  // Aggregate per day, clamp ranges, sort by date asc
  const aggregated = aggregateByDate(metrics);
  return { deviceType, metrics: aggregated, sourceFormat: format };
}

function detectDevice(sample: string): DeviceType {
  const head = sample.slice(0, 8192);
  for (const { device, markers } of DEVICE_HINTS) {
    if (markers.some((r) => r.test(head))) return device;
  }
  return "generic";
}

/* ------------------------------------------------------------------------- */
/* CSV                                                                       */
/* ------------------------------------------------------------------------- */

function parseCsv(text: string): DailyMetric[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(normalizeKey);
  const idx = {
    date: findColumn(header, DATE_KEYS),
    hr: findColumn(header, HEART_KEYS),
    steps: findColumn(header, STEP_KEYS),
    sleep: findColumn(header, SLEEP_KEYS),
    spo2: findColumn(header, SPO2_KEYS),
    cal: findColumn(header, CAL_KEYS),
  };
  if (idx.date < 0) return [];
  const out: DailyMetric[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (row.length === 0) continue;
    const date = normalizeDate(row[idx.date]);
    if (!date) continue;
    const m: DailyMetric = { date };
    if (idx.hr >= 0) m.heartRate = clampNumber(row[idx.hr], 20, 250);
    if (idx.steps >= 0) m.steps = clampNumber(row[idx.steps], 0, 200_000);
    if (idx.sleep >= 0) {
      const v = clampNumber(row[idx.sleep], 0, 1440);
      if (v != null) {
        // Heuristic: > 24 means minutes; convert to hours
        m.sleepHours = v > 24 ? Math.round((v / 60) * 10) / 10 : Math.round(v * 10) / 10;
      }
    }
    if (idx.spo2 >= 0) m.spo2 = clampNumber(row[idx.spo2], 50, 100);
    if (idx.cal >= 0) m.calories = clampNumber(row[idx.cal], 0, 20_000);
    out.push(m);
  }
  return out;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === "," || c === ";" || c === "\t") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------------------- */
/* JSON                                                                      */
/* ------------------------------------------------------------------------- */

function parseJson(text: string): DailyMetric[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const records = collectJsonRecords(data);
  const out: DailyMetric[] = [];
  for (const rec of records) {
    if (typeof rec !== "object" || rec === null) continue;
    const flat = flattenRecord(rec as Record<string, unknown>);
    const date = pickDate(flat);
    if (!date) continue;
    const m: DailyMetric = { date };
    const hr = pickNumeric(flat, HEART_KEYS, 20, 250);
    if (hr != null) m.heartRate = hr;
    const steps = pickNumeric(flat, STEP_KEYS, 0, 200_000);
    if (steps != null) m.steps = steps;
    const sleep = pickNumeric(flat, SLEEP_KEYS, 0, 1440);
    if (sleep != null) m.sleepHours = sleep > 24 ? Math.round((sleep / 60) * 10) / 10 : Math.round(sleep * 10) / 10;
    const spo2 = pickNumeric(flat, SPO2_KEYS, 50, 100);
    if (spo2 != null) m.spo2 = spo2;
    const cal = pickNumeric(flat, CAL_KEYS, 0, 20_000);
    if (cal != null) m.calories = cal;
    out.push(m);
  }
  return out;
}

function collectJsonRecords(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === "object" && data !== null) {
    // Common wrapper keys
    const obj = data as Record<string, unknown>;
    for (const k of [
      "records",
      "data",
      "items",
      "entries",
      "sessions",
      "activities",
      "summary",
      "samples",
      "bucket",
    ]) {
      if (Array.isArray(obj[k])) return obj[k] as unknown[];
    }
    return [data];
  }
  return [];
}

function flattenRecord(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flattenRecord(v as Record<string, unknown>, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

function pickDate(flat: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(flat)) {
    const nk = normalizeKey(k);
    if (DATE_KEYS.includes(nk) || nk.endsWith("date") || nk.endsWith("timestamp") || nk.endsWith("starttime")) {
      const d = normalizeDate(typeof v === "number" ? String(v) : (v as string));
      if (d) return d;
    }
  }
  return null;
}

function pickNumeric(
  flat: Record<string, unknown>,
  keys: string[],
  min: number,
  max: number,
): number | null {
  for (const [k, v] of Object.entries(flat)) {
    const nk = normalizeKey(k);
    if (keys.some((kk) => nk === kk || nk.endsWith(kk))) {
      const n = clampNumber(v, min, max);
      if (n != null) return n;
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* XML (Apple Health export.xml shape)                                       */
/* ------------------------------------------------------------------------- */

function parseXml(text: string): DailyMetric[] {
  const records: DailyMetric[] = [];
  // Cap how much text we scan to avoid catastrophic backtracking.
  const limit = Math.min(text.length, 8 * 1024 * 1024);
  const slice = text.slice(0, limit);
  const recordRe = /<Record\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;
  while ((match = recordRe.exec(slice)) !== null) {
    const attrs = parseAttributes(match[1]);
    const type = attrs["type"] || "";
    const startDate = attrs["startDate"] || attrs["startdate"] || attrs["creationDate"];
    const valueStr = attrs["value"];
    if (!startDate || !valueStr) continue;
    const date = normalizeDate(startDate);
    if (!date) continue;
    const value = Number(valueStr);
    if (!Number.isFinite(value)) continue;
    const m: DailyMetric = { date };
    if (/HeartRate$/i.test(type)) m.heartRate = clamp(value, 20, 250);
    else if (/StepCount$/i.test(type)) m.steps = clamp(value, 0, 200_000);
    else if (/OxygenSaturation$/i.test(type)) m.spo2 = clamp(value * (value <= 1 ? 100 : 1), 50, 100);
    else if (/SleepAnalysis$/i.test(type)) m.sleepHours = clamp(value, 0, 24);
    else if (/EnergyBurned$/i.test(type) || /BasalEnergyBurned$/i.test(type)) {
      m.calories = clamp(value, 0, 20_000);
    } else continue;
    records.push(m);
  }
  return records;
}

function parseAttributes(attrText: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(attrText)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

function normalizeKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findColumn(header: string[], keys: string[]): number {
  for (let i = 0; i < header.length; i++) {
    if (keys.includes(header[i])) return i;
  }
  for (let i = 0; i < header.length; i++) {
    if (keys.some((k) => header[i].endsWith(k))) return i;
  }
  return -1;
}

function clampNumber(v: unknown, min: number, max: number): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[, ]/g, ""));
  if (!Number.isFinite(n)) return undefined;
  return clamp(n, min, max);
}

function clamp(n: number, min: number, max: number): number {
  if (n < min || n > max) return min === 0 && n < 0 ? 0 : Math.max(min, Math.min(max, n));
  return n;
}

function normalizeDate(s: string | number | undefined | null): string | null {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  // ISO yyyy-mm-dd
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // Apple Health: 2024-09-12 08:31:55 -0700
  const dt = new Date(str);
  if (!Number.isNaN(dt.getTime())) {
    const y = dt.getUTCFullYear();
    const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  // mm/dd/yyyy
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(str);
  if (us) {
    const y = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${y}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  // unix seconds or millis
  if (/^\d{10,13}$/.test(str)) {
    const n = Number(str);
    const ms = str.length === 13 ? n : n * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) {
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
      const da = String(d.getUTCDate()).padStart(2, "0");
      return `${y}-${mo}-${da}`;
    }
  }
  return null;
}

function aggregateByDate(metrics: DailyMetric[]): DailyMetric[] {
  const byDate = new Map<string, { hr: number[]; steps: number[]; sleep: number[]; spo2: number[]; cal: number[] }>();
  for (const m of metrics) {
    if (!byDate.has(m.date)) {
      byDate.set(m.date, { hr: [], steps: [], sleep: [], spo2: [], cal: [] });
    }
    const slot = byDate.get(m.date)!;
    if (m.heartRate != null) slot.hr.push(m.heartRate);
    if (m.steps != null) slot.steps.push(m.steps);
    if (m.sleepHours != null) slot.sleep.push(m.sleepHours);
    if (m.spo2 != null) slot.spo2.push(m.spo2);
    if (m.calories != null) slot.cal.push(m.calories);
  }
  const out: DailyMetric[] = [];
  for (const [date, slot] of byDate) {
    const m: DailyMetric = { date };
    if (slot.hr.length) m.heartRate = avg(slot.hr);
    if (slot.steps.length) m.steps = sum(slot.steps);
    if (slot.sleep.length) m.sleepHours = sum(slot.sleep);
    if (slot.spo2.length) m.spo2 = avg(slot.spo2);
    if (slot.cal.length) m.calories = sum(slot.cal);
    out.push(m);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

function avg(arr: number[]): number {
  return Math.round((arr.reduce((s, n) => s + n, 0) / arr.length) * 10) / 10;
}
function sum(arr: number[]): number {
  return Math.round(arr.reduce((s, n) => s + n, 0) * 10) / 10;
}
