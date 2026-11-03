import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dispatchToday, importAppointments, reminderOverview, sendingState, setReminderTemplate, type ReminderDeps } from "../src/lib/clinic/reminders/actions";
import { normalizePhone, parseAppointmentCsv, appointmentTemplateCsv } from "../src/lib/clinic/reminders/csv";
import { buildSms, buildVoice, DEFAULT_TEMPLATES, messageClinicName, inboundKeyword, inSendWindow, pickTemplate, planReminders, SMS_MAX, type Appointment } from "../src/lib/clinic/reminders/engine";
import { MemoryReminderStore } from "../src/lib/clinic/reminders/store";
import { handleReminderInbound, reminderEnv, twilioConfigured, sendingFlagOn } from "../src/lib/clinic/reminders/twilio";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { twilioSignature } from "../src/lib/clinic/twilio-inbound";
import { MemoryUdsPanelStore } from "../src/lib/clinic/uds/panel-store";

const appt = (o: Partial<Appointment> = {}): Appointment => ({
  appointmentId: "APT-1", patientId: "SYN-0001", date: "2026-11-10", time: "09:30", provider: "Dr Rivera",
  location: "Main Street Clinic", visitType: "checkup", phone: "+13125550101", language: "en",
  contactPreference: "text", careGapConsent: false, ...o,
});
const plan = (appointments: Appointment[], extra: Partial<Parameters<typeof planReminders>[0]> = {}) =>
  planReminders({ appointments, today: "2026-11-02", options: { clinicName: "Synthetic Clinic" }, gapsByPatient: {}, optedOutPhones: new Set(), sent: [], ...extra });

test("reminders go 3 days and 1 day before the visit", () => {
  const p = plan([appt()]);
  assert.deepEqual(p.map((r) => [r.sendOn, r.offsetDays, r.status]), [["2026-11-07", 3, "queued"], ["2026-11-09", 1, "queued"]]);
  // A send day already past is skipped, not sent late.
  const late = plan([appt({ date: "2026-11-04" })]);
  assert.deepEqual(late.map((r) => r.status), ["skipped_past", "queued"]);
});

test("caps: at most 1 per day and 3 per week per phone", () => {
  const daily = plan([appt(), appt({ appointmentId: "APT-2", patientId: "SYN-0002" })]);
  assert.equal(daily.filter((r) => r.status === "queued").length, 2);
  assert.equal(daily.filter((r) => r.status === "skipped_daily_cap").length, 2);
  const weekly = plan([appt()], { sent: [{ phone: "+13125550101", sentOn: "2026-11-03" }, { phone: "+13125550101", sentOn: "2026-11-04" }, { phone: "+13125550101", sentOn: "2026-11-05" }] });
  assert.equal(weekly[0].status, "skipped_weekly_cap");
});

test("opted out and unreachable patients are not texted; no phone goes to a staff call", () => {
  assert.ok(plan([appt()], { optedOutPhones: new Set(["+13125550101"]) }).every((r) => r.status === "skipped_opted_out"));
  assert.ok(plan([appt({ contactPreference: "none" })]).every((r) => r.status === "skipped_no_contact"));
  assert.ok(plan([appt({ phone: null })]).every((r) => r.status === "staff_call" && r.body === ""));
});

test("language selection: Spanish template, unknown language falls back to English and is flagged", () => {
  const es = plan([appt({ language: "es" })])[0];
  assert.equal(es.language, "es");
  assert.match(es.body, /PARAR|STOP/);
  assert.equal(es.languageFallback, false);
  const vi = pickTemplate("vi", DEFAULT_TEMPLATES);
  assert.equal(vi.lang, "en");
  assert.equal(vi.fallback, true);
  const custom = { ...DEFAULT_TEMPLATES, vi: { ...DEFAULT_TEMPLATES.en, sms: "{clinic} nhac lich {date} {time}." } };
  assert.equal(pickTemplate("vi", custom).fallback, false);
});

test("care gap line only with consent", () => {
  const gaps = { "SYN-0001": ["CMS125"] };
  assert.equal(plan([appt()], { gapsByPatient: gaps })[0].includesGapLine, false);
  const yes = plan([appt({ careGapConsent: true })], { gapsByPatient: gaps })[0];
  assert.equal(yes.includesGapLine, true);
});

test("every SMS is 160 characters or less and keeps STOP; voice for phone only patients", () => {
  const long = appt({ careGapConsent: true, provider: "Dr ".padEnd(60, "x"), location: "L".padEnd(70, "y") });
  for (const lang of ["en", "es"]) {
    const { body } = buildSms(long, DEFAULT_TEMPLATES[lang], lang, "Synthetic Community Health Center", ["CMS125", "CMS130"]);
    assert.ok(body.length <= SMS_MAX, `${lang} ${body.length}`);
    assert.match(body, /STOP|PARAR/);
  }
  const v = plan([appt({ contactPreference: "voice" })])[0];
  assert.equal(v.channel, "voice");
  assert.ok(buildVoice(appt(), DEFAULT_TEMPLATES.en, "en", "Clinic", []).body.length > 0);
});

test("no promotional content in the default templates", () => {
  for (const t of Object.values(DEFAULT_TEMPLATES)) {
    assert.doesNotMatch(JSON.stringify(t), /sale|discount|offer|free|deal|promo/i);
  }
});

test("inbound keywords and send window", () => {
  assert.equal(inboundKeyword(" stop "), "stop");
  assert.equal(inboundKeyword("PARAR"), "stop");
  assert.equal(inboundKeyword("ayuda"), "help");
  assert.equal(inboundKeyword("START"), "start");
  assert.equal(inboundKeyword("see you then"), null);
  assert.equal(inSendWindow(7), false);
  assert.equal(inSendWindow(8), true);
  assert.equal(inSendWindow(21), false);
});

test("CSV parsing: template round trip, phone normalizing, per row errors", () => {
  assert.equal(normalizePhone("(312) 555-0101"), "+13125550101");
  assert.equal(normalizePhone("123"), null);
  assert.equal(parseAppointmentCsv(appointmentTemplateCsv()).errors.length, 0);
  const csv = "appointment_id,patient_id,appointment_date,appointment_time,patient_phone,contact_preference\nA1,SYN-0001,2026-11-10,09:30,312-555-0101,text\nA2,,2026-13-40,25:00,12,fax\n";
  const r = parseAppointmentCsv(csv);
  assert.equal(r.appointments.length, 1);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 2);
  assert.ok(r.errors[0].messages.length >= 3);
  const fixture = parseAppointmentCsv(readFileSync("fixtures/appointments-sample.csv", "utf8"), undefined, ["en", "es", "vi"]);
  assert.ok(fixture.appointments.length >= 50);
  assert.equal(fixture.errors.length, 0);
  assert.ok(fixture.appointments.every((a) => a.patientId.startsWith("SYN-")));
});

async function setup() {
  const clinicStore = new MemoryClinicStore();
  const clinic = await clinicStore.createClinic("Synthetic FQHC");
  const admin = await clinicStore.addStaff(clinic.id, "provider", "Admin", null, { is_admin: true });
  const staff = await clinicStore.addStaff(clinic.id, "nurse" as never, "Nurse");
  const store = new MemoryReminderStore();
  const events: string[] = [];
  const deps: ReminderDeps = { clinicStore, panelStore: new MemoryUdsPanelStore(), store, audit: async (e) => { events.push(JSON.stringify(e)); }, hashPhone: (p) => `h:${p}` };
  const act = (s: typeof admin) => ({ kind: "staff" as const, clinicId: clinic.id, staffId: s.id, role: s.role });
  return { deps, store, events, adminActor: act(admin), staffActor: act(staff) };
}

test("import is admin only; overview and dry run when sending is off; audit has no PHI", async () => {
  const { deps, events, adminActor, staffActor } = await setup();
  const rows = [appt({ date: "2026-11-05" }), appt({ appointmentId: "APT-2", patientId: "SYN-0002", phone: null, date: "2026-11-06" })];
  assert.equal((await importAppointments(deps, staffActor, rows, "replace")).ok, false);
  const imp = await importAppointments(deps, adminActor, rows, "replace");
  assert.ok(imp.ok);
  const off = sendingState(false, false);
  assert.equal(off.message, "Reminders are queued but not sent: text service not set up.");
  const ov = await reminderOverview(deps, staffActor, { today: "2026-11-02", clinicName: "C", sending: off });
  assert.ok(ov.ok);
  if (ov.ok) {
    assert.equal(ov.data.upcoming.length, 2);
    assert.equal(ov.data.staffCalls.length, 1);
    assert.equal(ov.data.staffCalls[0].reason, "No reachable phone");
  }
  let sends = 0;
  const d = await dispatchToday(deps, adminActor, { today: "2026-11-02", clinicName: "C", sending: off, nowIso: "2026-11-02T15:00:00Z", localHour: 10, send: async () => { sends++; return true; } });
  assert.ok(d.ok);
  if (d.ok) { assert.equal(d.data.sent, 0); assert.equal(d.data.dryRun, 1); }
  assert.equal(sends, 0);
  assert.equal((await dispatchToday(deps, staffActor, { today: "2026-11-02", clinicName: "C", sending: off, nowIso: "", localHour: 10, send: null })).ok, false);
  const log = events.join("\n");
  assert.doesNotMatch(log, /SYN-|555|Rivera|Main Street/);
});

test("dispatch sends only when on and in the send window, and logs so caps hold", async () => {
  const { deps, store, adminActor } = await setup();
  await importAppointments(deps, adminActor, [appt({ date: "2026-11-05" })], "replace");
  const on = sendingState(true, true);
  const to: string[] = [];
  const send = async (_c: "sms" | "voice", n: string) => { to.push(n); return true; };
  const night = await dispatchToday(deps, adminActor, { today: "2026-11-02", clinicName: "C", sending: on, nowIso: "", localHour: 22, send });
  assert.ok(night.ok && night.data.sent === 0);
  const day = await dispatchToday(deps, adminActor, { today: "2026-11-02", clinicName: "C", sending: on, nowIso: "2026-11-02T16:00:00Z", localHour: 10, send });
  assert.ok(day.ok && day.data.sent === 1);
  assert.deepEqual(to, ["+13125550101"]);
  const again = await dispatchToday(deps, adminActor, { today: "2026-11-02", clinicName: "C", sending: on, nowIso: "2026-11-02T17:00:00Z", localHour: 11, send });
  assert.ok(again.ok && again.data.sent === 0);
  assert.equal((await store.listLogs(adminActor.clinicId)).length, 1);
});

test("templates: admin only and STOP required", async () => {
  const { deps, adminActor, staffActor } = await setup();
  const t = { ...DEFAULT_TEMPLATES.en, sms: "{clinic}: visit {date} {time}." };
  assert.equal((await setReminderTemplate(deps, staffActor, "vi", t)).ok, false);
  assert.equal((await setReminderTemplate(deps, adminActor, "vi", { ...t, stop: "Reply X" })).ok, false);
  assert.ok((await setReminderTemplate(deps, adminActor, "vi", t)).ok);
});

test("sending needs Twilio env and the flag set to on", () => {
  assert.equal(twilioConfigured(reminderEnv({})), false);
  const e = reminderEnv({ TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_FROM: "+13125550199" });
  assert.equal(twilioConfigured(e), true);
  assert.equal(sendingFlagOn(e), false);
  assert.equal(sendingFlagOn(reminderEnv({ CAREIQ_REMINDERS_SENDING: "on" })), true);
});

test("inbound STOP and HELP are signature verified", async () => {
  const store = new MemoryReminderStore();
  const url = "https://example.test/api/clinic/reminders/inbound";
  const params = { Body: "STOP", From: "+13125550101" };
  const raw = new URLSearchParams(params).toString();
  const base = { url, rawBody: raw, authToken: "tok", at: "2026-11-02T15:00:00Z" };
  assert.equal((await handleReminderInbound({ ...base, authToken: "", signature: "" }, store, (p) => `h:${p}`)).status, 503);
  assert.equal((await handleReminderInbound({ ...base, signature: "bad" }, store, (p) => `h:${p}`)).status, 403);
  const ok = await handleReminderInbound({ ...base, signature: twilioSignature("tok", url, params) }, store, (p) => `h:${p}`);
  assert.equal(ok.status, 200);
  assert.ok((await store.listOptOutHashes()).has("h:+13125550101"));
  const help = { Body: "HELP", From: "+13125550101" };
  const h = await handleReminderInbound({ ...base, rawBody: new URLSearchParams(help).toString(), signature: twilioSignature("tok", url, help) }, store, (p) => `h:${p}`);
  assert.match(h.body, /<Message>.*STOP/);
});

test("middleware: reminder webhook is CSRF exempt and appointments API is staff only", () => {
  const src = readFileSync("src/middleware.ts", "utf8");
  assert.match(src, /"\/api\/clinic\/reminders\/inbound"/);
  assert.match(src, /STAFF_ONLY_CLINIC_APIS = new Set<string>\(\[[^\]]*"\/api\/clinic\/appointments"/);
});

test("clinic name comes from the clinic record, blank falls back, long names are cut and SMS stays 160", async () => {
  assert.equal(messageClinicName("  "), "Your clinic");
  assert.equal(messageClinicName(null), "Your clinic");
  assert.equal(messageClinicName("Synthetic Community Health"), "Synthetic Community Health");
  const long = messageClinicName("Synthetic Northside Community Health Center of Greater Springfield");
  assert.ok(long.length <= 40);
  assert.equal(long, "Synthetic Northside Community Health");
  const huge = "X".repeat(300);
  for (const lang of ["en", "es"]) {
    const body = planReminders({ appointments: [appt({ language: lang, careGapConsent: true, provider: "P".repeat(50), location: "L".repeat(60) })], today: "2026-11-02", options: { clinicName: messageClinicName(huge) }, gapsByPatient: { "SYN-0001": ["CMS125"] }, optedOutPhones: new Set(), sent: [] })[0].body;
    assert.ok(body.length <= SMS_MAX);
    assert.match(body, /STOP/);
  }
  const clinicStore = new MemoryClinicStore();
  const c = await clinicStore.createClinic("Synthetic Eastside FQHC");
  assert.equal(messageClinicName((await clinicStore.getClinic(c.id))?.name), "Synthetic Eastside FQHC");
  assert.equal(await clinicStore.getClinic("nope"), null);
  const { deps, adminActor } = await setup();
  await importAppointments(deps, adminActor, [appt({ date: "2026-11-05" })], "replace");
  const ov = await reminderOverview(deps, adminActor, { today: "2026-11-02", clinicName: "Synthetic Eastside FQHC", sending: sendingState(false, false) });
  assert.ok(ov.ok && ov.data.upcoming[0].reminders.some((r) => r.body.startsWith("Synthetic Eastside FQHC:")));
});
