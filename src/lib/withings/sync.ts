import type { DailyMetric } from "@/lib/wearable/model";
import { getMeasures, refreshTokens, type FetchLike, type WithingsTokens } from "./api";
import type { WithingsConfig } from "./config";
import { WITHINGS_APPLIS } from "./config";
import { mapMeasureGroups } from "./map";

/** Stored connection, tokens already decrypted by the store. */
export interface WithingsConnection {
  patientId: string;
  withingsUserId: string;
  accessToken: string;
  refreshToken: string;
  scope: string;
  accessExpiresAt: number; // epoch ms
  lastMeasureUpdate: number | null; // epoch sec
  status: "active" | "revoked" | "error";
}

export interface WithingsStore {
  findByWithingsUser(userid: string): Promise<WithingsConnection | null>;
  saveConnection(conn: WithingsConnection): Promise<void>;
  markSynced(patientId: string, fields: { lastMeasureUpdate: number; syncedAt: string | null; notifiedAt: string }): Promise<void>;
  setStatus(patientId: string, status: WithingsConnection["status"]): Promise<void>;
  /** Writes an encrypted daily summary row to wearable_data. */
  insertWearable(patientId: string, metrics: DailyMetric[]): Promise<void>;
}

export interface SyncDeps {
  cfg: WithingsConfig;
  store: WithingsStore;
  fetchImpl: FetchLike;
  nowMs?: () => number;
}

/** Refresh five minutes early so a call never goes out with an expiring token. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
/** First pull after connecting reaches back this far. */
export const INITIAL_BACKFILL_SEC = 30 * 24 * 60 * 60;

export function connectionFromTokens(
  patientId: string,
  tokens: WithingsTokens,
  nowMs: number,
  lastMeasureUpdate: number | null,
): WithingsConnection {
  return {
    patientId,
    withingsUserId: tokens.userid,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    scope: tokens.scope,
    accessExpiresAt: nowMs + tokens.expires_in * 1000,
    lastMeasureUpdate,
    status: "active",
  };
}

export async function ensureFreshToken(conn: WithingsConnection, deps: SyncDeps): Promise<WithingsConnection> {
  const now = (deps.nowMs ?? Date.now)();
  if (conn.accessExpiresAt - REFRESH_MARGIN_MS > now) return conn;
  const tokens = await refreshTokens(deps.cfg, deps.fetchImpl, conn.refreshToken, Math.floor(now / 1000));
  const next = connectionFromTokens(conn.patientId, tokens, now, conn.lastMeasureUpdate);
  await deps.store.saveConnection(next);
  return next;
}

export interface SyncResult {
  ok: boolean;
  days: number;
  reason?: string;
}

/** Pulls measures changed since the last pull and stores them. */
export async function syncConnection(conn: WithingsConnection, deps: SyncDeps): Promise<SyncResult> {
  const now = (deps.nowMs ?? Date.now)();
  const nowSec = Math.floor(now / 1000);
  const fresh = await ensureFreshToken(conn, deps);
  const since = fresh.lastMeasureUpdate ?? nowSec - INITIAL_BACKFILL_SEC;
  const { groups, timezone } = await getMeasures(deps.fetchImpl, fresh.accessToken, since);
  const metrics = mapMeasureGroups(groups, timezone);
  const iso = new Date(now).toISOString();
  if (metrics.length > 0) await deps.store.insertWearable(fresh.patientId, metrics);
  await deps.store.markSynced(fresh.patientId, {
    lastMeasureUpdate: nowSec,
    // "Last synced" moves only when new readings arrived.
    syncedAt: metrics.length > 0 ? iso : null,
    notifiedAt: iso,
  });
  return { ok: true, days: metrics.length };
}

export interface NotifyPayload {
  userid: string;
  appli: number;
  action?: string;
}

/** Parses the x-www-form-urlencoded body Withings posts. Null when malformed. */
export function parseNotifyBody(raw: string): NotifyPayload | null {
  if (raw.length > 4096) return null;
  const p = new URLSearchParams(raw);
  const userid = p.get("userid") || "";
  const appli = Number(p.get("appli"));
  if (!/^\d{1,20}$/.test(userid) || !Number.isInteger(appli)) return null;
  const action = p.get("action") || undefined;
  return { userid, appli, action };
}

/**
 * Handles one notification. The payload carries no readings, only a
 * user id and category, and Withings does not sign it. So CareIQ never
 * trusts it for data: it only triggers a pull with the stored token for
 * a user that already linked an account. A forged call can at most
 * cause a harmless extra pull.
 */
export async function handleNotification(payload: NotifyPayload, deps: SyncDeps): Promise<SyncResult> {
  const conn = await deps.store.findByWithingsUser(payload.userid);
  if (!conn) return { ok: false, days: 0, reason: "unknown_user" };
  if (payload.appli === 46 && (payload.action === "unlink" || payload.action === "delete")) {
    await deps.store.setStatus(conn.patientId, "revoked");
    return { ok: true, days: 0, reason: "revoked" };
  }
  if (conn.status !== "active") return { ok: false, days: 0, reason: "inactive" };
  if (!(WITHINGS_APPLIS as readonly number[]).includes(payload.appli)) {
    return { ok: false, days: 0, reason: "ignored_appli" };
  }
  try {
    return await syncConnection(conn, deps);
  } catch {
    return { ok: false, days: 0, reason: "sync_failed" };
  }
}

/**
 * Runs work but resolves after at most budgetMs, so the webhook can
 * answer Withings within a few seconds. Work that is still running keeps
 * going; if it is cut off, the next notification pulls the same data
 * again because lastupdate only advances after a successful pull.
 */
export async function withinBudget<T>(work: Promise<T>, budgetMs: number): Promise<T | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), budgetMs);
  });
  try {
    return await Promise.race([work.catch(() => "timeout" as const), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
