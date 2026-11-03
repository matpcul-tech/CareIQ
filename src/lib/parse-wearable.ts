import "server-only";
import { createAppleXmlScanner } from "./wearable/apple-xml";
import { detectColumnMap, metricsFromCsv, readCsvTable } from "./wearable/csv";
import { metricsFromJson } from "./wearable/json";
import {
  type DailyMetric,
  type DeviceType,
  aggregateMetrics,
  detectDevice,
} from "./wearable/model";

export type { DailyMetric, DeviceType };

export interface ParsedWearable {
  deviceType: DeviceType;
  metrics: DailyMetric[];
  sourceFormat: "csv" | "json" | "xml";
}

export function parseWearable(input: string | Uint8Array, format: "csv" | "json" | "xml"): ParsedWearable {
  const text = typeof input === "string" ? input : new TextDecoder("utf-8", { fatal: false }).decode(input);
  if (text.length === 0) throw new Error("empty wearable file");
  if (text.length > 25 * 1024 * 1024) throw new Error("wearable file too large to parse");
  const deviceType = detectDevice(text.slice(0, 8000));
  let metrics: DailyMetric[] = [];
  if (format === "csv") {
    const table = readCsvTable(text);
    const map = table ? detectColumnMap(table.headers) : null;
    if (table && map && !(map.weight != null && !map.weightUnit)) {
      metrics = metricsFromCsv(table, map);
    }
  } else if (format === "json") {
    metrics = metricsFromJson(text);
  } else if (format === "xml") {
    const scanner = createAppleXmlScanner();
    const size = 32_768;
    for (let i = 0; i < text.length; i += size) scanner.pushText(text.slice(i, i + size));
    metrics = scanner.finish();
  } else {
    throw new Error("unsupported format");
  }
  return { deviceType, metrics: aggregateMetrics(metrics), sourceFormat: format };
}
