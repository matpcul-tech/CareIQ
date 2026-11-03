import "server-only";

import { logAudit } from "@/lib/audit";
import type { AlertAudit } from "./queue";

/** Writes clinic alert events to the append-only audit_log. No reading values or notes. */
export function auditAlerts(sessionId: string): AlertAudit {
  return async (event) => {
    await logAudit({
      sessionId,
      action: event.action,
      dataType: "clinic_alert",
      success: event.success,
      metadata: { alert_id: event.alertId, severity: event.severity, requester_role: event.actorRole },
    });
  };
}
