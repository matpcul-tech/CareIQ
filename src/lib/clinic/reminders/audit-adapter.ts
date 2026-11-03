import "server-only";

import { logAudit } from "@/lib/audit";
import type { ReminderAudit } from "./actions";

/** Audit entries carry only the action, a count, and the staff role. No phone, name, or message text. */
export function auditReminders(sessionId: string): ReminderAudit {
  return async (e) => {
    await logAudit({ sessionId, action: e.action, dataType: "clinic_reminder", success: true, metadata: { metric_count: e.count, requester_role: e.actorRole } });
  };
}
