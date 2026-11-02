/**
 * Last-line refusal for outbound model payloads.
 * Shield redaction runs first. This guard rejects document, image,
 * audio, and base64 file attachments if a caller tries to add them later.
 */

const BANNED_BLOCK_TYPES = new Set([
  "document",
  "image",
  "image_url",
  "input_audio",
  "audio",
]);

export class RefusedModelMediaError extends Error {
  constructor(kind: string) {
    super(`refusing to send ${kind} content to a model`);
    this.name = "RefusedModelMediaError";
  }
}

function mediaHit(node: unknown): string | null {
  if (typeof node === "string") {
    const lower = node.toLowerCase();
    if (lower.includes("data:application/pdf") || lower.includes("data:image/")) {
      return "data-url";
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  if (typeof record.type === "string" && BANNED_BLOCK_TYPES.has(record.type)) {
    return record.type;
  }
  if (typeof record.media_type === "string") {
    const media = record.media_type.toLowerCase();
    if (media.includes("pdf") || media.startsWith("image/") || media.startsWith("audio/")) {
      return record.media_type;
    }
  }
  if (record.type === "base64" && typeof record.data === "string") return "base64";
  if (record.source && typeof record.source === "object") return "source";
  return null;
}

export function findDisallowedModelMedia(value: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (node: unknown): string | null => {
    const direct = mediaHit(node);
    if (direct) return direct;
    if (!node || typeof node !== "object") return null;
    if (seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const item of node) {
        const hit = walk(item);
        if (hit) return hit;
      }
      return null;
    }
    for (const child of Object.values(node as Record<string, unknown>)) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  return walk(value);
}

export function assertTextOnlyModelPayload(value: unknown): void {
  const hit = findDisallowedModelMedia(value);
  if (hit) throw new RefusedModelMediaError(hit);
}
