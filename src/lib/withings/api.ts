import { createHmac } from "crypto";
import { WITHINGS_API, WITHINGS_MEAS_TYPES, type WithingsConfig } from "./config";

/**
 * Minimal Withings API client. Request signing follows
 * https://developer.withings.com/developer-guide/v3/integration-guide/public-health-data-api/get-access/sign-your-requests
 * HMAC SHA-256 with the client secret over the comma-joined values of
 * action, client_id, and timestamp (getnonce) or nonce (signed calls).
 * fetch is injectable so tests never reach Withings.
 */

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export class WithingsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "WithingsApiError";
  }
}

interface Envelope<T> { status: number; body?: T; error?: string }

export function signWithings(
  params: { action: string; client_id: string; timestamp?: number | string; nonce?: string },
  clientSecret: string,
): string {
  const values: string[] = [params.action, params.client_id];
  if (params.timestamp != null) values.push(String(params.timestamp));
  if (params.nonce != null) values.push(params.nonce);
  return createHmac("sha256", clientSecret).update(values.join(",")).digest("hex");
}

async function post<T>(
  fetchImpl: FetchLike,
  path: string,
  params: Record<string, string>,
  accessToken?: string,
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const res = await fetchImpl(`${WITHINGS_API}${path}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new WithingsApiError(`withings http ${res.status}`, -1);
  const env = (await res.json()) as Envelope<T>;
  if (!env || env.status !== 0 || env.body == null) {
    throw new WithingsApiError("withings api error", typeof env?.status === "number" ? env.status : -1);
  }
  return env.body;
}

export async function getNonce(cfg: WithingsConfig, fetchImpl: FetchLike, nowSec: number): Promise<string> {
  const params = { action: "getnonce", client_id: cfg.clientId, timestamp: String(nowSec) };
  const body = await post<{ nonce: string }>(fetchImpl, "/v2/signature", {
    ...params,
    signature: signWithings(params, cfg.clientSecret),
  });
  return body.nonce;
}

export interface WithingsTokens {
  userid: string;
  access_token: string;
  refresh_token: string;
  scope: string;
  expires_in: number;
}

async function requestToken(
  cfg: WithingsConfig,
  fetchImpl: FetchLike,
  extra: Record<string, string>,
  nowSec: number,
): Promise<WithingsTokens> {
  const nonce = await getNonce(cfg, fetchImpl, nowSec);
  const base = { action: "requesttoken", client_id: cfg.clientId, nonce };
  const body = await post<{ userid: string | number; access_token: string; refresh_token: string; scope?: string; expires_in: number }>(
    fetchImpl,
    "/v2/oauth2",
    { ...base, ...extra, signature: signWithings(base, cfg.clientSecret) },
  );
  return {
    userid: String(body.userid),
    access_token: body.access_token,
    refresh_token: body.refresh_token,
    scope: body.scope ?? "",
    expires_in: Number(body.expires_in) || 0,
  };
}

/** The authorization code is valid for 30 seconds, so call this right away. */
export function exchangeCode(cfg: WithingsConfig, fetchImpl: FetchLike, code: string, nowSec: number) {
  return requestToken(cfg, fetchImpl, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri }, nowSec);
}

/** Each refresh returns a new refresh token. Always store the new one. */
export function refreshTokens(cfg: WithingsConfig, fetchImpl: FetchLike, refreshToken: string, nowSec: number) {
  return requestToken(cfg, fetchImpl, { grant_type: "refresh_token", refresh_token: refreshToken }, nowSec);
}

export async function subscribeNotify(
  fetchImpl: FetchLike,
  accessToken: string,
  callbackUrl: string,
  appli: number,
): Promise<void> {
  await post(fetchImpl, "/notify", {
    action: "subscribe",
    callbackurl: callbackUrl,
    appli: String(appli),
    comment: "CareIQ",
  }, accessToken);
}

export interface WithingsMeasure { type: number; value: number; unit: number }
export interface WithingsMeasureGroup { grpid?: number; date: number; category?: number; measures: WithingsMeasure[] }
interface GetmeasBody { measuregrps?: WithingsMeasureGroup[]; timezone?: string; more?: number | boolean; offset?: number }

/** Fetches every measure group modified since lastupdate, following offset paging. */
export async function getMeasures(
  fetchImpl: FetchLike,
  accessToken: string,
  lastupdate: number,
  maxPages = 10,
): Promise<{ groups: WithingsMeasureGroup[]; timezone: string | null }> {
  const groups: WithingsMeasureGroup[] = [];
  let timezone: string | null = null;
  let offset: number | undefined;
  for (let page = 0; page < maxPages; page++) {
    const params: Record<string, string> = {
      action: "getmeas",
      meastypes: Object.values(WITHINGS_MEAS_TYPES).join(","),
      category: "1",
      lastupdate: String(lastupdate),
    };
    if (offset != null) params.offset = String(offset);
    const body = await post<GetmeasBody>(fetchImpl, "/measure", params, accessToken);
    groups.push(...(body.measuregrps ?? []));
    timezone = body.timezone ?? timezone;
    if (!body.more || body.offset == null) break;
    offset = body.offset;
  }
  return { groups, timezone };
}
