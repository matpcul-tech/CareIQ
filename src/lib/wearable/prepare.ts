import { unzipSync, Unzip, UnzipInflate, strFromU8 } from "fflate";
import { createAppleXmlScanner } from "./apple-xml";
import { detectColumnMap, deviceFromCsv, metricsFromCsv, readCsvTable, type ColumnMap, type CsvTable } from "./csv";
import { metricsFromFitBytes, metricsFromFitTree } from "./fit";
import { metricsFromJson } from "./json";
import {
  type DailyMetric,
  type DeviceType,
  type SourceFormat,
  type WearableSummary,
  aggregateMetrics,
  detectDevice,
  toSummary,
} from "./model";

export interface MappingRequest {
  headers: string[];
  rows: string[][];
  fileName: string;
  deviceType: DeviceType;
  sourceFormat: SourceFormat;
}

export type PrepareResult =
  | { ok: true; summary: WearableSummary }
  | { ok: false; needsMapping: true; mapping: MappingRequest }
  | { ok: false; error: string };

export async function prepareWearableFile(file: File): Promise<PrepareResult> {
  const name = file.name || "export";
  if (/\.zip$/i.test(name)) return readZipFile(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return readZipBytes(bytes);
  return prepareWearableBytes(name, bytes);
}

export async function prepareWearableBytes(name: string, bytes: Uint8Array): Promise<PrepareResult> {
  const lower = name.toLowerCase();
  if (lower.endsWith(".zip") || (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    return readZipBytes(bytes);
  }
  if (lower.endsWith(".fit")) return finishFit(name, bytes);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (lower.endsWith(".xml") || text.trimStart().startsWith("<")) {
    return finishXml(name, text, "xml");
  }
  if (lower.endsWith(".json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    return finishMetrics(detectDevice(text.slice(0, 4000), name), "json", metricsFromJson(text));
  }
  return finishCsv(name, text, "csv");
}

export function summaryFromColumnMap(mapping: MappingRequest, map: ColumnMap): PrepareResult {
  const table: CsvTable = { headers: mapping.headers, rows: mapping.rows };
  const metrics = metricsFromCsv(table, map);
  return finishMetrics(mapping.deviceType, mapping.sourceFormat, metrics);
}

function finishXml(name: string, text: string, sourceFormat: SourceFormat): PrepareResult {
  const scanner = createAppleXmlScanner();
  const size = 32_768;
  for (let i = 0; i < text.length; i += size) {
    scanner.pushText(text.slice(i, i + size));
  }
  return finishMetrics(detectDevice(scanner.sample(), name), sourceFormat, scanner.finish());
}

async function finishFit(name: string, bytes: Uint8Array): Promise<PrepareResult> {
  try {
    const metrics = await metricsFromFitBytes(bytes);
    const device = /\bpolar\b/i.test(name) ? "polar" : detectDevice(name, name);
    return finishMetrics(device === "other" ? "garmin" : device, "fit", metrics);
  } catch {
    return { ok: false, error: "Could not read that FIT file." };
  }
}

function finishCsv(name: string, text: string, sourceFormat: SourceFormat): PrepareResult {
  const table = readCsvTable(text);
  if (!table) return { ok: false, error: "No rows were found in that CSV." };
  const map = detectColumnMap(table.headers);
  if (!map || (map.weight != null && !map.weightUnit)) {
    return {
      ok: false,
      needsMapping: true,
      mapping: {
        headers: table.headers,
        rows: table.rows,
        fileName: name,
        deviceType: deviceFromCsv(table, name),
        sourceFormat,
      },
    };
  }
  return finishMetrics(deviceFromCsv(table, name), sourceFormat, metricsFromCsv(table, map));
}

function finishMetrics(deviceType: DeviceType, sourceFormat: SourceFormat, metrics: DailyMetric[]): PrepareResult {
  const summary = toSummary(deviceType, sourceFormat, metrics);
  if (summary.metrics.length === 0) {
    return { ok: false, error: "No daily metrics were found in that file." };
  }
  return { ok: true, summary };
}

async function readZipFile(file: File): Promise<PrepareResult> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const step = await reader.read();
    if (step.done) break;
    chunks.push(step.value);
  }
  return readZipBytes(concat(chunks));
}

export async function readZipBytes(bytes: Uint8Array): Promise<PrepareResult> {
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const found: { name: string; scanner: ReturnType<typeof createAppleXmlScanner> | null } = {
    name: "",
    scanner: null,
  };
  const files: Array<{ name: string; chunks: Uint8Array[] }> = [];
  unzip.onfile = (file) => {
    const base = file.name.split("/").pop() || file.name;
    if (base.toLowerCase() === "export.xml") {
      found.name = file.name;
      found.scanner = createAppleXmlScanner();
      const scanner = found.scanner;
      file.ondata = (err, data) => {
        if (err) throw err;
        if (data && data.length > 0) scanner.pushBytes(data, false);
      };
      file.start();
      return;
    }
    const chunks: Uint8Array[] = [];
    file.ondata = (err, data) => {
      if (err) throw err;
      if (data && data.length > 0) chunks.push(data);
    };
    file.start();
    files.push({ name: file.name, chunks });
  };
  try {
    const size = 1024;
    for (let offset = 0; offset < bytes.length; offset += size) {
      const final = offset + size >= bytes.length;
      unzip.push(bytes.subarray(offset, Math.min(bytes.length, offset + size)), final);
    }
    if (bytes.length === 0) unzip.push(new Uint8Array(0), true);
  } catch {
    return { ok: false, error: "Could not unzip that file." };
  }
  if (found.scanner && found.name) {
    const metrics = found.scanner.finish();
    if (metrics.length > 0) {
      return finishMetrics(detectDevice(found.scanner.sample(), found.name), "zip", metrics);
    }
  }
  return chooseZippedFile(files);
}

async function chooseZippedFile(files: Array<{ name: string; chunks: Uint8Array[] }>): Promise<PrepareResult> {
  const joined = files.map((file) => ({
    name: file.name,
    bytes: concat(file.chunks),
  })).filter((file) => file.bytes.length > 0);
  const fit = joined.find((file) => file.name.toLowerCase().endsWith(".fit"));
  if (fit) return finishFit(fit.name, fit.bytes);
  const csv = joined.find((file) => file.name.toLowerCase().endsWith(".csv"));
  if (csv) return finishCsv(csv.name, new TextDecoder().decode(csv.bytes), "zip");
  const json = joined.find((file) => file.name.toLowerCase().endsWith(".json"));
  if (json) {
    const text = new TextDecoder().decode(json.bytes);
    return finishMetrics(detectDevice(text.slice(0, 4000), json.name), "zip", metricsFromJson(text));
  }
  const xml = joined.find((file) => file.name.toLowerCase().endsWith(".xml"));
  if (xml) return finishXml(xml.name, new TextDecoder().decode(xml.bytes), "zip");
  return { ok: false, error: "No wearable export was found inside that zip." };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function zipHasEntries(bytes: Uint8Array): string[] {
  const opened = unzipSync(bytes);
  return Object.keys(opened);
}

export function textFromZip(bytes: Uint8Array, name: string): string {
  const opened = unzipSync(bytes);
  const hit = Object.entries(opened).find(([key]) => key.endsWith(name));
  if (!hit) return "";
  return strFromU8(hit[1]);
}

export { aggregateMetrics, metricsFromFitTree };
