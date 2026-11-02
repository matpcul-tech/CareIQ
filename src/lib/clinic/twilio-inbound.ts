import { createHmac, timingSafeEqual } from "crypto";
import { wellnessSmsReply } from "./actions";
import type { ClinicStore } from "./store";

export function twilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params).sort().reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!authToken || !signature) return false;
  const expected = twilioSignature(authToken, url, params);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function parseTwilioBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const params = new URLSearchParams(raw);
  params.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Inbound SMS. Matches only the sender number. The response never includes
 * a patient id. Unsigned requests are rejected. Missing Twilio config fails closed.
 */
export async function handleWellnessInbound(
  input: {
    url: string;
    signature: string;
    rawBody: string;
    authToken: string;
    at: string;
  },
  store: ClinicStore,
): Promise<{ status: number; body: string }> {
  if (!input.authToken) return { status: 503, body: "" };
  const params = parseTwilioBody(input.rawBody);
  if (!validTwilioSignature(input.authToken, input.signature, input.url, params)) {
    return { status: 403, body: "" };
  }
  await wellnessSmsReply(store, {
    phone: params.From || "",
    body: params.Body || "",
    at: input.at,
  });
  return { status: 204, body: "" };
}
