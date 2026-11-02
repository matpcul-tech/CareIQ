import { createHmac, timingSafeEqual } from "crypto";
import type { Actor } from "./logic";

export function signClinicActor(actor: Actor, secret: string, expMs: number): string | null {
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify({ actor, exp: expMs }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readClinicActor(token: string, secret: string, nowMs: number): Actor | null {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { actor?: Actor; exp?: number };
    if (!parsed.actor || typeof parsed.exp !== "number" || parsed.exp < nowMs) return null;
    return parsed.actor;
  } catch {
    return null;
  }
}
