import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { createAppleXmlScanner } from "../src/lib/wearable/apple-xml";
import { metricsFromFitBytes, metricsFromFitTree } from "../src/lib/wearable/fit";
import {
  parseWearableSummary,
  wearableSummarySchema,
  weightLbForLe8,
} from "../src/lib/wearable/model";
import { prepareWearableBytes, readZipBytes, summaryFromColumnMap } from "../src/lib/wearable/prepare";

test("summary validation stays strict", () => {
  const good = parseWearableSummary({
    deviceType: "omron",
    sourceFormat: "csv",
    metrics: [{
      date: "2026-01-02",
      heartRate: 70,
      steps: 1000,
      sleepHours: 7.5,
      spo2: 98,
      calories: 400,
      bpSystolic: 122,
      bpDiastolic: 78,
      glucose: 99,
      weightLb: 180,
      hrv: 42,
    }],
  });
  assert.equal(good.metrics[0].bpSystolic, 122);
  assert.equal(good.metrics[0].weightLb, 180);
  assert.equal(wearableSummarySchema.safeParse({
    deviceType: "omron",
    sourceFormat: "csv",
    metrics: [{ date: "2026-01-02", heartRate: 70 }],
    rawFile: "nope",
  }).success, false);
  assert.equal(wearableSummarySchema.safeParse({
    deviceType: "omron",
    sourceFormat: "csv",
    metrics: [{ date: "2026-01-02", heartRate: 400 }],
  }).success, false);
  assert.equal(wearableSummarySchema.safeParse({
    deviceType: "not-a-device",
    sourceFormat: "csv",
    metrics: [{ date: "2026-01-02", heartRate: 70 }],
  }).success, false);
});

test("Samsung and Health Connect headers are recognized", async () => {
  const samsung = await prepareWearableBytes("com.samsung.health.heart_rate.csv", strToU8(
    "start_time,heart_rate,step_count\n2026-02-02T08:00:00,71,2500\n",
  ));
  assert.equal(samsung.ok, true);
  if (!samsung.ok) return;
  assert.equal(samsung.summary.deviceType, "samsung");
  assert.equal(samsung.summary.metrics[0].heartRate, 71);
  assert.equal(samsung.summary.metrics[0].steps, 2500);

  const health = await prepareWearableBytes("health connect.csv", strToU8(
    "Start time,Heart rate (bpm),Blood glucose (mg/dL),Weight (kg)\n2026-03-03T00:00:00Z,64,101,80\n",
  ));
  assert.equal(health.ok, true);
  if (!health.ok) return;
  assert.equal(health.summary.deviceType, "health_connect");
  assert.equal(health.summary.metrics[0].glucose, 101);
  assert.ok((health.summary.metrics[0].weightLb || 0) > 170);
});

test("unknown CSV asks for a column match", async () => {
  const unknown = await prepareWearableBytes("band.csv", strToU8(
    "when,pulse,walks\n2026-04-04,60,3000\n",
  ));
  assert.equal(unknown.ok, false);
  if (unknown.ok || !("needsMapping" in unknown)) return;
  const saved = summaryFromColumnMap(unknown.mapping, {
    date: 0,
    heartRate: 1,
    steps: 2,
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.equal(saved.summary.metrics[0].heartRate, 60);
  assert.equal(saved.summary.metrics[0].steps, 3000);
});

test("Apple export.xml is read in chunks, including inside a zip", async () => {
  const xml = [
    '<?xml version="1.0"?>',
    "<HealthData>",
    '<Record type="HKQuantityTypeIdentifierHeartRate" startDate="2026-06-01 08:00:00 -0700" value="72" unit="count/min"/>',
    '<Record type="HKQuantityTypeIdentifierBodyMass" startDate="2026-06-01 09:00:00 -0700" value="80" unit="kg"/>',
    '<Record type="HKCategoryTypeIdentifierSleepAnalysis" startDate="2026-06-01 22:00:00 -0700" endDate="2026-06-02 05:00:00 -0700" value="HKCategoryValueSleepAnalysisAsleep"/>',
    "</HealthData>",
  ].join("");
  const scanner = createAppleXmlScanner();
  const cut = xml.indexOf("BodyMass");
  scanner.pushText(xml.slice(0, cut + 4));
  scanner.pushText(xml.slice(cut + 4));
  const days = scanner.finish();
  assert.equal(days[0].heartRate, 72);
  assert.ok((days[0].weightLb || 0) > 170);
  assert.equal(days[0].sleepHours, 7);

  const zipped = zipSync({ "export.xml": strToU8(xml), "note.txt": strToU8("ignore") });
  const fromZip = await readZipBytes(zipped);
  assert.equal(fromZip.ok, true);
  if (!fromZip.ok) return;
  assert.equal(fromZip.summary.deviceType, "apple_watch");
  assert.equal(fromZip.summary.sourceFormat, "zip");
  assert.equal(fromZip.summary.metrics[0].heartRate, 72);
});

test("FIT records reduce to a daily summary and a bad file is rejected", async () => {
  const metrics = metricsFromFitTree({
    records: [{ timestamp: "2026-07-07T15:00:00Z", heart_rate: 68, weight: 70, systolic_pressure: 118, diastolic_pressure: 76 }],
  });
  assert.equal(metrics[0].heartRate, 68);
  assert.equal(metrics[0].bpSystolic, 118);
  assert.ok((metrics[0].weightLb || 0) > 150);
  await assert.rejects(() => metricsFromFitBytes(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])));
});

test("device weight feeds LE8 only when height is on file", () => {
  const wearable = [
    { date: "2026-01-01", weightLb: 160 },
    { date: "2026-02-01", weightLb: 170 },
  ];
  assert.equal(weightLbForLe8({ manualWeightLb: 150, heightIn: 70, wearable }), 150);
  assert.equal(weightLbForLe8({ heightIn: 70, wearable }), 170);
  assert.equal(weightLbForLe8({ wearable }), undefined);
  assert.equal(weightLbForLe8({ heightIn: 70, wearable: [] }), undefined);
});

test("migration widens device labels and is not applied from this repo", () => {
  const sql = readFileSync("supabase/migrations/0012_wearable_device_types.sql", "utf8");
  for (const label of ["withings", "omron", "dexcom", "libre", "health_connect", "oura", "polar", "other"]) {
    assert.match(sql, new RegExp(`'${label}'`));
  }
  assert.match(sql, /has not been applied/);
  assert.match(sql, /Matthew must approve/);
});

test("upload surfaces say any device and do not claim a live connection", () => {
  const files = [
    "src/components/WearableUpload.tsx",
    "src/components/CareIQHealthOS.tsx",
    "src/app/connect-device/page.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /Upload an export from any device/);
    assert.match(source, /does not track RPM time/);
    assert.equal(/[\u2013\u2014]/.test(source), false, file);
  }
});
