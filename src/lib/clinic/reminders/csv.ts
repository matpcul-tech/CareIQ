/**
 * Appointment CSV import, browser safe. Synthetic or clinic supplied rows only.
 * CareIQ does not book visits; the clinic EHR is the system of record.
 */

import { parseCsvText } from "../uds/csv";
import { isIsoDate } from "../uds/measures";
import type { Appointment, ContactPreference } from "./engine";

export type ApptField =
  | "appointment_id" | "patient_id" | "appointment_date" | "appointment_time" | "provider" | "location"
  | "visit_type" | "patient_phone" | "preferred_language" | "contact_preference" | "care_gap_consent";

export const APPT_FIELDS: { key: ApptField; label: string; required: boolean; help: string; aliases: string[] }[] = [
  { key: "appointment_id", label: "Appointment ID", required: true, help: "EHR appointment id, used to replace a row", aliases: ["appt_id", "id"] },
  { key: "patient_id", label: "Patient ID", required: true, help: "Same id as the UDS panel", aliases: ["mrn", "patient"] },
  { key: "appointment_date", label: "Date", required: true, help: "YYYY-MM-DD", aliases: ["date", "appt_date"] },
  { key: "appointment_time", label: "Time", required: true, help: "HH:MM 24 hour, clinic local time", aliases: ["time", "appt_time"] },
  { key: "provider", label: "Provider", required: false, help: "Name shown in the reminder", aliases: ["clinician"] },
  { key: "location", label: "Location", required: false, help: "Site name", aliases: ["site"] },
  { key: "visit_type", label: "Visit type", required: false, help: "for example checkup, follow up", aliases: ["type"] },
  { key: "patient_phone", label: "Patient phone", required: false, help: "10 digit US or +country number", aliases: ["phone", "mobile"] },
  { key: "preferred_language", label: "Preferred language", required: false, help: "en, es, or a code the clinic added", aliases: ["language", "lang"] },
  { key: "contact_preference", label: "Contact preference", required: false, help: "text, voice, or none (blank means text)", aliases: ["contact", "preference"] },
  { key: "care_gap_consent", label: "Care gap reminder consent", required: false, help: "yes or no (blank means no)", aliases: ["gap_consent", "consent"] },
];

export const APPT_TEMPLATE_HEADERS = APPT_FIELDS.map((f) => f.key);

export function appointmentTemplateCsv(): string {
  return `${APPT_TEMPLATE_HEADERS.join(",")}\nAPT-1001,SYN-0001,2026-11-10,09:30,Dr Rivera,Main Street Clinic,checkup,312-555-0101,en,text,yes\n`;
}

export type ApptMapping = Partial<Record<ApptField, number>>;

export function guessApptMapping(headers: string[]): ApptMapping {
  const norm = headers.map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_"));
  const m: ApptMapping = {};
  for (const f of APPT_FIELDS) {
    const i = norm.findIndex((h) => h === f.key || f.aliases.includes(h));
    if (i >= 0) m[f.key] = i;
  }
  return m;
}

/** US 10 digit, 11 digit starting with 1, or +E.164. */
export function normalizePhone(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  const d = t.replace(/\D/g, "");
  if (t.startsWith("+") && d.length >= 8 && d.length <= 15) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}

export interface ApptRowError { row: number; appointmentId: string; messages: string[] }

export function parseAppointmentCsv(text: string, mapping?: ApptMapping, knownLanguages: string[] = ["en", "es"]) {
  const table = parseCsvText(text);
  if (table.length === 0) return { appointments: [] as Appointment[], errors: [] as ApptRowError[], mappingErrors: ["The file is empty."] };
  const map = mapping || guessApptMapping(table[0]);
  const mappingErrors = APPT_FIELDS.filter((f) => f.required && map[f.key] === undefined).map((f) => `Map a column to ${f.label}.`);
  if (table.length - 1 > 10000) mappingErrors.push("Up to 10000 rows per file.");
  if (mappingErrors.length) return { appointments: [] as Appointment[], errors: [] as ApptRowError[], mappingErrors };
  const get = (cells: string[], k: ApptField) => (map[k] === undefined ? "" : (cells[map[k]!] ?? "").trim());
  const appointments: Appointment[] = [];
  const errors: ApptRowError[] = [];
  const seen = new Set<string>();
  for (let r = 1; r < table.length; r++) {
    const c = table[r];
    const msg: string[] = [];
    const appointmentId = get(c, "appointment_id");
    if (!appointmentId) msg.push("Appointment ID is required.");
    else if (appointmentId.length > 64) msg.push("Appointment ID is longer than 64 characters.");
    else if (seen.has(appointmentId)) msg.push("Duplicate appointment ID in this file.");
    const patientId = get(c, "patient_id");
    if (!patientId || patientId.length > 64) msg.push("Patient ID is required (64 characters or less).");
    const date = get(c, "appointment_date");
    if (!isIsoDate(date)) msg.push("Date must be YYYY-MM-DD.");
    const time = get(c, "appointment_time");
    const tm = time.match(/^(\d{1,2}):(\d{2})$/);
    if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) msg.push("Time must be HH:MM, 24 hour.");
    const phoneRaw = get(c, "patient_phone");
    const phone = normalizePhone(phoneRaw);
    if (phoneRaw && !phone) msg.push("Patient phone is not a valid number.");
    const lang = (get(c, "preferred_language") || "en").toLowerCase();
    if (!/^[a-z]{2,3}([-_][a-z0-9]{2,8})?$/.test(lang)) msg.push("Preferred language must be a code like en or es.");
    const prefRaw = (get(c, "contact_preference") || "text").toLowerCase();
    const pref = (prefRaw === "sms" ? "text" : prefRaw === "phone" || prefRaw === "call" ? "voice" : prefRaw) as ContactPreference;
    if (!["text", "voice", "none"].includes(pref)) msg.push("Contact preference must be text, voice, or none.");
    const consentRaw = get(c, "care_gap_consent").toLowerCase();
    if (consentRaw && !["yes", "no", "y", "n", "true", "false"].includes(consentRaw)) msg.push("Care gap consent must be yes or no.");
    for (const [k, max] of [["provider", 60], ["location", 60], ["visit_type", 40]] as [ApptField, number][]) {
      if (get(c, k).length > max) msg.push(`${APPT_FIELDS.find((f) => f.key === k)!.label} is longer than ${max} characters.`);
    }
    if (msg.length) { errors.push({ row: r, appointmentId, messages: msg }); continue; }
    seen.add(appointmentId);
    appointments.push({
      appointmentId,
      patientId,
      date,
      time: `${tm![1].padStart(2, "0")}:${tm![2]}`,
      provider: get(c, "provider"),
      location: get(c, "location"),
      visitType: get(c, "visit_type") || "clinic",
      phone,
      language: knownLanguages.includes(lang.split(/[-_]/)[0]) ? lang.split(/[-_]/)[0] : lang,
      contactPreference: pref,
      careGapConsent: ["yes", "y", "true"].includes(consentRaw),
    });
  }
  return { appointments, errors, mappingErrors };
}
