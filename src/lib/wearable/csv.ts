import {
  type DailyMetric,
  type DeviceType,
  detectDevice,
  inRange,
  kgToLb,
  normalizeDate,
  normalizeKey,
} from "./model";

export interface ColumnMap {
  date: number;
  heartRate?: number;
  steps?: number;
  sleep?: number;
  spo2?: number;
  calories?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  glucose?: number;
  weight?: number;
  hrv?: number;
  weightUnit?: "lb" | "kg";
  glucoseUnit?: "mg/dL" | "mmol/L";
}

export interface CsvTable {
  headers: string[];
  rows: string[][];
}

const DATE_KEYS = ["date", "day", "datetime", "startdate", "starttime", "timestamp", "dateofmeasurement", "createtime", "daytime"];
const HEART_KEYS = ["heartrate", "heart_rate", "hr", "averageheartrate", "restingheartrate", "bpm", "beatsperminute"];
const STEP_KEYS = ["steps", "stepcount", "step_count", "totalsteps"];
const SLEEP_KEYS = ["sleep", "sleephours", "sleep_hours", "asleep", "totalsleep", "minutesasleep", "sleepduration"];
const SPO2_KEYS = ["spo2", "oxygensaturation", "oxygen_saturation", "saturation"];
const CAL_KEYS = ["calories", "energyburned", "activecalories", "totalcalories", "calorie"];
const SYS_KEYS = ["systolic", "bpsystolic", "systolicmmhg", "bloodpressuresystolic", "systolicbloodpressure"];
const DIA_KEYS = ["diastolic", "bpdiastolic", "diastolicmmhg", "bloodpressurediastolic", "diastolicbloodpressure"];
const GLUCOSE_KEYS = ["glucose", "bloodglucose", "bloodsugar"];
const WEIGHT_KEYS = ["weight", "bodyweight", "bodymass"];
const HRV_KEYS = ["hrv", "rmssd", "sdnn", "heartratevariability"];

function matches(header: string, keys: string[]): boolean {
  return keys.some((key) => {
    const normalized = normalizeKey(key);
    return header === normalized || header.endsWith(normalized) || header.includes(normalized);
  });
}

function findColumn(header: string[], keys: string[]): number {
  for (let i = 0; i < header.length; i++) {
    if (matches(header[i], keys)) return i;
  }
  return -1;
}

export function parseCsvRows(text: string): string[][] {
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
      row.push(field.trim());
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.trim());
    if (row.some((cell) => cell !== "")) rows.push(row);
  }
  return rows;
}

export function readCsvTable(text: string): CsvTable | null {
  const parsed = parseCsvRows(text);
  if (parsed.length < 2) return null;
  return {
    headers: parsed[0],
    rows: parsed.slice(1),
  };
}

export function detectColumnMap(headers: string[]): ColumnMap | null {
  const normalized = headers.map(normalizeKey);
  const date = findColumn(normalized, DATE_KEYS);
  if (date < 0) return null;
  const typeCol = findColumn(normalized, ["type", "recordtype", "datatype"]);
  const valueCol = findColumn(normalized, ["value"]);
  const map: ColumnMap = { date };
  if (typeCol >= 0 && valueCol >= 0 && typeCol !== date) {
    map.heartRate = typeCol;
    map.steps = valueCol;
    return map;
  }
  assign(map, "heartRate", findColumn(normalized, HEART_KEYS));
  assign(map, "steps", findColumn(normalized, STEP_KEYS));
  assign(map, "sleep", findColumn(normalized, SLEEP_KEYS));
  assign(map, "spo2", findColumn(normalized, SPO2_KEYS));
  assign(map, "calories", findColumn(normalized, CAL_KEYS));
  assign(map, "bpSystolic", findColumn(normalized, SYS_KEYS));
  assign(map, "bpDiastolic", findColumn(normalized, DIA_KEYS));
  assign(map, "glucose", findColumn(normalized, GLUCOSE_KEYS));
  assign(map, "weight", findColumn(normalized, WEIGHT_KEYS));
  assign(map, "hrv", findColumn(normalized, HRV_KEYS));
  const metricCount = [
    map.heartRate, map.steps, map.sleep, map.spo2, map.calories,
    map.bpSystolic, map.bpDiastolic, map.glucose, map.weight, map.hrv,
  ].filter((index) => index != null && index >= 0).length;
  if (metricCount === 0) return null;
  if (map.weight != null) {
    const name = normalized[map.weight];
    if (name.includes("kg")) map.weightUnit = "kg";
    else if (name.includes("lb")) map.weightUnit = "lb";
  }
  if (map.glucose != null) {
    const name = normalized[map.glucose];
    if (name.includes("mmol")) map.glucoseUnit = "mmol/L";
    else if (name.includes("mg")) map.glucoseUnit = "mg/dL";
  }
  return map;
}

function assign(map: ColumnMap, key: keyof ColumnMap, index: number) {
  if (index >= 0) (map as unknown as Record<string, number>)[key] = index;
}

export function columnMapIsLong(map: ColumnMap, headers: string[]): boolean {
  if (map.heartRate == null || map.steps == null) return false;
  const typeName = normalizeKey(headers[map.heartRate] || "");
  const valueName = normalizeKey(headers[map.steps] || "");
  return (typeName === "type" || typeName === "recordtype" || typeName === "datatype")
    && (valueName === "value" || valueName.endsWith("value"));
}

export function metricsFromCsv(table: CsvTable, map: ColumnMap): DailyMetric[] {
  if (columnMapIsLong(map, table.headers)) return metricsFromLongCsv(table, map);
  const out: DailyMetric[] = [];
  for (const row of table.rows) {
    const date = normalizeDate(row[map.date]);
    if (!date) continue;
    const metric: DailyMetric = { date };
    setNumber(metric, "heartRate", row[map.heartRate ?? -1]);
    setNumber(metric, "steps", row[map.steps ?? -1]);
    const sleep = numberFrom(row[map.sleep ?? -1]);
    if (sleep != null) {
      const hours = sleep > 24 ? sleep / 60 : sleep;
      const ranged = inRange(hours, "sleepHours");
      if (ranged != null) metric.sleepHours = ranged;
    }
    setNumber(metric, "spo2", row[map.spo2 ?? -1]);
    setNumber(metric, "calories", row[map.calories ?? -1]);
    setNumber(metric, "bpSystolic", row[map.bpSystolic ?? -1]);
    setNumber(metric, "bpDiastolic", row[map.bpDiastolic ?? -1]);
    const glucose = numberFrom(row[map.glucose ?? -1]);
    if (glucose != null && map.glucoseUnit) {
      const mg = map.glucoseUnit === "mmol/L" ? glucose * 18.01559 : glucose;
      const ranged = inRange(mg, "glucose");
      if (ranged != null) metric.glucose = ranged;
    }
    const weight = numberFrom(row[map.weight ?? -1]);
    if (weight != null && map.weightUnit) {
      const pounds = map.weightUnit === "kg" ? kgToLb(weight) : weight;
      const ranged = inRange(pounds, "weightLb");
      if (ranged != null) metric.weightLb = ranged;
    }
    setNumber(metric, "hrv", row[map.hrv ?? -1]);
    out.push(metric);
  }
  return out;
}

function metricsFromLongCsv(table: CsvTable, map: ColumnMap): DailyMetric[] {
  const typeIndex = map.heartRate as number;
  const valueIndex = map.steps as number;
  const unitIndex = table.headers.findIndex((header) => normalizeKey(header) === "unit");
  const out: DailyMetric[] = [];
  for (const row of table.rows) {
    const date = normalizeDate(row[map.date]);
    if (!date) continue;
    const metric = metricFromNamedValue(row[typeIndex] || "", row[valueIndex] || "", unitIndex >= 0 ? row[unitIndex] : "");
    if (!metric) continue;
    metric.date = date;
    out.push(metric);
  }
  return out;
}

function metricFromNamedValue(type: string, rawValue: string, unit: string): DailyMetric | null {
  const name = normalizeKey(type + unit);
  const value = numberFrom(rawValue);
  if (value == null) return null;
  const metric: DailyMetric = { date: "" };
  if (name.includes("heartrate") && !name.includes("variab")) {
    const ranged = inRange(value, "heartRate");
    if (ranged == null) return null;
    metric.heartRate = ranged;
  } else if (name.includes("step")) {
    const ranged = inRange(value, "steps");
    if (ranged == null) return null;
    metric.steps = ranged;
  } else if (name.includes("sleep")) {
    const hours = value > 24 ? value / 60 : value;
    const ranged = inRange(hours, "sleepHours");
    if (ranged == null) return null;
    metric.sleepHours = ranged;
  } else if (name.includes("spo2") || name.includes("oxygen")) {
    const ranged = inRange(value <= 1 ? value * 100 : value, "spo2");
    if (ranged == null) return null;
    metric.spo2 = ranged;
  } else if (name.includes("calorie")) {
    const ranged = inRange(value, "calories");
    if (ranged == null) return null;
    metric.calories = ranged;
  } else if (name.includes("systolic")) {
    const ranged = inRange(value, "bpSystolic");
    if (ranged == null) return null;
    metric.bpSystolic = ranged;
  } else if (name.includes("diastolic")) {
    const ranged = inRange(value, "bpDiastolic");
    if (ranged == null) return null;
    metric.bpDiastolic = ranged;
  } else if (name.includes("glucose")) {
    if (!name.includes("mmol") && !name.includes("mg")) return null;
    const mg = name.includes("mmol") ? value * 18.01559 : value;
    const ranged = inRange(mg, "glucose");
    if (ranged == null) return null;
    metric.glucose = ranged;
  } else if (name.includes("weight") || name.includes("bodymass")) {
    const pounds = name.includes("kg") ? kgToLb(value) : value;
    if (!name.includes("kg") && !name.includes("lb")) return null;
    const ranged = inRange(pounds, "weightLb");
    if (ranged == null) return null;
    metric.weightLb = ranged;
  } else if (name.includes("hrv") || name.includes("rmssd") || name.includes("sdnn")) {
    const ranged = inRange(value, "hrv");
    if (ranged == null) return null;
    metric.hrv = ranged;
  } else {
    return null;
  }
  return metric;
}

function setNumber(metric: DailyMetric, key: "heartRate" | "steps" | "spo2" | "calories" | "bpSystolic" | "bpDiastolic" | "hrv", raw: string | undefined) {
  const value = numberFrom(raw);
  if (value == null) return;
  const ranged = inRange(value, key);
  if (ranged != null) metric[key] = ranged;
}

function numberFrom(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === "") return undefined;
  const value = Number(raw.replace(/[, ]/g, ""));
  return Number.isFinite(value) ? value : undefined;
}

export function deviceFromCsv(table: CsvTable, fileName: string): DeviceType {
  return detectDevice(table.headers.join(","), fileName);
}
