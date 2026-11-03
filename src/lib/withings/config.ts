/**
 * Withings settings. Only environment variable names live in the repo.
 *
 *   WITHINGS_ENABLED          "true" turns the integration on (default off)
 *   WITHINGS_CLIENT_ID        Withings developer app client id
 *   WITHINGS_CLIENT_SECRET    Withings developer app client secret (signs requests)
 *   WITHINGS_REDIRECT_URI     OAuth callback registered on the Withings app,
 *                             for example https://<host>/api/withings/callback
 *   WITHINGS_NOTIFY_BASE_URL  Public HTTPS origin Withings posts to,
 *                             for example https://<host>
 *   WITHINGS_WEBHOOK_TOKEN    Long random value placed in the notify URL path
 */

export const WITHINGS_API = "https://wbsapi.withings.net";
export const WITHINGS_AUTHORIZE_URL = "https://account.withings.com/oauth2_user/authorize2";

/** user.metrics covers Getmeas and Notify subscribe for these categories. */
export const WITHINGS_SCOPE = "user.metrics";

/**
 * Notify categories (appli) CareIQ subscribes to:
 *   1 weight and body composition, 4 blood pressure, heart rate, SpO2.
 */
export const WITHINGS_APPLIS = [1, 4] as const;

/** Getmeas types CareIQ maps into the wearable daily summary. */
export const WITHINGS_MEAS_TYPES = {
  weightKg: 1,
  diastolic: 9,
  systolic: 10,
  heartPulse: 11,
  spo2: 54,
} as const;

export interface WithingsConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  notifyBaseUrl: string;
  webhookToken: string;
}

export function readWithingsConfig(
  env: Record<string, string | undefined> = process.env,
): WithingsConfig | null {
  const clientId = env.WITHINGS_CLIENT_ID || "";
  const clientSecret = env.WITHINGS_CLIENT_SECRET || "";
  const redirectUri = env.WITHINGS_REDIRECT_URI || "";
  const notifyBaseUrl = (env.WITHINGS_NOTIFY_BASE_URL || "").replace(/\/+$/, "");
  const webhookToken = env.WITHINGS_WEBHOOK_TOKEN || "";
  if (!clientId || !clientSecret || !redirectUri || !notifyBaseUrl || webhookToken.length < 32) {
    return null;
  }
  return { clientId, clientSecret, redirectUri, notifyBaseUrl, webhookToken };
}

/** The URL handed to Notify subscribe. Must be HTTPS on a real domain. */
export function notifyCallbackUrl(cfg: WithingsConfig): string {
  return `${cfg.notifyBaseUrl}/api/withings/notify/${encodeURIComponent(cfg.webhookToken)}`;
}

export function buildAuthorizeUrl(cfg: WithingsConfig, state: string): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    scope: WITHINGS_SCOPE,
    redirect_uri: cfg.redirectUri,
    state,
  });
  return `${WITHINGS_AUTHORIZE_URL}?${q.toString()}`;
}
