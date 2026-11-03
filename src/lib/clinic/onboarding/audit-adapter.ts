import "server-only";

import { logAudit } from "@/lib/audit";
import type { OnboardingAuditEvent } from "./logic";

/** No token, email, name, or clinic name is logged. Only the action, outcome, and role kind. */
export function auditOnboarding(sessionId: string) {
  return async (e: OnboardingAuditEvent) => {
    await logAudit({ sessionId, action: e.action, dataType: "clinic_onboarding", success: e.success, metadata: { requester_role: e.role ?? null, reason: e.reason ?? null } });
  };
}
