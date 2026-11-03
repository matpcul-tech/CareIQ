import { aggregateMetrics, inRange, kgToLb, type DailyMetric } from "@/lib/wearable/model";
import { WITHINGS_MEAS_TYPES as T } from "./config";
import type { WithingsMeasureGroup } from "./api";

/** Real value = value * 10^unit (Withings Getmeas convention). */
export function realValue(m: { value: number; unit: number }): number {
  return m.value * Math.pow(10, m.unit);
}

/** YYYY-MM-DD in the user's Withings time zone, UTC when unknown or invalid. */
export function dayInZone(epochSec: number, timeZone: string | null): string {
  const date = new Date(epochSec * 1000);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(date);
      const get = (t: string) => parts.find((p) => p.type === t)?.value;
      const y = get("year");
      const mo = get("month");
      const d = get("day");
      if (y && mo && d) return `${y}-${mo}-${d}`;
    } catch {
      // fall through to UTC
    }
  }
  return date.toISOString().slice(0, 10);
}

/**
 * Maps Withings measure groups into the existing wearable DailyMetric
 * model: weight, blood pressure, heart rate, SpO2. Unknown types are
 * dropped. Out of range values are dropped by the model's own ranges.
 * Several readings on one day are combined by aggregateMetrics
 * (averages for vitals, latest weight).
 */
export function mapMeasureGroups(groups: WithingsMeasureGroup[], timeZone: string | null): DailyMetric[] {
  const sorted = [...groups].sort((a, b) => a.date - b.date);
  const perReading: DailyMetric[] = [];
  for (const g of sorted) {
    if (!Number.isFinite(g.date)) continue;
    const metric: DailyMetric = { date: dayInZone(g.date, timeZone) };
    let any = false;
    for (const m of g.measures ?? []) {
      const v = realValue(m);
      let out: number | undefined;
      switch (m.type) {
        case T.weightKg:
          out = inRange(kgToLb(v), "weightLb");
          if (out != null) { metric.weightLb = out; any = true; }
          break;
        case T.systolic:
          out = inRange(v, "bpSystolic");
          if (out != null) { metric.bpSystolic = out; any = true; }
          break;
        case T.diastolic:
          out = inRange(v, "bpDiastolic");
          if (out != null) { metric.bpDiastolic = out; any = true; }
          break;
        case T.heartPulse:
          out = inRange(v, "heartRate");
          if (out != null) { metric.heartRate = out; any = true; }
          break;
        case T.spo2:
          out = inRange(v, "spo2");
          if (out != null) { metric.spo2 = out; any = true; }
          break;
        default:
          break;
      }
    }
    if (any) perReading.push(metric);
  }
  return aggregateMetrics(perReading).sort((a, b) => a.date.localeCompare(b.date));
}
