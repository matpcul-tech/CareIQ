import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  CHECK_INTERVAL_MS,
  SAFETY_DISCLAIMER,
  buildSyncSources,
  lastSyncedText,
  newestSync,
  relativeAge,
  staleNote,
  syncFreshness,
} from "../src/lib/sync-status";

const NOW = Date.parse("2026-11-03T15:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("relative age reads naturally", () => {
  assert.equal(relativeAge(ago(10_000), NOW), "just now");
  assert.equal(relativeAge(ago(MIN), NOW), "1 minute ago");
  assert.equal(relativeAge(ago(5 * MIN), NOW), "5 minutes ago");
  assert.equal(relativeAge(ago(3 * HOUR), NOW), "3 hours ago");
  assert.equal(relativeAge(ago(3 * DAY), NOW), "3 days ago");
  assert.equal(relativeAge(null, NOW), null);
  assert.equal(relativeAge("not a date", NOW), null);
});

test("last synced text shows stale data as stale", () => {
  assert.equal(lastSyncedText(ago(3 * DAY + HOUR), NOW), "Last synced 3 days ago");
  assert.equal(lastSyncedText(null, NOW), "Never synced");
});

test("freshness levels", () => {
  assert.equal(syncFreshness(ago(30 * MIN), NOW), "recent");
  assert.equal(syncFreshness(ago(12 * HOUR), NOW), "stale");
  assert.equal(syncFreshness(ago(4 * DAY), NOW), "old");
  assert.equal(syncFreshness(null, NOW), "never");
  assert.equal(staleNote("recent"), null);
  assert.match(staleNote("old") || "", /Out of date/);
});

test("one entry per source with the newest upload time", () => {
  const sources = buildSyncSources([
    { device_type: "fitbit", uploaded_at: ago(DAY) },
    { device_type: "fitbit", uploaded_at: ago(5 * DAY) },
    { device_type: "generic", uploaded_at: ago(2 * HOUR), device: "omron" },
    { device_type: "garmin", uploaded_at: ago(10 * DAY) },
  ], [
    { source: "manual", label: "Health history and entered readings", kind: "manual", last_synced_at: ago(3 * DAY) },
  ]);
  assert.deepEqual(sources.map((s) => s.source), ["omron", "fitbit", "manual", "garmin"]);
  assert.equal(sources.find((s) => s.source === "fitbit")?.last_synced_at, ago(DAY));
  assert.equal(sources.find((s) => s.source === "omron")?.label, "Omron upload");
  assert.equal(newestSync(sources), ago(2 * HOUR));
  assert.equal(newestSync([]), null);
});

test("a connected account replaces the upload entry for the same device", () => {
  const sources = buildSyncSources(
    [{ device_type: "withings", uploaded_at: ago(DAY) }],
    [{ source: "withings", label: "Withings (connected)", kind: "connected", last_synced_at: ago(HOUR) }],
  );
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, "connected");
  assert.equal(sources[0].last_synced_at, ago(HOUR));
});

test("source entries carry no reading values", () => {
  const [s] = buildSyncSources([{ device_type: "fitbit", uploaded_at: ago(HOUR) }]);
  assert.deepEqual(Object.keys(s).sort(), ["kind", "label", "last_synced_at", "source"]);
});

test("disclaimer text and check interval", () => {
  assert.match(SAFETY_DISCLAIMER, /not an emergency service or medical alert device/);
  assert.match(SAFETY_DISCLAIMER, /delayed by minutes to hours/);
  assert.match(SAFETY_DISCLAIMER, /call 911/);
  assert.ok(CHECK_INTERVAL_MS >= 60_000, "dashboards must not poll every few seconds");
});

test("dashboards no longer poll every 5 seconds or show a pulsing live badge", () => {
  const sections = readFileSync(path.join(__dirname, "../src/components/careiq/Sections.tsx"), "utf8");
  assert.doesNotMatch(sections, /POLL_MS = 5000/);
  assert.doesNotMatch(sections, /animation: 'pulse/);
  assert.match(sections, /SafetyDisclaimer/);
  for (const f of ["../src/components/CareIQHealthOS.tsx", "../src/app/dashboard/page.tsx"]) {
    const src = readFileSync(path.join(__dirname, f), "utf8");
    assert.match(src, /SafetyDisclaimer/, f);
    assert.match(src, /SyncSource/, f);
  }
});
