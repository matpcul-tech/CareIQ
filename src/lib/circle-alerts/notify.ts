/**
 * In-app CareCircle alerts.
 *
 * When CareIQ fires an alert for a patient, it writes one row to
 * public.care_circle_alerts (shared Supabase project). CareCircle reads that
 * table through its server route and RLS, so only care circle members of the
 * patient see it.
 *
 * Only app data is shared: alert type, severity, timestamp, and a fixed
 * templated sentence. Reading values, lab values, thresholds, and free text
 * never go into the row. No SMS, no email, no model call.
 */

import type { AlertRule, AlertSeverity } from "../clinic/alerts/rules";

export type CircleAlertKind =
  | "reading_out_of_range"
  | "clinic_alert_rule"
  | "wellness_check_missed";

/** care_circle_alerts.severity only allows these two values. */
export type CircleAlertSeverity = "critical" | "informational";

export interface CircleAlertRow {
  patient_id: string;
  metric: string;
  severity: CircleAlertSeverity;
  recommendation: string;
  fired_at: string;
  delivery_count: 0;
  delivery_summary: null;
}

export const CIRCLE_ALERT_TEXT: Record<CircleAlertKind, { metric: string; text: string }> = {
  reading_out_of_range: {
    metric: "Home reading out of range",
    text: "A home reading was outside the safe range. The care team has been alerted. Please check in with your loved one.",
  },
  clinic_alert_rule: {
    metric: "Clinic alert",
    text: "A home reading matched one of the clinic alert rules. The clinic care team will review it.",
  },
  wellness_check_missed: {
    metric: "Missed wellness check-in",
    text: "A daily wellness check-in was missed. Please check on your loved one.",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maps a clinic alert queue rule to the in-app alert kind. */
export function kindForRule(rule: AlertRule): CircleAlertKind {
  return rule === "clinic_threshold" ? "clinic_alert_rule" : "reading_out_of_range";
}

/** The table allows critical and informational. High maps to critical. */
export function circleSeverity(severity: AlertSeverity): CircleAlertSeverity {
  return severity === "informational" ? "informational" : "critical";
}

/**
 * Builds the row. Takes only the kind, severity, and time, so no reading or
 * lab value can reach it. Returns null when there is no CareIQ patient id
 * (a clinic patient that is not linked has no care circle).
 */
export function buildCircleAlert(input: {
  patientId: string | null | undefined;
  kind: CircleAlertKind;
  severity: CircleAlertSeverity;
  firedAt: string;
}): CircleAlertRow | null {
  if (!input.patientId || !UUID.test(input.patientId)) return null;
  const template = CIRCLE_ALERT_TEXT[input.kind];
  if (!template) return null;
  const at = new Date(input.firedAt);
  return {
    patient_id: input.patientId,
    metric: template.metric,
    severity: input.severity === "critical" ? "critical" : "informational",
    recommendation: template.text,
    fired_at: Number.isNaN(at.getTime()) ? new Date().toISOString() : at.toISOString(),
    delivery_count: 0,
    delivery_summary: null,
  };
}

export interface CircleAlertSink {
  insert(row: CircleAlertRow): Promise<void>;
}

export class MemoryCircleAlertSink implements CircleAlertSink {
  rows: CircleAlertRow[] = [];
  async insert(row: CircleAlertRow) {
    this.rows.push(structuredClone(row));
  }
}

/**
 * Builds and writes the alert. Never throws: an in-app alert failure must not
 * fail the reading save or the wellness tick that fired it.
 */
export async function notifyCircle(
  sink: CircleAlertSink | undefined,
  input: Parameters<typeof buildCircleAlert>[0],
): Promise<boolean> {
  if (!sink) return false;
  const row = buildCircleAlert(input);
  if (!row) return false;
  try {
    await sink.insert(row);
    return true;
  } catch {
    return false;
  }
}
