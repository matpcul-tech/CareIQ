import { createHash } from "crypto";

/**
 * Deterministic email hash. The key is the server encryption key, used as a
 * pepper. Callers must not log the plaintext email or the key.
 */
export function hashEmailWithKey(email: string, key: Buffer): string {
  const normalized = email.trim().toLowerCase();
  return createHash("sha256").update(key).update(":").update(normalized, "utf8").digest("hex");
}
