import "server-only";

import { getServiceClient } from "@/lib/supabase-server";
import { sha256Hex } from "@/lib/crypto";

export type AuditAction =
  | "auth.magic_link.requested"
  | "auth.magic_link.consumed"
  | "auth.session.expired"
  | "auth.session.rotated"
  | "auth.session.invalid"
  | "patient.profile.created"
  | "patient.profile.read"
  | "patient.profile.updated"
  | "patient.history.created"
  | "patient.history.read"
  | "patient.history.updated"
  | "patient.lab_file.uploaded"
  | "patient.lab_file.read"
  | "patient.lab_file.deleted"
  | "patient.wearable.uploaded"
  | "patient.wearable.read"
  | "shield.invoked"
  | "shield.failed"
  | "shield.unavailable"
  | "shield.decrypt"
  | "rate_limit.exceeded"
  | "csrf.failed"
  | "validation.failed"
  | "carecircle.invite.created";

export type DataType =
  | "none"
  | "profile"
  | "health_history"
  | "lab_file"
  | "wearable"
  | "session"
  | "auth"
  | "ai_inference"
  | "care_circle_invites";

export interface AuditEntry {
  sessionId: string;
  action: AuditAction;
  dataType: DataType;
  success: boolean;
  metadata?: Record<string, string | number | boolean | null>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    const sb = getServiceClient();
    const sessionHash = entry.sessionId ? sha256Hex(entry.sessionId) : "anonymous";
    const metadata = sanitizeMetadata(entry.metadata);
    const { error } = await sb.from("audit_log").insert({
      session_id: sessionHash,
      action: entry.action,
      data_type: entry.dataType,
      success: entry.success,
      metadata,
    });
    if (error) {
      // eslint-disable-next-line no-console
      console.error("[audit] write failed", error.code || "unknown");
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[audit] exception", (err as Error)?.name || "unknown");
  }
}

const ALLOWED_META_KEYS = new Set<string>([
  "duration_ms",
  "byte_count",
  "metric_count",
  "device_type",
  "file_type",
  "step",
  "anonymized_hash",
  "rate_limit_remaining",
  "reason_code",
  "model_id",
  "shield_version",
  "invite_id",
  "expires_in_days",
  "requester_hash",
  "patient_hash",
  "fields_accessed",
  "requester_role",
]);

function sanitizeMetadata(
  meta?: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> | null {
  if (!meta) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!ALLOWED_META_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 256) {
      out[k] = v.slice(0, 256);
    } else {
      out[k] = v;
    }
  }
  return out;
}
