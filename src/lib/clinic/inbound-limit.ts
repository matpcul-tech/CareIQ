/** General app limit. The Twilio inbound path does not share this bucket. */
export const GENERAL_RATE_LIMIT_MAX = 10;

export const INBOUND_WELLNESS_PATH = "/api/clinic/wellness/inbound";

/** Separate, higher cap so a clinic's inbound texts are not dropped at 10 per minute. */
export const INBOUND_RATE_LIMIT_MAX = 120;

export function rateLimitBucket(pathname: string, ip: string): { key: string; max: number } {
  if (pathname === INBOUND_WELLNESS_PATH) {
    return { key: `twilio-inbound:${ip}`, max: INBOUND_RATE_LIMIT_MAX };
  }
  return { key: ip, max: GENERAL_RATE_LIMIT_MAX };
}
