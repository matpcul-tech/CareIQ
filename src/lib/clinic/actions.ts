import type { Actor, CircleRole, HomeReading, PanelRow, StaffRole, Thresholds } from "./logic";
import { buildScorecard, type MeasureId, MEASURE_IDS, validScreen, type ScorecardPatient } from "./scorecard";
import {
  canAddMember,
  canPostConcern,
  canRevoke,
  circleModelPayload,
  effectiveVitals,
  estimateMeasures,
  isActiveStaff,
  parseRegistryCsv,
  preVisitGaps,
  readingOutOfRange,
  rankWorklist,
  trackingSummary,
  visitIsSoon,
} from "./logic";
import type { ClinicStore, PatientRecord } from "./store";
import { deliverSms, type SmsEnv, type SmsResult } from "./sms";
import { isWellnessOkReply, WELLNESS_SMS, wellnessDecision } from "./safety";

export interface ActionFailure {
  ok: false;
  status: number;
  error: string;
}

export type ActionResult<T> = { ok: true; data: T } | ActionFailure;

function fail(status: number, error: string): ActionFailure {
  return { ok: false, status, error };
}

async function patientForActor(
  store: ClinicStore,
  actor: Actor,
  clinicPatientId: string,
): Promise<PatientRecord | ActionFailure> {
  const patient = await store.getPatient(clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  if (actor.kind === "patient") {
    if (patient.patient_id !== actor.patientId) return fail(403, "not your record");
    return patient;
  }
  if (actor.kind === "staff") {
    if (actor.revoked || actor.clinicId !== patient.clinic_id) return fail(403, "clinic access revoked");
    return patient;
  }
  if (actor.clinicPatientId !== patient.id || actor.revoked) return fail(403, "circle access revoked");
  return patient;
}

function staffClinic(actor: Actor): string | ActionFailure {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  return actor.clinicId;
}

async function detailAllowed(store: ClinicStore, actor: Actor, patient: PatientRecord): Promise<boolean> {
  if (actor.kind === "patient") return patient.patient_id === actor.patientId;
  if (actor.kind === "circle") return actor.clinicPatientId === patient.id && !actor.revoked;
  if (!isActiveStaff(actor) || actor.clinicId !== patient.clinic_id) return false;
  const members = await store.listMembers(patient.id);
  return members.some((member) => member.staff_id === actor.staffId && !member.revoked_at);
}

async function panelRows(store: ClinicStore, clinicId: string, asOf: string): Promise<PanelRow[]> {
  const patients = await store.listPatients(clinicId);
  const rows: PanelRow[] = [];
  for (const patient of patients) {
    const readings = await store.listReadings(patient.id);
    const vitals = effectiveVitals(
      {
        a1c: patient.last_a1c,
        a1c_date: patient.last_a1c_date,
        systolic: patient.bp_systolic,
        diastolic: patient.bp_diastolic,
        bp_date: patient.last_bp_date,
      },
      readings,
    );
    const checkins = await store.listCheckins(patient.id);
    const alerts = await store.listAlerts(patient.id);
    const outreach = await store.listOutreach(patient.id);
    const last = outreach[outreach.length - 1];
    const homeRecent = readings.some((reading) => asOf.slice(0, 7) === reading.recorded_on.slice(0, 7) || reading.recorded_on >= shiftDays(asOf, -30));
    rows.push({
      external_id: patient.external_id,
      age: patient.age,
      has_diabetes: patient.has_diabetes,
      has_hypertension: patient.has_hypertension,
      a1c: vitals.a1c,
      a1c_date: vitals.a1c_date,
      systolic: vitals.systolic,
      diastolic: vitals.diastolic,
      bp_date: vitals.bp_date,
      next_visit_date: patient.next_visit_date,
      missed_medication: checkins.some((item) => item.kind === "medication" && item.status === "missed"),
      missed_appointment: checkins.some((item) => item.kind === "appointment" && item.status === "missed"),
      home_out_of_range: alerts.length > 0,
      home_reading_within_30d: homeRecent,
      last_outcome: last ? last.outcome : null,
    });
  }
  return rows;
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(iso + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function attachCareTeam(store: ClinicStore, clinicId: string, patientIds: string[]): Promise<void> {
  const staff = (await store.listStaff(clinicId)).filter((row) => !row.revoked_at);
  for (const patientId of patientIds) {
    for (const person of staff) {
      await store.addMember({
        clinic_patient_id: patientId,
        role: person.role,
        display_name: person.display_name,
        staff_id: person.id,
      });
    }
  }
}

export async function importRegistry(
  store: ClinicStore,
  actor: Actor,
  csv: string,
): Promise<ActionResult<{ imported: number }>> {
  const clinicId = staffClinic(actor);
  if (typeof clinicId !== "string") return clinicId;
  const parsed = parseRegistryCsv(csv);
  if ("error" in parsed) return fail(400, parsed.error);
  const saved = await store.upsertPatients(clinicId, parsed.rows);
  await attachCareTeam(store, clinicId, saved.map((row) => row.id));
  for (let i = 0; i < saved.length; i++) {
    await importCancerDates(store, saved[i].id, parsed.rows[i]);
  }
  return { ok: true, data: { imported: saved.length } };
}

async function importCancerDates(store: ClinicStore, clinicPatientId: string, row: { last_fit_date?: string | null; last_colonoscopy_date?: string | null; last_mammogram_date?: string | null; last_pap_date?: string | null; cervical_hpv?: boolean }) {
  const add = async (kind: "colorectal" | "breast" | "cervical", method: string, date: string | null | undefined) => {
    if (!date) return;
    await store.addSafety({
      clinic_patient_id: clinicPatientId,
      kind: "cancer",
      recorded_on: date,
      payload: { kind, method, result: "normal", screened_on: date, follow_up_on: null },
    });
  };
  await add("colorectal", "fit", row.last_fit_date);
  await add("colorectal", "colonoscopy", row.last_colonoscopy_date);
  await add("breast", "mammogram", row.last_mammogram_date);
  await add("cervical", row.cervical_hpv ? "pap_hpv" : "pap", row.last_pap_date);
}

export async function setClinicThresholds(
  store: ClinicStore,
  actor: Actor,
  patch: Partial<Thresholds>,
): Promise<ActionResult<Thresholds>> {
  if (!isActiveStaff(actor) || actor.role !== "provider") return fail(403, "provider only");
  const clean: Partial<Thresholds> = {};
  for (const key of ["bp_systolic", "bp_diastolic", "glucose_high", "glucose_low", "a1c"] as const) {
    const value = patch[key];
    if (typeof value === "number") clean[key] = value;
  }
  const next = await store.setThresholds(actor.clinicId, clean);
  return { ok: true, data: next };
}

export async function clinicWorklist(store: ClinicStore, actor: Actor, asOf: string) {
  const clinicId = staffClinic(actor);
  if (typeof clinicId !== "string") return clinicId;
  const rows = await panelRows(store, clinicId, asOf);
  const items = rankWorklist(rows, asOf).slice(0, 50).map(({ score: _score, ...item }) => item);
  return { ok: true as const, data: { items, as_of: asOf } };
}

export async function clinicMeasures(store: ClinicStore, actor: Actor, asOf: string) {
  const clinicId = staffClinic(actor);
  if (typeof clinicId !== "string") return clinicId;
  const rows = await panelRows(store, clinicId, asOf);
  return { ok: true as const, data: estimateMeasures(rows, asOf) };
}

async function scorecardRows(store: ClinicStore, clinicId: string, month: string): Promise<ScorecardPatient[]> {
  const patients = await store.listPatients(clinicId);
  const rows: ScorecardPatient[] = [];
  for (const patient of patients) {
    const readings = await store.listReadings(patient.id);
    const vitals = effectiveVitals(
      {
        a1c: patient.last_a1c,
        a1c_date: patient.last_a1c_date,
        systolic: patient.bp_systolic,
        diastolic: patient.bp_diastolic,
        bp_date: patient.last_bp_date,
      },
      readings,
    );
    const screens = await store.listScreens(patient.id);
    const safety = await store.listSafety(patient.id);
    rows.push({
      external_id: patient.external_id,
      age: patient.age,
      has_diabetes: patient.has_diabetes,
      has_hypertension: patient.has_hypertension,
      a1c: vitals.a1c,
      a1c_date: vitals.a1c_date,
      systolic: vitals.systolic,
      diastolic: vitals.diastolic,
      bp_date: vitals.bp_date,
      screens: screens.map((screen) => ({
        instrument: screen.instrument,
        score: screen.score,
        follow_up: screen.follow_up,
        recorded_on: screen.recorded_on,
      })),
      reading_dates: readings.map((reading) => reading.recorded_on),
      minutes: await store.getMinutes(patient.id, month),
      sex: patient.sex,
      cost_barrier: patient.cost_barrier,
      transport_barrier: patient.transport_barrier,
      cancer: safety.filter((event) => event.kind === "cancer").map((event) => ({
        kind: event.payload.kind === "breast" || event.payload.kind === "cervical" ? event.payload.kind : "colorectal",
        method: String(event.payload.method || ""),
        result: event.payload.result === "abnormal" ? "abnormal" as const : "normal" as const,
        screened_on: String(event.payload.screened_on || event.recorded_on),
        follow_up_on: event.payload.follow_up_on ? String(event.payload.follow_up_on) : null,
      })),
      cognitive: safety.filter((event) => event.kind === "cognitive").map((event) => ({
        score: Number(event.payload.score || 0),
        recorded_on: event.recorded_on,
      })),
      falls: safety.filter((event) => event.kind === "falls").map((event) => ({
        at_risk: Boolean(event.payload.at_risk),
        recorded_on: event.recorded_on,
      })),
      strain: safety.filter((event) => event.kind === "strain").map((event) => ({
        score: Number(event.payload.score || 0),
        recorded_on: event.recorded_on,
      })),
      wellness: {
        opted_in: patient.wellness_opt_in,
        lives_alone: patient.lives_alone,
        last_ok_at: patient.wellness_last_ok,
        family_notified_at: patient.wellness_family_notified_at,
        team_notified_at: patient.wellness_team_notified_at,
      },
    });
  }
  return rows;
}

export async function clinicScorecard(store: ClinicStore, actor: Actor, asOf: string) {
  const clinicId = staffClinic(actor);
  if (typeof clinicId !== "string") return clinicId;
  const month = asOf.slice(0, 7);
  const overrides = await store.getMeasureTargets(clinicId);
  const settings = await store.getCareSettings(clinicId);
  const data = buildScorecard(
    await scorecardRows(store, clinicId, month),
    overrides as Partial<Record<MeasureId, number>>,
    asOf,
    month,
    settings,
  );
  return { ok: true as const, data };
}

export async function setMeasureTargets(
  store: ClinicStore,
  actor: Actor,
  patch: Record<string, number>,
  asOf: string,
) {
  if (!isActiveStaff(actor) || actor.role !== "provider") return fail(403, "provider only");
  for (const [key, value] of Object.entries(patch)) {
    if (!MEASURE_IDS.includes(key as MeasureId)) return fail(400, "unknown measure");
    if (typeof value !== "number" || value < 0 || value > 1) return fail(400, "target must be from 0 to 1");
    await store.setMeasureTarget(actor.clinicId, key, value);
  }
  return clinicScorecard(store, actor, asOf);
}

export async function addScreen(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; instrument: string; score: number; followUp: boolean; on: string },
) {
  if (!canPostConcern(actor)) return fail(403, "caregiver or patient only");
  if (!validScreen(input.instrument, input.score)) return fail(400, "PHQ-2 is 0 to 6 and PHQ-9 is 0 to 27");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const saved = await store.addScreen({
    clinic_patient_id: patient.id,
    instrument: input.instrument,
    score: input.score,
    follow_up: input.followUp,
    recorded_on: input.on,
  });
  return { ok: true as const, data: { id: saved.id, instrument: saved.instrument, score: saved.score } };
}

export async function clinicGaps(store: ClinicStore, actor: Actor, asOf: string) {
  const clinicId = staffClinic(actor);
  if (typeof clinicId !== "string") return clinicId;
  const rows = await panelRows(store, clinicId, asOf);
  const items = rows
    .filter((row) => visitIsSoon(row.next_visit_date, asOf))
    .map((row) => ({
      external_id: row.external_id,
      next_visit_date: row.next_visit_date,
      gaps: preVisitGaps(row, asOf),
    }))
    .slice(0, 50);
  return { ok: true as const, data: { items, as_of: asOf } };
}

export async function clinicTracking(store: ClinicStore, actor: Actor, clinicPatientId: string, month: string) {
  const patient = await store.getPatient(clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const readings = await store.listReadings(clinicPatientId);
  const minutes = await store.getMinutes(clinicPatientId, month);
  return {
    ok: true as const,
    data: trackingSummary(readings.map((reading) => reading.recorded_on), minutes, month),
  };
}

export async function addHomeReading(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; reading: HomeReading },
) {
  if (!canPostConcern(actor) && !(actor.kind === "circle" && !actor.revoked && (actor.role === "caregiver" || actor.role === "admin"))) {
    if (actor.kind !== "patient") return fail(403, "patient or caregiver only");
  }
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const thresholds = await store.getThresholds(patient.clinic_id);
  const saved = await store.addReading({ ...input.reading, clinic_patient_id: patient.id });
  const flag = readingOutOfRange(saved, thresholds);
  let alert = null;
  if (flag.out && flag.metric && flag.value) {
    alert = await store.addAlert({
      clinic_patient_id: patient.id,
      metric: flag.metric,
      value_text: flag.value,
      created_on: saved.recorded_on,
    });
  }
  return {
    ok: true as const,
    data: {
      id: saved.id,
      out_of_range: flag.out,
      metric: flag.metric,
      alert_id: alert?.id || null,
    },
  };
}

export async function addConcern(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; body: string; on: string },
) {
  if (!canPostConcern(actor)) return fail(403, "caregiver or patient only");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const role = actor.kind === "patient" ? "patient" : actor.role;
  const saved = await store.addMessage({
    clinic_patient_id: patient.id,
    author_role: role,
    body: input.body,
    created_on: input.on,
  });
  return {
    ok: true as const,
    data: { id: saved.id, preview: saved.body.slice(0, 280), author_role: saved.author_role },
  };
}

export async function addCheckin(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; kind: "medication" | "appointment"; status: "missed" | "completed"; on: string },
) {
  if (!canPostConcern(actor)) return fail(403, "caregiver or patient only");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const saved = await store.addCheckin({
    clinic_patient_id: patient.id,
    kind: input.kind,
    status: input.status,
    occurred_on: input.on,
  });
  return { ok: true as const, data: { id: saved.id, kind: saved.kind, status: saved.status } };
}

export async function addCircleMember(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; role: CircleRole; displayName: string },
) {
  if (!canAddMember(actor)) return fail(403, "only the patient or an admin can add members");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const saved = await store.addMember({
    clinic_patient_id: patient.id,
    role: input.role,
    display_name: input.displayName.slice(0, 80),
    staff_id: null,
  });
  return { ok: true as const, data: { id: saved.id, role: saved.role } };
}

export async function revokeCircleMember(
  store: ClinicStore,
  actor: Actor,
  input: { memberId: string; at: string },
) {
  const members = await store.getMember(input.memberId);
  if (!members) return fail(404, "member not found");
  if (!canRevoke(actor, members.role)) return fail(403, "only the patient or an admin can revoke access");
  const patient = await patientForActor(store, actor, members.clinic_patient_id);
  if ("ok" in patient) return patient;
  const saved = await store.revokeMember(input.memberId, input.at);
  return { ok: true as const, data: { id: saved?.id, revoked: true } };
}

export async function openClinic(
  store: ClinicStore,
  actor: Actor,
  input: { name: string; externalId: string },
) {
  if (actor.kind !== "patient") return fail(403, "patient only");
  const clinic = await store.createClinic(input.name);
  const saved = await store.upsertPatients(clinic.id, [{
    external_id: input.externalId,
    age: null,
    has_diabetes: false,
    has_hypertension: false,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: null,
    bp_diastolic: null,
    last_bp_date: null,
    next_visit_date: null,
    patient_id: actor.patientId,
  }]);
  return { ok: true as const, data: { clinic_id: clinic.id, clinic_patient_id: saved[0].id } };
}

export async function addCareTeamStaff(
  store: ClinicStore,
  actor: Actor,
  input: { clinicId: string; role: StaffRole; displayName: string; phone?: string | null },
) {
  if (!isActiveStaff(actor) || actor.role !== "provider" || actor.clinicId !== input.clinicId) {
    return fail(403, "only an active provider can add staff");
  }
  const current = await store.getStaff(actor.staffId);
  if (!current || current.revoked_at || current.role !== "provider" || current.clinic_id !== input.clinicId) {
    return fail(403, "only an active provider can add staff");
  }
  const patients = await store.listPatients(input.clinicId);
  const staff = await store.addStaff(input.clinicId, input.role, input.displayName, input.phone);
  await attachCareTeam(store, input.clinicId, patients.map((row) => row.id));
  return { ok: true as const, data: { role: staff.role } };
}

export async function listCircle(store: ClinicStore, actor: Actor, clinicPatientId: string) {
  const patient = await patientForActor(store, actor, clinicPatientId);
  if ("ok" in patient) return patient;
  if (!(await detailAllowed(store, actor, patient)) && actor.kind !== "patient") {
    return fail(403, "circle access revoked");
  }
  const members = (await store.listMembers(clinicPatientId))
    .filter((member) => !member.revoked_at)
    .map((member) => ({ id: member.id, role: member.role }));
  return { ok: true as const, data: { members } };
}

export async function logOutreach(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; outcome: "contacted" | "scheduled" | "closed" | "no_answer" | "declined"; on: string },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const saved = await store.addOutreach({
    clinic_id: actor.clinicId,
    clinic_patient_id: patient.id,
    staff_role: actor.role as StaffRole,
    outcome: input.outcome,
    created_on: input.on,
  });
  return { ok: true as const, data: { id: saved.id, outcome: saved.outcome } };
}

export async function logMinutes(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; month: string; minutes: number },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  if (!/^\d{4}-\d{2}$/.test(input.month) || input.minutes < 0 || input.minutes > 180) {
    return fail(400, "minutes must be 0 to 180 for one entry");
  }
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const saved = await store.addMinutes(patient.id, input.month, input.minutes);
  return { ok: true as const, data: { month: saved.month, minutes: saved.minutes, label: "Tracking only. Not claims submission." } };
}

export async function maskedInsight(
  store: ClinicStore,
  actor: Actor,
  clinicPatientId: string,
) {
  const patient = await store.getPatient(clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const members = await store.listMembers(clinicPatientId);
  const names = members.map((member) => member.display_name);
  const messages = await store.listMessages(clinicPatientId);
  const alerts = await store.listAlerts(clinicPatientId);
  const checkins = await store.listCheckins(clinicPatientId);
  const parts = [
    ...alerts.map((alert) => ({ label: "Alert", text: `${alert.metric} ${alert.value_text}` })),
    ...checkins
      .filter((item) => item.status === "missed")
      .map((item) => ({ label: "Missed check-in", text: item.kind })),
    ...messages.map((message) => ({ label: "Caregiver message", text: message.body })),
  ];
  const modelRequest = circleModelPayload(parts, names);
  return { ok: true as const, data: { modelRequest, knownNamesUsed: names.length } };
}

export async function notifySms(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; env: SmsEnv; fetchImpl?: typeof fetch },
): Promise<ActionResult<SmsResult>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(404, "patient not found");
  const staff = await store.getStaff(actor.staffId);
  const result = await deliverSms(input.env, staff?.phone, input.fetchImpl);
  return { ok: true, data: result };
}

export async function recordCancerResult(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; kind: "colorectal" | "breast" | "cervical"; method: string; result: "normal" | "abnormal"; on: string },
) {
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  const allowed = actor.kind === "patient"
    ? patient.patient_id === actor.patientId
    : isActiveStaff(actor) && actor.clinicId === patient.clinic_id && await detailAllowed(store, actor, patient);
  if (!allowed && !(actor.kind === "circle" && canPostConcern(actor) && actor.clinicPatientId === patient.id)) {
    return fail(403, "not allowed to record this screening");
  }
  const saved = await store.addSafety({
    clinic_patient_id: patient.id,
    kind: "cancer",
    recorded_on: input.on,
    payload: { kind: input.kind, method: input.method, result: input.result, screened_on: input.on, follow_up_on: null },
  });
  return { ok: true as const, data: { id: saved.id, result: input.result } };
}

export async function recordCancerFollowUp(
  store: ClinicStore,
  actor: Actor,
  input: { eventId: string; on: string },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const existing = await store.getSafety(input.eventId);
  if (!existing) return fail(404, "screening not found");
  const patient = await store.getPatient(existing.clinic_patient_id);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(403, "clinic access revoked");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const updated = await store.updateSafety(input.eventId, { follow_up_on: input.on });
  if (!updated) return fail(404, "screening not found");
  return { ok: true as const, data: { id: updated.id, follow_up_on: input.on } };
}

export async function setBarriers(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; cost: boolean; transport: boolean },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  await store.updatePatient(patient.id, { cost_barrier: input.cost, transport_barrier: input.transport });
  return { ok: true as const, data: { cost_barrier: input.cost, transport_barrier: input.transport } };
}

export async function optInWellness(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; optedIn: boolean; livesAlone: boolean; phone?: string | null; familyPhone?: string | null },
) {
  if (actor.kind !== "patient") return fail(403, "patient opt in only");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const saved = await store.updatePatient(patient.id, {
    wellness_opt_in: input.optedIn,
    lives_alone: input.livesAlone,
    wellness_phone: input.phone || null,
    wellness_family_phone: input.familyPhone || null,
  });
  return { ok: true as const, data: { opted_in: saved?.wellness_opt_in === true, lives_alone: saved?.lives_alone === true } };
}

export async function markWellnessOk(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; at: string },
) {
  if (actor.kind !== "patient") return fail(403, "patient only");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  await store.updatePatient(patient.id, {
    wellness_last_ok: input.at,
    wellness_family_notified_at: null,
    wellness_team_notified_at: null,
  });
  return { ok: true as const, data: { ok: true } };
}

export async function tickWellness(
  store: ClinicStore,
  actor: Actor,
  input: { nowIso: string; env: SmsEnv; fetchImpl?: typeof fetch },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const clinicId = actor.clinicId;
  const settings = await store.getCareSettings(clinicId);
  const patients = (await store.listPatients(clinicId)).filter((row) => row.wellness_opt_in && row.lives_alone);
  const escalations: Array<{ external_id: string; step: string; sms: string }> = [];
  for (const patient of patients) {
    const decision = wellnessDecision({
      opted_in: patient.wellness_opt_in,
      lives_alone: patient.lives_alone,
      last_ok_at: patient.wellness_last_ok,
      family_notified_at: patient.wellness_family_notified_at,
      team_notified_at: patient.wellness_team_notified_at,
    }, input.nowIso, settings.wellness_window_hours);
    if (decision === "escalate_family") {
      const sms = await deliverSms(input.env, patient.wellness_family_phone, input.fetchImpl);
      if (sms.delivered) {
        await store.updatePatient(patient.id, { wellness_family_notified_at: input.nowIso });
      }
      escalations.push({ external_id: patient.external_id, step: "family", sms: sms.reason });
    } else if (decision === "escalate_care_team" && !patient.wellness_team_notified_at) {
      const staff = await store.getStaff(actor.staffId);
      const sms = await deliverSms(input.env, staff?.phone, input.fetchImpl);
      await store.updatePatient(patient.id, { wellness_team_notified_at: input.nowIso });
      escalations.push({ external_id: patient.external_id, step: "care_team", sms: sms.reason });
    }
  }
  return { ok: true as const, data: { escalations, sms_body: WELLNESS_SMS } };
}

export async function wellnessSmsReply(
  store: ClinicStore,
  input: { phone: string; body: string; at: string },
) {
  if (!isWellnessOkReply(input.body)) return { ok: true as const, data: { matched: false } };
  const patient = await store.findByWellnessPhone(input.phone);
  if (!patient) return { ok: true as const, data: { matched: false } };
  await store.updatePatient(patient.id, {
    wellness_last_ok: input.at,
    wellness_family_notified_at: null,
    wellness_team_notified_at: null,
  });
  return { ok: true as const, data: { matched: true } };
}

export async function recordCognitive(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; score: number; on: string },
) {
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 5) return fail(400, "brief cognitive score is 0 to 5");
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  const allowed = (actor.kind === "patient" && patient.patient_id === actor.patientId) || (isActiveStaff(actor) && actor.clinicId === patient.clinic_id);
  if (!allowed) return fail(403, "not allowed");
  const saved = await store.addSafety({
    clinic_patient_id: patient.id,
    kind: "cognitive",
    recorded_on: input.on,
    payload: { score: input.score },
  });
  return { ok: true as const, data: { id: saved.id, score: input.score } };
}

export async function recordFalls(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; atRisk: boolean; on: string },
) {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const patient = await store.getPatient(input.clinicPatientId);
  if (!patient || patient.clinic_id !== actor.clinicId) return fail(404, "patient not found");
  const saved = await store.addSafety({
    clinic_patient_id: patient.id,
    kind: "falls",
    recorded_on: input.on,
    payload: { at_risk: input.atRisk },
  });
  return { ok: true as const, data: { id: saved.id, at_risk: input.atRisk } };
}

export async function recordStrain(
  store: ClinicStore,
  actor: Actor,
  input: { clinicPatientId: string; score: number; on: string },
) {
  if (!(actor.kind === "circle" && !actor.revoked && (actor.role === "caregiver" || actor.role === "admin"))) {
    return fail(403, "family caregiver only");
  }
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 10) return fail(400, "strain score is 0 to 10");
  const patient = await patientForActor(store, actor, input.clinicPatientId);
  if ("ok" in patient) return patient;
  const settings = await store.getCareSettings(patient.clinic_id);
  const saved = await store.addSafety({
    clinic_patient_id: patient.id,
    kind: "strain",
    recorded_on: input.on,
    payload: { score: input.score, task_open: input.score >= settings.strain_high_at },
  });
  return { ok: true as const, data: { id: saved.id, task_open: input.score >= settings.strain_high_at } };
}

export async function listConcerns(store: ClinicStore, actor: Actor, clinicPatientId: string) {
  const patient = await store.getPatient(clinicPatientId);
  if (!patient) return fail(404, "patient not found");
  if (!(await detailAllowed(store, actor, patient))) return fail(403, "circle access revoked");
  const messages = await store.listMessages(clinicPatientId);
  return {
    ok: true as const,
    data: {
      items: messages.slice(-20).map((message) => ({
        id: message.id,
        author_role: message.author_role,
        preview: message.body.slice(0, 280),
      })),
    },
  };
}
