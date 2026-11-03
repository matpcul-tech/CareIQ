import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

// Synthetic key for tests only.
process.env.ENCRYPTION_KEY = "11".repeat(32);

import { getMeasures, signWithings, exchangeCode, type FetchLike } from "../src/lib/withings/api";
import { buildAuthorizeUrl, notifyCallbackUrl, readWithingsConfig, type WithingsConfig } from "../src/lib/withings/config";
import { isWithingsEnabled } from "../src/lib/withings/flag";
import { dayInZone, mapMeasureGroups, realValue } from "../src/lib/withings/map";
import { decryptTokens, encryptTokens } from "../src/lib/withings/store-supabase";
import {
  handleNotification,
  parseNotifyBody,
  syncConnection,
  withinBudget,
  type WithingsConnection,
  type WithingsStore,
} from "../src/lib/withings/sync";
import type { DailyMetric } from "../src/lib/wearable/model";

const CFG: WithingsConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "https://careiq.example.test/api/withings/callback",
  notifyBaseUrl: "https://careiq.example.test",
  webhookToken: "t".repeat(40),
};

interface Call { url: string; params: URLSearchParams; auth?: string }

/** Mock Withings API. Only synthetic values. */
function mockWithings(opts: { measuregrps?: unknown[]; failMeasure?: boolean } = {}) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const params = new URLSearchParams(init.body);
    calls.push({ url, params, auth: init.headers.Authorization });
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => ({ status: 0, body }) });
    if (url.endsWith("/v2/signature")) return ok({ nonce: "nonce-123" });
    if (url.endsWith("/v2/oauth2")) {
      return ok({ userid: 999001, access_token: "acc-new", refresh_token: "ref-new", scope: "user.metrics", expires_in: 10800 });
    }
    if (url.endsWith("/notify")) return ok({});
    if (url.endsWith("/measure")) {
      if (opts.failMeasure) return { ok: true, status: 200, json: async () => ({ status: 401 }) };
      return ok({ measuregrps: opts.measuregrps ?? [], timezone: "America/Chicago" });
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { calls, fetchImpl };
}

function memoryStore(conn: WithingsConnection | null) {
  const state = {
    conn,
    wearable: [] as Array<{ patientId: string; metrics: DailyMetric[] }>,
    synced: [] as Array<{ lastMeasureUpdate: number; syncedAt: string | null }>,
  };
  const store: WithingsStore = {
    async findByWithingsUser(userid) {
      return state.conn && state.conn.withingsUserId === userid ? { ...state.conn } : null;
    },
    async saveConnection(c) { state.conn = { ...c }; },
    async markSynced(_p, f) {
      state.synced.push(f);
      if (state.conn) state.conn.lastMeasureUpdate = f.lastMeasureUpdate;
    },
    async setStatus(_p, s) { if (state.conn) state.conn.status = s; },
    async insertWearable(patientId, metrics) { state.wearable.push({ patientId, metrics }); },
  };
  return { state, store };
}

const NOW = Date.parse("2026-11-03T15:00:00Z");
const baseConn = (): WithingsConnection => ({
  patientId: "00000000-0000-4000-8000-000000000001",
  withingsUserId: "999001",
  accessToken: "acc-old",
  refreshToken: "ref-old",
  scope: "user.metrics",
  accessExpiresAt: NOW + 2 * 60 * 60 * 1000,
  lastMeasureUpdate: Math.floor(NOW / 1000) - 3600,
  status: "active",
});

// Synthetic readings: 2026-11-03 around 08:00 Chicago time.
const T0 = Math.floor(Date.parse("2026-11-03T14:00:00Z") / 1000);
const GROUPS = [
  { date: T0, measures: [{ type: 10, value: 128, unit: 0 }, { type: 9, value: 82, unit: 0 }, { type: 11, value: 66, unit: 0 }] },
  { date: T0 + 600, measures: [{ type: 10, value: 132, unit: 0 }, { type: 9, value: 84, unit: 0 }] },
  { date: T0 + 60, measures: [{ type: 1, value: 81650, unit: -3 }] },
  { date: T0 + 120, measures: [{ type: 54, value: 970, unit: -1 }, { type: 999, value: 5, unit: 0 }] },
];

test("flag is off unless exactly true", () => {
  assert.equal(isWithingsEnabled({}), false);
  assert.equal(isWithingsEnabled({ WITHINGS_ENABLED: "1" }), false);
  assert.equal(isWithingsEnabled({ WITHINGS_ENABLED: "TRUE" }), false);
  assert.equal(isWithingsEnabled({ WITHINGS_ENABLED: "true" }), true);
});

test("config needs every value and a long webhook token", () => {
  const env = {
    WITHINGS_CLIENT_ID: "a",
    WITHINGS_CLIENT_SECRET: "b",
    WITHINGS_REDIRECT_URI: "https://x.test/api/withings/callback",
    WITHINGS_NOTIFY_BASE_URL: "https://x.test/",
    WITHINGS_WEBHOOK_TOKEN: "short",
  };
  assert.equal(readWithingsConfig(env), null);
  const cfg = readWithingsConfig({ ...env, WITHINGS_WEBHOOK_TOKEN: "z".repeat(32) });
  assert.ok(cfg);
  assert.equal(notifyCallbackUrl(cfg!), `https://x.test/api/withings/notify/${"z".repeat(32)}`);
  const url = new URL(buildAuthorizeUrl(CFG, "state-1"));
  assert.equal(url.origin + url.pathname, "https://account.withings.com/oauth2_user/authorize2");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("scope"), "user.metrics");
  assert.equal(url.searchParams.get("state"), "state-1");
});

test("signature matches the documented HMAC SHA-256 scheme", () => {
  const expected = createHmac("sha256", "test-secret").update("getnonce,test-client,1700000000").digest("hex");
  assert.equal(signWithings({ action: "getnonce", client_id: "test-client", timestamp: 1700000000 }, "test-secret"), expected);
  const signed = createHmac("sha256", "test-secret").update("requesttoken,test-client,nonce-123").digest("hex");
  assert.equal(signWithings({ action: "requesttoken", client_id: "test-client", nonce: "nonce-123" }, "test-secret"), signed);
});

test("code exchange gets a nonce, then a signed requesttoken", async () => {
  const { calls, fetchImpl } = mockWithings();
  const tokens = await exchangeCode(CFG, fetchImpl, "code-abc", 1700000000);
  assert.equal(tokens.userid, "999001");
  assert.equal(calls[0].params.get("action"), "getnonce");
  const tok = calls[1].params;
  assert.equal(tok.get("action"), "requesttoken");
  assert.equal(tok.get("grant_type"), "authorization_code");
  assert.equal(tok.get("code"), "code-abc");
  assert.equal(tok.get("nonce"), "nonce-123");
  assert.equal(tok.get("redirect_uri"), CFG.redirectUri);
  assert.equal(tok.get("client_secret"), null, "secret is never sent");
  assert.equal(tok.get("signature"), signWithings({ action: "requesttoken", client_id: "test-client", nonce: "nonce-123" }, "test-secret"));
});

test("measures map into the wearable daily model", () => {
  assert.equal(realValue({ value: 81650, unit: -3 }), 81.65);
  assert.equal(dayInZone(T0, "America/Chicago"), "2026-11-03");
  assert.equal(dayInZone(Math.floor(Date.parse("2026-11-03T03:00:00Z") / 1000), "America/Chicago"), "2026-11-02");
  assert.equal(dayInZone(T0, "Not/AZone"), "2026-11-03");
  const days = mapMeasureGroups(GROUPS, "America/Chicago");
  assert.equal(days.length, 1);
  const d = days[0];
  assert.equal(d.date, "2026-11-03");
  assert.equal(d.bpSystolic, 130);
  assert.equal(d.bpDiastolic, 83);
  assert.equal(d.heartRate, 66);
  assert.equal(d.spo2, 97);
  assert.equal(d.weightLb, 180);
});

test("out of range readings are dropped", () => {
  const days = mapMeasureGroups([{ date: T0, measures: [{ type: 10, value: 900, unit: 0 }, { type: 11, value: 5, unit: 0 }] }], null);
  assert.deepEqual(days, []);
});

test("getmeas follows offset paging and sends lastupdate", async () => {
  let page = 0;
  const seen: URLSearchParams[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    seen.push(new URLSearchParams(init.body));
    page++;
    const body = page === 1
      ? { measuregrps: [GROUPS[0]], more: 1, offset: 1 }
      : { measuregrps: [GROUPS[1]], more: 0 };
    return { ok: true, status: 200, json: async () => ({ status: 0, body }) };
  };
  const out = await getMeasures(fetchImpl, "acc", 1700000000);
  assert.equal(out.groups.length, 2);
  assert.equal(seen[0].get("lastupdate"), "1700000000");
  assert.equal(seen[0].get("action"), "getmeas");
  assert.equal(seen[1].get("offset"), "1");
});

test("notification body parsing", () => {
  assert.deepEqual(parseNotifyBody("userid=999001&appli=4&startdate=1&enddate=2"), { userid: "999001", appli: 4, action: undefined });
  assert.equal(parseNotifyBody("userid=abc&appli=4"), null);
  assert.equal(parseNotifyBody("appli=4"), null);
  assert.equal(parseNotifyBody("userid=1&appli=x"), null);
  assert.equal(parseNotifyBody("x".repeat(5000)), null);
});

test("notify pulls new measures and stores one summary", async () => {
  const { calls, fetchImpl } = mockWithings({ measuregrps: GROUPS });
  const { state, store } = memoryStore(baseConn());
  const res = await handleNotification({ userid: "999001", appli: 4 }, { cfg: CFG, store, fetchImpl, nowMs: () => NOW });
  assert.deepEqual(res, { ok: true, days: 1 });
  assert.equal(state.wearable.length, 1);
  assert.equal(state.wearable[0].metrics[0].bpSystolic, 130);
  const measureCall = calls.find((c) => c.url.endsWith("/measure"))!;
  assert.equal(measureCall.auth, "Bearer acc-old");
  assert.equal(measureCall.params.get("lastupdate"), String(Math.floor(NOW / 1000) - 3600));
  assert.equal(state.synced[0].lastMeasureUpdate, Math.floor(NOW / 1000));
  assert.equal(state.synced[0].syncedAt, new Date(NOW).toISOString());
});

test("notify with no new measures does not move last synced", async () => {
  const { fetchImpl } = mockWithings({ measuregrps: [] });
  const { state, store } = memoryStore(baseConn());
  const res = await handleNotification({ userid: "999001", appli: 1 }, { cfg: CFG, store, fetchImpl, nowMs: () => NOW });
  assert.deepEqual(res, { ok: true, days: 0 });
  assert.equal(state.wearable.length, 0);
  assert.equal(state.synced[0].syncedAt, null);
});

test("expired access token is refreshed and the new refresh token kept", async () => {
  const { calls, fetchImpl } = mockWithings({ measuregrps: GROUPS });
  const conn = { ...baseConn(), accessExpiresAt: NOW - 1000 };
  const { state, store } = memoryStore(conn);
  await syncConnection(conn, { cfg: CFG, store, fetchImpl, nowMs: () => NOW });
  const refresh = calls.find((c) => c.params.get("grant_type") === "refresh_token")!;
  assert.equal(refresh.params.get("refresh_token"), "ref-old");
  assert.equal(state.conn?.refreshToken, "ref-new");
  assert.equal(calls.find((c) => c.url.endsWith("/measure"))!.auth, "Bearer acc-new");
});

test("unknown users, inactive links, and other categories never fetch", async () => {
  const { calls, fetchImpl } = mockWithings({ measuregrps: GROUPS });
  const { store } = memoryStore(baseConn());
  const deps = { cfg: CFG, store, fetchImpl, nowMs: () => NOW };
  assert.equal((await handleNotification({ userid: "123", appli: 4 }, deps)).reason, "unknown_user");
  assert.equal((await handleNotification({ userid: "999001", appli: 16 }, deps)).reason, "ignored_appli");
  assert.equal(calls.length, 0);
  const revoked = memoryStore({ ...baseConn(), status: "revoked" });
  assert.equal((await handleNotification({ userid: "999001", appli: 4 }, { ...deps, store: revoked.store })).reason, "inactive");
  assert.equal(calls.length, 0);
});

test("unlink notification revokes the link", async () => {
  const { fetchImpl } = mockWithings();
  const { state, store } = memoryStore(baseConn());
  await handleNotification({ userid: "999001", appli: 46, action: "unlink" }, { cfg: CFG, store, fetchImpl });
  assert.equal(state.conn?.status, "revoked");
});

test("a failed pull does not advance lastupdate", async () => {
  const { fetchImpl } = mockWithings({ failMeasure: true });
  const { state, store } = memoryStore(baseConn());
  const res = await handleNotification({ userid: "999001", appli: 4 }, { cfg: CFG, store, fetchImpl, nowMs: () => NOW });
  assert.equal(res.reason, "sync_failed");
  assert.equal(state.synced.length, 0);
});

test("response budget returns quickly while work continues", async () => {
  const start = Date.now();
  const slow = new Promise<string>((r) => setTimeout(() => r("done"), 500));
  assert.equal(await withinBudget(slow, 20), "timeout");
  assert.ok(Date.now() - start < 300);
  assert.equal(await withinBudget(Promise.resolve("fast"), 1000), "fast");
  assert.equal(await withinBudget(Promise.reject(new Error("x")), 1000), "timeout");
});

test("tokens are stored as AES-256-GCM ciphertext bound to the patient", () => {
  const blob = encryptTokens("p1", { access_token: "acc-secret", refresh_token: "ref-secret" });
  assert.doesNotMatch(blob, /acc-secret|ref-secret/);
  assert.deepEqual(decryptTokens("p1", blob), { access_token: "acc-secret", refresh_token: "ref-secret" });
  assert.throws(() => decryptTokens("p2", blob));
});

test("notify route: 404 when off, HEAD 200 with the right token, quick 200 on POST", async () => {
  type Handler = (req: never, ctx: { params: { token: string } }) => Promise<Response>;
  const route = (await import("../src/app/api/withings/notify/[token]/route")) as unknown as { HEAD: Handler; POST: Handler };
  const env = process.env;
  const token = "w".repeat(40);
  delete env.WITHINGS_ENABLED;
  const ctx = { params: { token } };
  const req = (method: string, body?: string) => new Request(`https://careiq.example.test/api/withings/notify/${token}`, { method, body }) as never;
  assert.equal((await route.HEAD(req("HEAD"), ctx)).status, 404);
  Object.assign(env, {
    WITHINGS_ENABLED: "true",
    WITHINGS_CLIENT_ID: "a",
    WITHINGS_CLIENT_SECRET: "b",
    WITHINGS_REDIRECT_URI: "https://careiq.example.test/api/withings/callback",
    WITHINGS_NOTIFY_BASE_URL: "https://careiq.example.test",
    WITHINGS_WEBHOOK_TOKEN: token,
  });
  try {
    assert.equal((await route.HEAD(req("HEAD"), ctx)).status, 200);
    assert.equal((await route.HEAD(req("HEAD"), { params: { token: "x".repeat(40) } })).status, 404);
    // No Supabase in tests: the handler must still answer 200 fast.
    const start = Date.now();
    const res = await route.POST(req("POST", "userid=1&appli=4"), ctx);
    assert.equal(res.status, 200);
    assert.ok(Date.now() - start < 3000);
    assert.equal((await route.POST(req("POST", "garbage"), ctx)).status, 200);
  } finally {
    for (const k of ["WITHINGS_ENABLED", "WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI", "WITHINGS_NOTIFY_BASE_URL", "WITHINGS_WEBHOOK_TOKEN"]) delete env[k];
  }
});
