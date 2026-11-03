/**
 * "Last synced" helpers shared by the patient views and the CareCircle
 * payload. Pure functions only, safe for client and server code.
 *
 * A source is one place readings come from: an uploaded wearable export
 * (per device), a connected Withings account, or manually entered labs.
 * The timestamp is when CareIQ last received data from that source. It
 * is not when the device took the reading, and it is never "live".
 */

export type SyncFreshness = "recent" | "stale" | "old" | "never";

export interface SyncSource {
  /** Stable key, for example "fitbit", "withings", "manual". */
  source: string;
  /** Human label, for example "Fitbit upload". */
  label: string;
  /** How the data arrives. */
  kind: "upload" | "connected" | "manual";
  /** ISO timestamp of the last time CareIQ received data, or null. */
  last_synced_at: string | null;
}

export const SAFETY_DISCLAIMER =
  "CareIQ and CareCircle are not an emergency service or medical alert device. " +
  "Readings can be delayed by minutes to hours. In an emergency, call 911.";

/** Data newer than this reads as recent. */
export const RECENT_MS = 6 * 60 * 60 * 1000;
/** Data older than this reads as old (strong warning). */
export const OLD_MS = 3 * 24 * 60 * 60 * 1000;

/** How often the dashboards check CareIQ for new data. Not a device refresh. */
export const CHECK_INTERVAL_MS = 60 * 1000;

const DEVICE_LABELS: Record<string, string> = {
  fitbit: "Fitbit",
  apple_watch: "Apple Watch",
  garmin: "Garmin",
  samsung: "Samsung Health",
  google_fit: "Google Fit",
  generic: "Wearable file",
  withings: "Withings",
  omron: "Omron",
  dexcom: "Dexcom",
  libre: "FreeStyle Libre",
  health_connect: "Health Connect",
  oura: "Oura",
  polar: "Polar",
  other: "Wearable file",
  manual: "Manually entered readings",
};

export function deviceLabel(device: string): string {
  return DEVICE_LABELS[device] || "Wearable file";
}

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

export function syncFreshness(iso: string | null | undefined, nowMs: number = Date.now()): SyncFreshness {
  const ms = toMs(iso);
  if (ms == null) return "never";
  const age = Math.max(0, nowMs - ms);
  if (age <= RECENT_MS) return "recent";
  if (age <= OLD_MS) return "stale";
  return "old";
}

/** "just now", "5 minutes ago", "3 hours ago", "3 days ago". */
export function relativeAge(iso: string | null | undefined, nowMs: number = Date.now()): string | null {
  const ms = toMs(iso);
  if (ms == null) return null;
  const sec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

/** "Last synced 3 days ago" or "Never synced". */
export function lastSyncedText(iso: string | null | undefined, nowMs: number = Date.now()): string {
  const rel = relativeAge(iso, nowMs);
  return rel ? `Last synced ${rel}` : "Never synced";
}

export function staleNote(freshness: SyncFreshness): string | null {
  if (freshness === "stale") return "Not recent. Readings may not reflect how the patient is doing now.";
  if (freshness === "old") return "Out of date. Do not rely on these readings.";
  if (freshness === "never") return "No data received yet.";
  return null;
}

export interface WearableRowMeta {
  device_type: string | null;
  uploaded_at: string | null;
  /** Device name from the encrypted summary, when the column holds "generic". */
  device?: string | null;
}

/**
 * Collapses wearable rows into one entry per device with the newest
 * upload time. Rows are typically already ordered newest first, but the
 * function does not rely on that.
 */
export function buildSyncSources(
  rows: WearableRowMeta[],
  extra: SyncSource[] = [],
): SyncSource[] {
  const byKey = new Map<string, SyncSource>();
  for (const row of rows) {
    const key = (row.device || row.device_type || "generic").toLowerCase();
    const prev = byKey.get(key);
    const at = row.uploaded_at ?? null;
    if (!prev) {
      byKey.set(key, {
        source: key,
        label: `${deviceLabel(key)} upload`,
        kind: "upload",
        last_synced_at: at,
      });
      continue;
    }
    if ((toMs(at) ?? -1) > (toMs(prev.last_synced_at) ?? -1)) prev.last_synced_at = at;
  }
  for (const item of extra) {
    const prev = byKey.get(item.source);
    if (prev && item.kind === "connected") {
      // A connected account replaces the upload entry for the same device,
      // keeping whichever timestamp is newer.
      const newer = (toMs(item.last_synced_at) ?? -1) >= (toMs(prev.last_synced_at) ?? -1)
        ? item.last_synced_at
        : prev.last_synced_at;
      byKey.set(item.source, { ...item, last_synced_at: newer });
    } else if (!prev) {
      byKey.set(item.source, item);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => (toMs(b.last_synced_at) ?? -1) - (toMs(a.last_synced_at) ?? -1),
  );
}

/** Newest timestamp across all sources, or null. */
export function newestSync(sources: SyncSource[]): string | null {
  let best: string | null = null;
  for (const s of sources) {
    if ((toMs(s.last_synced_at) ?? -1) > (toMs(best) ?? -1)) best = s.last_synced_at;
  }
  return best;
}
