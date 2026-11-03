import { type DailyMetric, inRange, kgToLb, normalizeDate } from "./model";

/**
 * Chunked scan of an Apple Health export.xml.
 * Record tags are read as they close. The rest of the file is not kept.
 * Sleep uses the start and end timestamps. In bed and awake segments are skipped.
 * Weight is kept only when the unit is kg or lb. Glucose is kept only for
 * mg/dL or mmol/L.
 */

interface Bucket {
  hr: number[];
  steps: number[];
  sleep: number[];
  spo2: number[];
  cal: number[];
  sys: number[];
  dia: number[];
  glucose: number[];
  weight?: number;
  hrv: number[];
}

export function createAppleXmlScanner() {
  let carry = "";
  const decoder = new TextDecoder("utf-8");
  const days = new Map<string, Bucket>();
  let sample = "";

  function bucket(date: string): Bucket {
    let found = days.get(date);
    if (!found) {
      found = { hr: [], steps: [], sleep: [], spo2: [], cal: [], sys: [], dia: [], glucose: [], hrv: [] };
      days.set(date, found);
    }
    return found;
  }

  function pushText(text: string) {
    if (sample.length < 4000) sample += text.slice(0, 4000 - sample.length);
    carry += text;
    let searchFrom = 0;
    while (carry.length > 0) {
      const start = carry.indexOf("<Record", searchFrom);
      if (start < 0) {
        carry = carry.slice(Math.max(0, carry.length - 7));
        return;
      }
      const end = carry.indexOf(">", start);
      if (end < 0) {
        carry = carry.slice(start);
        if (carry.length > 200_000) carry = "";
        return;
      }
      const tag = carry.slice(start, end + 1);
      consume(tag, bucket);
      searchFrom = 0;
      carry = carry.slice(end + 1);
    }
  }

  return {
    pushBytes(chunk: Uint8Array, final: boolean) {
      pushText(decoder.decode(chunk, { stream: !final }));
    },
    pushText,
    sample() {
      return sample;
    },
    finish(): DailyMetric[] {
      const out: DailyMetric[] = [];
      for (const [date, slot] of days) {
        const metric: DailyMetric = { date };
        const hr = mean(slot.hr);
        const steps = total(slot.steps);
        const sleep = total(slot.sleep);
        const spo2 = mean(slot.spo2);
        const cal = total(slot.cal);
        const sys = mean(slot.sys);
        const dia = mean(slot.dia);
        const glucose = mean(slot.glucose);
        const hrv = mean(slot.hrv);
        if (hr != null) metric.heartRate = inRange(hr, "heartRate");
        if (steps != null) metric.steps = inRange(steps, "steps");
        if (sleep != null) metric.sleepHours = inRange(Math.min(sleep, 24), "sleepHours");
        if (spo2 != null) metric.spo2 = inRange(spo2, "spo2");
        if (cal != null) metric.calories = inRange(cal, "calories");
        if (sys != null) metric.bpSystolic = inRange(sys, "bpSystolic");
        if (dia != null) metric.bpDiastolic = inRange(dia, "bpDiastolic");
        if (glucose != null) metric.glucose = inRange(glucose, "glucose");
        if (slot.weight != null) metric.weightLb = inRange(slot.weight, "weightLb");
        if (hrv != null) metric.hrv = inRange(hrv, "hrv");
        if (Object.keys(metric).length > 1) out.push(metric);
      }
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out.length > 3660 ? out.slice(out.length - 3660) : out;
    },
  };
}

function consume(tag: string, bucketFor: (date: string) => Bucket) {
  const attrs = parseAttributes(tag);
  const type = attrs.type || "";
  const start = attrs.startDate || attrs.creationDate || "";
  const date = normalizeDate(start);
  if (!date) return;
  const slot = bucketFor(date);
  const value = Number(attrs.value);
  if (/HeartRate$/.test(type) && Number.isFinite(value)) slot.hr.push(value);
  else if (/StepCount$/.test(type) && Number.isFinite(value)) slot.steps.push(value);
  else if (/OxygenSaturation$/.test(type) && Number.isFinite(value)) {
    slot.spo2.push(value <= 1 ? value * 100 : value);
  } else if (/SleepAnalysis$/.test(type)) {
    const kind = attrs.value || "";
    if (/Asleep/i.test(kind) && !/InBed|Awake/i.test(kind)) {
      const hours = hoursBetween(attrs.startDate, attrs.endDate);
      if (hours != null) slot.sleep.push(hours);
    }
  } else if (/ActiveEnergyBurned$/.test(type) || /BasalEnergyBurned$/.test(type)) {
    if (Number.isFinite(value)) slot.cal.push(value);
  } else if (/BloodPressureSystolic$/.test(type) && Number.isFinite(value)) slot.sys.push(value);
  else if (/BloodPressureDiastolic$/.test(type) && Number.isFinite(value)) slot.dia.push(value);
  else if (/BloodGlucose$/.test(type) && Number.isFinite(value)) {
    const unit = (attrs.unit || "").toLowerCase();
    if (unit.includes("mmol")) slot.glucose.push(value * 18.01559);
    else if (unit.includes("mg")) slot.glucose.push(value);
  } else if (/BodyMass$/.test(type) && Number.isFinite(value)) {
    const unit = (attrs.unit || "").toLowerCase();
    if (unit === "kg") slot.weight = kgToLb(value);
    else if (unit === "lb") slot.weight = value;
  } else if (/HeartRateVariabilitySDNN$/.test(type) && Number.isFinite(value)) {
    slot.hrv.push(value);
  }
}

function hoursBetween(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return null;
  const hours = (b - a) / 3_600_000;
  if (hours <= 0 || hours > 24) return null;
  return hours;
}

function parseAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const attrRe = /([A-Za-z_:][\w.:-]*)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
}

function mean(list: number[]): number | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

function total(list: number[]): number | undefined {
  if (list.length === 0) return undefined;
  return list.reduce((sum, n) => sum + n, 0);
}
