import { createHash, randomBytes } from "node:crypto";

/** 32 random bytes, base64url. Shown once; only the SHA-256 hash is stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

export function looksLikeToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export const SETUP_TOKEN_DEFAULT_HOURS = 24;
export const SETUP_TOKEN_MAX_HOURS = 72;
export const INVITE_LINK_DAYS = 7;
