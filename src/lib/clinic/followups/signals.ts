import "server-only";

import { RULE_TEXT } from "../alerts/rules";
import { SupabaseAlertQueueStore } from "../alerts/supabase-queue-store";
import { phoneHash, SupabaseReminderStore } from "../reminders/supabase-store";
import { evaluateCareGapPanel } from "../uds/care-gaps";
import { calendarYearPeriod } from "../uds/measures";
import { SupabaseUdsPanelStore } from "../uds/supabase-panel-store";
import type { AlertSignal, AppointmentSignal, GapSignal } from "./logic";

export async function loadFollowUpSignals(clinicId: string, today: string) {
  const [alertRows, panel, appts, optOuts] = await Promise.all([
    new SupabaseAlertQueueStore().list(clinicId),
    new SupabaseUdsPanelStore().listPanel(clinicId),
    new SupabaseReminderStore().listAppointments(clinicId),
    new SupabaseReminderStore().listOptOutHashes(),
  ]);
  const alerts: AlertSignal[] = alertRows.filter((a) => a.clinicId === clinicId).map((a) => ({
    patientId: a.payload.patientExternalId, severity: a.severity, status: a.status, createdAt: a.createdAt, guidance: RULE_TEXT[a.payload.rule],
  }));
  const gaps: GapSignal[] = evaluateCareGapPanel(panel, calendarYearPeriod(Number(today.slice(0, 4)))).rows.map((r) => ({ patientId: r.patientId, gapsDue: r.gapsDue }));
  const appointments: AppointmentSignal[] = appts.map((a) => ({
    patientId: a.patientId, date: a.date, visitType: a.visitType,
    reachable: !!a.phone && a.contactPreference !== "none",
    optedOut: !!a.phone && optOuts.has(phoneHash(a.phone)),
  }));
  return { alerts, gaps, appointments };
}
