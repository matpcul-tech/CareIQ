/**
 * SMS hook for clinic alerts. Works when texting is not configured:
 * it returns a reason and does not throw.
 */

export interface SmsEnv {
  accountSid?: string;
  authToken?: string;
  from?: string;
}

export interface SmsResult {
  delivered: boolean;
  reason: "sent" | "sms_not_configured" | "sms_failed" | "no_destination" | "empty_body";
}

const DEFAULT_BODY = "CareIQ clinic alert: a home reading is out of range. Check the worklist.";

export function clinicSmsBody(): string {
  return DEFAULT_BODY.slice(0, 160);
}

export function smsEnvFromProcess(): SmsEnv {
  return {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    from: process.env.TWILIO_FROM || "",
  };
}

export function smsIsConfigured(env: SmsEnv): boolean {
  return Boolean(env.accountSid && env.authToken && env.from);
}

export async function deliverSms(
  env: SmsEnv,
  to: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<SmsResult> {
  const destination = (to || "").trim();
  if (!destination) return { delivered: false, reason: "no_destination" };
  if (!smsIsConfigured(env)) return { delivered: false, reason: "sms_not_configured" };
  const body = clinicSmsBody();
  if (!body) return { delivered: false, reason: "empty_body" };
  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.accountSid || "")}/Messages.json`;
  const auth = Buffer.from(`${env.accountSid}:${env.authToken}`).toString("base64");
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        authorization: `Basic ${auth}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: destination, From: env.from || "", Body: body }).toString(),
    });
    if (!response.ok) return { delivered: false, reason: "sms_failed" };
    return { delivered: true, reason: "sent" };
  } catch {
    return { delivered: false, reason: "sms_failed" };
  }
}
