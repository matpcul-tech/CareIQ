import { parseTwilioBody, validTwilioSignature } from "../twilio-inbound";
import { normalizePhone } from "./csv";
import type { Sender } from "./actions";
import { inboundKeyword } from "./engine";
import type { ReminderStore } from "./store";

export interface ReminderTwilioEnv {
  accountSid: string;
  authToken: string;
  from: string;
  sendingFlag: string;
}

/** Sending needs all three Twilio values AND the CAREIQ_REMINDERS_SENDING flag set to "on". Off by default. */
export function reminderEnv(env: Record<string, string | undefined>): ReminderTwilioEnv {
  return {
    accountSid: env.TWILIO_ACCOUNT_SID || "",
    authToken: env.TWILIO_AUTH_TOKEN || "",
    from: env.TWILIO_FROM || "",
    sendingFlag: env.CAREIQ_REMINDERS_SENDING || "",
  };
}

export const twilioConfigured = (e: ReminderTwilioEnv) => Boolean(e.accountSid && e.authToken && e.from);
export const sendingFlagOn = (e: ReminderTwilioEnv) => e.sendingFlag === "on";

function xmlEscape(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[c]!));
}

export function twilioSender(e: ReminderTwilioEnv, fetchImpl: typeof fetch = fetch): Sender {
  const auth = Buffer.from(`${e.accountSid}:${e.authToken}`).toString("base64");
  const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(e.accountSid)}`;
  return async (channel, to, body) => {
    const params: Record<string, string> = channel === "sms"
      ? { To: to, From: e.from, Body: body }
      : { To: to, From: e.from, Twiml: `<Response><Say>${xmlEscape(body)}</Say></Response>` };
    try {
      const r = await fetchImpl(`${base}/${channel === "sms" ? "Messages" : "Calls"}.json`, {
        method: "POST",
        headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params).toString(),
      });
      return r.ok;
    } catch {
      return false;
    }
  };
}

export const HELP_REPLY = "CareIQ appointment reminders from your clinic. Call your clinic for help. Reply STOP to opt out.";

/**
 * Inbound STOP, HELP, START for reminder texts. Signature verified with the Twilio auth token.
 * Fails closed with 503 when Twilio is not set up. The reply never includes patient details.
 */
export async function handleReminderInbound(
  input: { url: string; webhookUrl?: string; signature: string; rawBody: string; authToken: string; at: string },
  store: ReminderStore,
  hashPhone: (e164: string) => string,
): Promise<{ status: number; body: string; keyword: string | null }> {
  if (!input.authToken) return { status: 503, body: "", keyword: null };
  const params = parseTwilioBody(input.rawBody);
  const signedUrl = (input.webhookUrl || "").trim() || input.url;
  if (!validTwilioSignature(input.authToken, input.signature, signedUrl, params)) return { status: 403, body: "", keyword: null };
  const from = normalizePhone(params.From || "");
  const kw = inboundKeyword(params.Body || "");
  if (!from || !kw) return { status: 200, body: "<Response/>", keyword: kw };
  if (kw === "stop") await store.setOptOut(hashPhone(from), true, input.at);
  if (kw === "start") await store.setOptOut(hashPhone(from), false, input.at);
  const reply = kw === "help" ? `<Response><Message>${xmlEscape(HELP_REPLY)}</Message></Response>` : "<Response/>";
  return { status: 200, body: reply, keyword: kw };
}
