/**
 * Appointment reminder engine. Deterministic, pure, no network, no model call.
 * CareIQ does not book visits. The clinic EHR stays the system of record; this only
 * reminds patients of appointments the clinic imported.
 *
 * Message limits follow the FCC TCPA health care exemption (2015 Omnibus Declaratory
 * Ruling, 47 CFR 64.1200 guidance) as a design rule, not legal advice:
 *   - Health care purpose only: no promotional, marketing, or billing content.
 *   - At most 1 message per day and 3 per week per patient phone.
 *   - SMS 160 characters or less, voice scripts short.
 *   - Every SMS says how to opt out (Reply STOP). Opt outs are honored at once.
 *   - Sent only between 8 AM and 9 PM clinic local time.
 */

export type ContactPreference = "text" | "voice" | "none";

export interface Appointment {
  appointmentId: string;
  patientId: string;
  date: string; // YYYY-MM-DD, clinic local
  time: string; // HH:MM 24 hour, clinic local
  provider: string;
  location: string;
  visitType: string;
  phone: string | null; // E.164 or null
  language: string; // lower case code, for example en, es
  contactPreference: ContactPreference;
  careGapConsent: boolean;
}

export interface ReminderTemplate {
  sms: string; // placeholders: {clinic} {visit} {date} {time} {provider} {location}
  voice: string; // also {gap}
  gapPrefix: string; // for example "Ask about your"
  stop: string; // opt out line, must contain STOP for SMS
  help: string; // HELP reply
}

/** Built in templates. Clinics can add other languages with the same fields. */
export const DEFAULT_TEMPLATES: Record<string, ReminderTemplate> = {
  en: {
    sms: "{clinic}: reminder of your {visit} visit {date} at {time} with {provider}, {location}.",
    voice: "Hello, this is {clinic} with a reminder of your {visit} visit on {date} at {time} with {provider} at {location}.{gap} To stop these calls, tell the clinic. Goodbye.",
    gapPrefix: "Ask about your",
    stop: "Reply STOP to opt out.",
    help: "{clinic} appointment reminders. Call the clinic for help. Reply STOP to opt out.",
  },
  es: {
    sms: "{clinic}: recordatorio de su cita de {visit} el {date} a las {time} con {provider}, {location}.",
    voice: "Hola, le llama {clinic} para recordarle su cita de {visit} el {date} a las {time} con {provider} en {location}.{gap} Para no recibir estas llamadas, avise a la clinica. Adios.",
    gapPrefix: "Pregunte por su",
    stop: "Responda STOP para cancelar.",
    help: "Recordatorios de citas de {clinic}. Llame a la clinica para ayuda. Responda STOP para cancelar.",
  },
};

/** Care gap topics in plain words, per language. Unknown languages fall back to English. */
export const GAP_TOPICS: Record<string, Record<string, string>> = {
  en: {
    CMS125: "breast cancer screening", CMS130: "colorectal screening", CMS124: "cervical screening",
    CMS2: "depression screening", CMS138: "tobacco screening", CMS347: "cholesterol medicine",
    CMS165: "blood pressure check", CMS122: "A1C test",
  },
  es: {
    CMS125: "mamografia", CMS130: "prueba de cancer de colon", CMS124: "prueba de cancer de cuello uterino",
    CMS2: "evaluacion de depresion", CMS138: "evaluacion de tabaco", CMS347: "medicina para el colesterol",
    CMS165: "control de presion", CMS122: "prueba de A1C",
  },
};

export const SMS_MAX = 160;
export const CLINIC_NAME_MAX = 40;
export const FALLBACK_CLINIC_NAME = "Your clinic";

/** Clinic name for messages: blank falls back, long names are cut at a word boundary. */
export function messageClinicName(raw: string | null | undefined): string {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!name) return FALLBACK_CLINIC_NAME;
  if (name.length <= CLINIC_NAME_MAX) return name;
  const cut = name.slice(0, CLINIC_NAME_MAX + 1);
  const space = cut.lastIndexOf(" ");
  return (space >= 12 ? cut.slice(0, space) : name.slice(0, CLINIC_NAME_MAX)).replace(/[\s,.;:&-]+$/, "");
}
export const DAILY_CAP = 1;
export const WEEKLY_CAP = 3;
export const DEFAULT_OFFSETS_DAYS = [3, 1];
export const SEND_WINDOW = { startHour: 8, endHour: 21 };

export interface EngineOptions {
  clinicName: string;
  offsetsDays?: number[];
  templates?: Record<string, ReminderTemplate>; // clinic added languages merged over defaults
}

export type PlanStatus =
  | "queued"
  | "skipped_opted_out"
  | "skipped_no_contact"
  | "skipped_daily_cap"
  | "skipped_weekly_cap"
  | "skipped_past"
  | "staff_call";

export interface PlannedReminder {
  appointmentId: string;
  patientId: string;
  sendOn: string; // YYYY-MM-DD
  offsetDays: number;
  channel: "sms" | "voice" | "staff";
  language: string;
  languageFallback: boolean;
  body: string;
  status: PlanStatus;
  includesGapLine: boolean;
}

/** Prior sends for cap counting, keyed by phone. */
export interface SentRecord {
  phone: string;
  sentOn: string;
}

function shiftDays(iso: string, days: number): string {
  const t = Date.parse(`${iso}T00:00:00Z`) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);
}

export function pickTemplate(language: string, templates: Record<string, ReminderTemplate>): { lang: string; t: ReminderTemplate; fallback: boolean } {
  const lang = (language || "en").toLowerCase().split(/[-_]/)[0];
  if (templates[lang]) return { lang, t: templates[lang], fallback: false };
  return { lang: "en", t: templates.en, fallback: lang !== "en" };
}

function fill(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

function time12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}/${d}`;
}

/**
 * Builds the SMS. Keeps it at 160 characters or less by dropping, in order: location,
 * then the care gap line, then provider. The STOP line is never dropped.
 */
export function buildSms(a: Appointment, t: ReminderTemplate, lang: string, clinic: string, gaps: string[]): { body: string; gapLine: boolean } {
  const topics = GAP_TOPICS[lang] || GAP_TOPICS.en;
  const topic = a.careGapConsent ? gaps.map((g) => topics[g]).find(Boolean) : undefined;
  const gapText = topic ? ` ${t.gapPrefix} ${topic}.` : "";
  const attempts: [Record<string, string>, string][] = [
    [{ provider: a.provider, location: a.location }, gapText],
    [{ provider: a.provider, location: "" }, gapText],
    [{ provider: a.provider, location: a.location }, ""],
    [{ provider: a.provider, location: "" }, ""],
    [{ provider: "", location: "" }, ""],
  ];
  for (const [vars, gap] of attempts) {
    let main = fill(t.sms, { clinic, visit: a.visitType, date: shortDate(a.date), time: time12(a.time), ...vars });
    main = main.replace(/ with ,/g, ",").replace(/, \./g, ".").replace(/ con ,/g, ",").replace(/\s+/g, " ").replace(/ ,/g, ",");
    const body = `${main}${gap} ${t.stop}`.trim();
    if (body.length <= SMS_MAX) return { body, gapLine: gap !== "" };
  }
  const fallback = `${clinic}: visit ${shortDate(a.date)} ${time12(a.time)}. ${t.stop}`;
  return { body: fallback.slice(0, SMS_MAX), gapLine: false };
}

export function buildVoice(a: Appointment, t: ReminderTemplate, lang: string, clinic: string, gaps: string[]): { body: string; gapLine: boolean } {
  const topics = GAP_TOPICS[lang] || GAP_TOPICS.en;
  const topic = a.careGapConsent ? gaps.map((g) => topics[g]).find(Boolean) : undefined;
  const gap = topic ? ` ${t.gapPrefix} ${topic}.` : "";
  const body = fill(t.voice, { clinic, visit: a.visitType, date: shortDate(a.date), time: time12(a.time), provider: a.provider, location: a.location, gap });
  return { body, gapLine: !!topic };
}

/**
 * Plans reminders for appointments from `today` onward. Caps count earlier sends
 * (sent) plus reminders queued earlier in this same plan, per phone.
 */
export function planReminders(input: {
  appointments: Appointment[];
  today: string;
  options: EngineOptions;
  gapsByPatient: Record<string, string[]>;
  optedOutPhones: Set<string>;
  sent: SentRecord[];
}): PlannedReminder[] {
  const templates = { ...DEFAULT_TEMPLATES, ...(input.options.templates || {}) };
  const offsets = [...(input.options.offsetsDays || DEFAULT_OFFSETS_DAYS)].sort((x, y) => y - x);
  const byPhone = new Map<string, string[]>();
  for (const s of input.sent) byPhone.set(s.phone, [...(byPhone.get(s.phone) || []), s.sentOn]);

  const candidates: { a: Appointment; sendOn: string; offset: number }[] = [];
  for (const a of input.appointments) {
    for (const offset of offsets) candidates.push({ a, sendOn: shiftDays(a.date, -offset), offset });
  }
  candidates.sort((x, y) => x.sendOn.localeCompare(y.sendOn) || x.a.date.localeCompare(y.a.date) || x.a.appointmentId.localeCompare(y.a.appointmentId));

  const out: PlannedReminder[] = [];
  for (const { a, sendOn, offset } of candidates) {
    const { lang, t, fallback } = pickTemplate(a.language, templates);
    const base = { appointmentId: a.appointmentId, patientId: a.patientId, sendOn, offsetDays: offset, language: lang, languageFallback: fallback };
    const gaps = input.gapsByPatient[a.patientId] || [];
    if (a.date < input.today) continue;
    if (sendOn < input.today) { out.push({ ...base, channel: "sms", body: "", status: "skipped_past", includesGapLine: false }); continue; }
    if (a.contactPreference === "none") { out.push({ ...base, channel: "staff", body: "", status: "skipped_no_contact", includesGapLine: false }); continue; }
    if (!a.phone) { out.push({ ...base, channel: "staff", body: "", status: "staff_call", includesGapLine: false }); continue; }
    if (input.optedOutPhones.has(a.phone)) { out.push({ ...base, channel: a.contactPreference === "voice" ? "voice" : "sms", body: "", status: "skipped_opted_out", includesGapLine: false }); continue; }
    const history = byPhone.get(a.phone) || [];
    const channel = a.contactPreference === "voice" ? "voice" : "sms";
    if (history.filter((d) => d === sendOn).length >= DAILY_CAP) { out.push({ ...base, channel, body: "", status: "skipped_daily_cap", includesGapLine: false }); continue; }
    if (history.filter((d) => { const diff = dayDiff(sendOn, d); return diff >= 0 && diff < 7; }).length >= WEEKLY_CAP) {
      out.push({ ...base, channel, body: "", status: "skipped_weekly_cap", includesGapLine: false });
      continue;
    }
    const built = channel === "voice"
      ? buildVoice(a, t, lang, input.options.clinicName, gaps)
      : buildSms(a, t, lang, input.options.clinicName, gaps);
    out.push({ ...base, channel, body: built.body, status: "queued", includesGapLine: built.gapLine });
    byPhone.set(a.phone, [...history, sendOn]);
  }
  return out;
}

/** STOP, HELP, and START keywords (Twilio and CTIA standard words). */
export function inboundKeyword(body: string): "stop" | "help" | "start" | null {
  const word = body.trim().toUpperCase();
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "PARAR"].includes(word)) return "stop";
  if (["HELP", "INFO", "AYUDA"].includes(word)) return "help";
  if (["START", "UNSTOP", "YES"].includes(word)) return "start";
  return null;
}

export function inSendWindow(localHour: number): boolean {
  return localHour >= SEND_WINDOW.startHour && localHour < SEND_WINDOW.endHour;
}
