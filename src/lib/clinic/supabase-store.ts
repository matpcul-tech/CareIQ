import "server-only";

import { getServiceClient } from "@/lib/supabase-server";
import { DEFAULT_THRESHOLDS, type CsvPatient, type StaffRole, type Thresholds } from "./logic";
import { toE164 } from "./phone";
import { DEFAULT_CARE_SETTINGS, type CareSettings } from "./safety";
import type {
  AlertRecord,
  CheckinRecord,
  ClinicRecord,
  ClinicStore,
  MemberRecord,
  MessageRecord,
  MinuteRecord,
  OutreachRecord,
  PatientRecord,
  ReadingRecord,
  SafetyEvent,
  ScreenRecord,
  StaffInsertExtras,
  StaffRecord,
} from "./store";

type Row = Record<string, unknown>;

function day(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.slice(0, 10);
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function patientFrom(row: Row): PatientRecord {
  return {
    id: String(row.id),
    clinic_id: String(row.clinic_id),
    patient_id: row.patient_id ? String(row.patient_id) : null,
    external_id: String(row.external_id),
    age: num(row.age),
    has_diabetes: Boolean(row.has_diabetes),
    has_hypertension: Boolean(row.has_hypertension),
    last_a1c: num(row.last_a1c),
    last_a1c_date: day(row.last_a1c_date),
    bp_systolic: num(row.bp_systolic),
    bp_diastolic: num(row.bp_diastolic),
    last_bp_date: day(row.last_bp_date),
    next_visit_date: day(row.next_visit_date),
    sex: row.sex === "female" || row.sex === "male" ? row.sex : null,
    cost_barrier: Boolean(row.cost_barrier),
    transport_barrier: Boolean(row.transport_barrier),
    lives_alone: Boolean(row.lives_alone),
    wellness_opt_in: Boolean(row.wellness_opt_in),
    wellness_phone: row.wellness_phone ? String(row.wellness_phone) : null,
    wellness_family_phone: row.wellness_family_phone ? String(row.wellness_family_phone) : null,
    wellness_last_ok: row.wellness_last_ok ? String(row.wellness_last_ok) : null,
    wellness_family_notified_at: row.wellness_family_notified_at ? String(row.wellness_family_notified_at) : null,
    wellness_family_delivery: row.wellness_family_delivery ? String(row.wellness_family_delivery) : null,
    wellness_team_notified_at: row.wellness_team_notified_at ? String(row.wellness_team_notified_at) : null,
  };
}

const STAFF_COLUMNS = "id,clinic_id,role,display_name,phone,revoked_at,email_hash,auth_user_id,is_admin";

function staffFrom(row: Row): StaffRecord {
  const role = String(row.role);
  if (role !== "provider" && role !== "ma" && role !== "chw" && role !== "care_manager" && role !== "front_desk") {
    throw new Error("staff role is not recognized");
  }
  return {
    id: String(row.id),
    clinic_id: String(row.clinic_id),
    role: role as StaffRole,
    display_name: String(row.display_name),
    phone: row.phone ? String(row.phone) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
    email_hash: row.email_hash ? String(row.email_hash) : null,
    auth_user_id: row.auth_user_id ? String(row.auth_user_id) : null,
    is_admin: row.is_admin === true,
  };
}

function memberFrom(row: Row): MemberRecord {
  return {
    id: String(row.id),
    clinic_patient_id: String(row.clinic_patient_id),
    role: row.role as MemberRecord["role"],
    display_name: String(row.display_name),
    staff_id: row.staff_id ? String(row.staff_id) : null,
    revoked_at: row.revoked_at ? String(row.revoked_at) : null,
  };
}

export class SupabaseClinicStore implements ClinicStore {
  private sb() {
    return getServiceClient();
  }

  async getClinic(clinicId: string): Promise<ClinicRecord | null> {
    const withTz = await this.sb().from("clinics").select("id,name,time_zone").eq("id", clinicId).maybeSingle();
    if (!withTz.error) {
      const d = withTz.data as { id: string; name: string | null; time_zone: string | null } | null;
      return d ? { id: d.id, name: d.name ?? "", time_zone: d.time_zone ?? undefined } : null;
    }
    // Before migration 0017 the column does not exist (Postgres 42703). Fall back to the name only.
    if (withTz.error.code !== "42703" && !/time_zone/.test(withTz.error.message)) throw new Error(withTz.error.message);
    const { data, error } = await this.sb().from("clinics").select("id,name").eq("id", clinicId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { id: data.id, name: data.name ?? "" } : null;
  }

  async setClinicTimeZone(clinicId: string, timeZone: string): Promise<void> {
    const { error } = await this.sb().from("clinics").update({ time_zone: timeZone }).eq("id", clinicId);
    if (error) throw new Error(error.message);
  }

  async createClinic(name: string): Promise<ClinicRecord> {
    const { data, error } = await this.sb().from("clinics").insert({ name }).select("id,name").single();
    if (error || !data) throw new Error(error?.message || "clinic insert failed");
    return { id: data.id, name: data.name };
  }

  async addStaff(clinicId: string, role: StaffRole, displayName: string, phone?: string | null, extras?: StaffInsertExtras): Promise<StaffRecord> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .insert({
        clinic_id: clinicId,
        role,
        display_name: displayName,
        phone: toE164(phone),
        email_hash: extras?.email_hash || null,
        auth_user_id: extras?.auth_user_id || null,
        is_admin: extras?.is_admin === true,
      })
      .select(STAFF_COLUMNS)
      .single();
    if (error || !data) throw new Error(error?.message || "staff insert failed");
    return staffFrom(data as Row);
  }

  async getStaff(staffId: string): Promise<StaffRecord | null> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .select(STAFF_COLUMNS)
      .eq("id", staffId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return staffFrom(data as Row);
  }

  async listStaff(clinicId: string): Promise<StaffRecord[]> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .select(STAFF_COLUMNS)
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => staffFrom(row as Row));
  }

  async findStaffByEmailHash(emailHash: string): Promise<StaffRecord | null> {
    if (!emailHash) return null;
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .select(STAFF_COLUMNS)
      .eq("email_hash", emailHash)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return staffFrom(data as Row);
  }

  async bindStaffAuth(staffId: string, authUserId: string): Promise<boolean> {
    const current = await this.getStaff(staffId);
    if (!current || current.revoked_at) return false;
    if (current.auth_user_id && current.auth_user_id !== authUserId) return false;
    if (current.auth_user_id === authUserId) return true;
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .update({ auth_user_id: authUserId })
      .eq("id", staffId)
      .is("auth_user_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    return Boolean(data && data.length > 0);
  }

  async revokeStaff(staffId: string, at: string): Promise<void> {
    const { error } = await this.sb().from("clinic_staff").update({ revoked_at: at }).eq("id", staffId);
    if (error) throw new Error(error.message);
    const { error: memberError } = await this.sb()
      .from("circle_access")
      .update({ revoked_at: at })
      .eq("staff_id", staffId)
      .is("revoked_at", null);
    if (memberError) throw new Error(memberError.message);
  }

  async getThresholds(clinicId: string): Promise<Thresholds> {
    const { data, error } = await this.sb()
      .from("clinic_thresholds")
      .select("metric,value")
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    const next = { ...DEFAULT_THRESHOLDS };
    for (const row of data || []) {
      const key = row.metric as keyof Thresholds;
      if (key in next && row.value != null) next[key] = Number(row.value);
    }
    return next;
  }

  async setThresholds(clinicId: string, patch: Partial<Thresholds>): Promise<Thresholds> {
    const rows = Object.entries(patch).map(([metric, value]) => ({ clinic_id: clinicId, metric, value }));
    if (rows.length > 0) {
      const { error } = await this.sb().from("clinic_thresholds").upsert(rows, { onConflict: "clinic_id,metric" });
      if (error) throw new Error(error.message);
    }
    return this.getThresholds(clinicId);
  }

  async upsertPatients(clinicId: string, rows: CsvPatient[]): Promise<PatientRecord[]> {
    const saved: PatientRecord[] = [];
    for (const row of rows) {
      const payload: Record<string, unknown> = {
        clinic_id: clinicId,
        external_id: row.external_id,
        age: row.age,
        has_diabetes: row.has_diabetes,
        has_hypertension: row.has_hypertension,
        last_a1c: row.last_a1c,
        last_a1c_date: row.last_a1c_date,
        bp_systolic: row.bp_systolic,
        bp_diastolic: row.bp_diastolic,
        last_bp_date: row.last_bp_date,
        next_visit_date: row.next_visit_date,
      };
      if (row.patient_id) payload.patient_id = row.patient_id;
      const { data, error } = await this.sb()
        .from("clinic_patients")
        .upsert(payload, { onConflict: "clinic_id,external_id" })
        .select("*")
        .single();
      if (error || !data) throw new Error(error?.message || "patient upsert failed");
      saved.push(patientFrom(data as Row));
    }
    return saved;
  }

  async listPatients(clinicId: string): Promise<PatientRecord[]> {
    const { data, error } = await this.sb().from("clinic_patients").select("*").eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => patientFrom(row as Row));
  }

  async getPatient(patientRowId: string): Promise<PatientRecord | null> {
    const { data, error } = await this.sb().from("clinic_patients").select("*").eq("id", patientRowId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? patientFrom(data as Row) : null;
  }

  async addMember(input: Omit<MemberRecord, "id" | "revoked_at">): Promise<MemberRecord> {
    const existing = await this.sb()
      .from("circle_access")
      .select("*")
      .eq("clinic_patient_id", input.clinic_patient_id)
      .eq("role", input.role)
      .eq("display_name", input.display_name)
      .is("revoked_at", null)
      .maybeSingle();
    if (existing.data) return memberFrom(existing.data as Row);
    const { data, error } = await this.sb()
      .from("circle_access")
      .insert({
        clinic_patient_id: input.clinic_patient_id,
        role: input.role,
        display_name: input.display_name,
        staff_id: input.staff_id,
      })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "member insert failed");
    return memberFrom(data as Row);
  }

  async getMember(memberId: string): Promise<MemberRecord | null> {
    const { data, error } = await this.sb().from("circle_access").select("*").eq("id", memberId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? memberFrom(data as Row) : null;
  }

  async revokeMember(memberId: string, at: string): Promise<MemberRecord | null> {
    const { data, error } = await this.sb()
      .from("circle_access")
      .update({ revoked_at: at })
      .eq("id", memberId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? memberFrom(data as Row) : null;
  }

  async listMembers(clinicPatientId: string): Promise<MemberRecord[]> {
    const { data, error } = await this.sb().from("circle_access").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => memberFrom(row as Row));
  }

  async addReading(input: Omit<ReadingRecord, "id">): Promise<ReadingRecord> {
    const { data, error } = await this.sb().from("home_readings").insert({
      clinic_patient_id: input.clinic_patient_id,
      kind: input.kind,
      systolic: input.systolic,
      diastolic: input.diastolic,
      glucose: input.glucose,
      recorded_on: input.recorded_on,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "reading insert failed");
    return readingFrom(data as Row);
  }

  async listReadings(clinicPatientId: string): Promise<ReadingRecord[]> {
    const { data, error } = await this.sb().from("home_readings").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => readingFrom(row as Row));
  }

  async addAlert(input: Omit<AlertRecord, "id">): Promise<AlertRecord> {
    const { data, error } = await this.sb().from("circle_alerts").insert(input).select("*").single();
    if (error || !data) throw new Error(error?.message || "alert insert failed");
    return {
      id: data.id,
      clinic_patient_id: data.clinic_patient_id,
      metric: data.metric,
      value_text: data.value_text,
      created_on: day(data.created_on) || input.created_on,
    };
  }

  async listAlerts(clinicPatientId: string): Promise<AlertRecord[]> {
    const { data, error } = await this.sb().from("circle_alerts").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      clinic_patient_id: row.clinic_patient_id,
      metric: row.metric,
      value_text: row.value_text,
      created_on: day(row.created_on) || "",
    }));
  }

  async addMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord> {
    const { data, error } = await this.sb().from("circle_messages").insert({
      clinic_patient_id: input.clinic_patient_id,
      author_role: input.author_role,
      body: input.body.slice(0, 500),
      created_on: input.created_on,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "message insert failed");
    return {
      id: data.id,
      clinic_patient_id: data.clinic_patient_id,
      author_role: data.author_role,
      body: data.body,
      created_on: day(data.created_on) || input.created_on,
    };
  }

  async listMessages(clinicPatientId: string): Promise<MessageRecord[]> {
    const { data, error } = await this.sb().from("circle_messages").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      clinic_patient_id: row.clinic_patient_id,
      author_role: row.author_role,
      body: row.body,
      created_on: day(row.created_on) || "",
    }));
  }

  async addCheckin(input: Omit<CheckinRecord, "id">): Promise<CheckinRecord> {
    const { data, error } = await this.sb().from("circle_checkins").insert({
      clinic_patient_id: input.clinic_patient_id,
      kind: input.kind,
      status: input.status,
      occurred_on: input.occurred_on,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "checkin insert failed");
    return {
      id: data.id,
      clinic_patient_id: data.clinic_patient_id,
      kind: data.kind,
      status: data.status,
      occurred_on: day(data.occurred_on) || input.occurred_on,
    };
  }

  async listCheckins(clinicPatientId: string): Promise<CheckinRecord[]> {
    const { data, error } = await this.sb().from("circle_checkins").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      clinic_patient_id: row.clinic_patient_id,
      kind: row.kind,
      status: row.status,
      occurred_on: day(row.occurred_on) || "",
    }));
  }

  async addOutreach(input: Omit<OutreachRecord, "id">): Promise<OutreachRecord> {
    const { data, error } = await this.sb().from("outreach_log").insert({
      clinic_id: input.clinic_id,
      clinic_patient_id: input.clinic_patient_id,
      staff_role: input.staff_role,
      outcome: input.outcome,
      created_on: input.created_on,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "outreach insert failed");
    return {
      id: data.id,
      clinic_id: data.clinic_id,
      clinic_patient_id: data.clinic_patient_id,
      staff_role: data.staff_role,
      outcome: data.outcome,
      created_on: day(data.created_on) || input.created_on,
    };
  }

  async listOutreach(clinicPatientId: string): Promise<OutreachRecord[]> {
    const { data, error } = await this.sb()
      .from("outreach_log")
      .select("*")
      .eq("clinic_patient_id", clinicPatientId)
      .order("created_on", { ascending: true });
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      clinic_id: row.clinic_id,
      clinic_patient_id: row.clinic_patient_id,
      staff_role: row.staff_role,
      outcome: row.outcome,
      created_on: day(row.created_on) || "",
    }));
  }

  async addMinutes(clinicPatientId: string, month: string, minutes: number): Promise<MinuteRecord> {
    const current = await this.getMinutes(clinicPatientId, month);
    const { data, error } = await this.sb()
      .from("care_minutes")
      .upsert({ clinic_patient_id: clinicPatientId, month, minutes: current + minutes }, { onConflict: "clinic_patient_id,month" })
      .select("*")
      .single();
    if (error || !data) throw new Error(error?.message || "minutes upsert failed");
    return { clinic_patient_id: data.clinic_patient_id, month: data.month, minutes: data.minutes };
  }

  async getMinutes(clinicPatientId: string, month: string): Promise<number> {
    const { data, error } = await this.sb()
      .from("care_minutes")
      .select("minutes")
      .eq("clinic_patient_id", clinicPatientId)
      .eq("month", month)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? Number(data.minutes) : 0;
  }

  async addScreen(input: Omit<ScreenRecord, "id">): Promise<ScreenRecord> {
    const { data, error } = await this.sb().from("circle_screens").insert({
      clinic_patient_id: input.clinic_patient_id,
      instrument: input.instrument,
      score: input.score,
      follow_up: input.follow_up,
      recorded_on: input.recorded_on,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "screen insert failed");
    return screenFrom(data as Row);
  }

  async listScreens(clinicPatientId: string): Promise<ScreenRecord[]> {
    const { data, error } = await this.sb().from("circle_screens").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => screenFrom(row as Row));
  }

  async getMeasureTargets(clinicId: string): Promise<Record<string, number>> {
    const { data, error } = await this.sb()
      .from("clinic_measure_targets")
      .select("measure_id,target")
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    const out: Record<string, number> = {};
    for (const row of data || []) out[row.measure_id] = Number(row.target);
    return out;
  }

  async setMeasureTarget(clinicId: string, measureId: string, target: number): Promise<void> {
    const { error } = await this.sb()
      .from("clinic_measure_targets")
      .upsert({ clinic_id: clinicId, measure_id: measureId, target }, { onConflict: "clinic_id,measure_id" });
    if (error) throw new Error(error.message);
  }

  async updatePatient(patientRowId: string, patch: Partial<PatientRecord>): Promise<PatientRecord | null> {
    const { id: _id, clinic_id: _clinic, external_id: _external, ...rest } = patch;
    if ("wellness_phone" in rest) rest.wellness_phone = toE164(rest.wellness_phone);
    if ("wellness_family_phone" in rest) rest.wellness_family_phone = toE164(rest.wellness_family_phone);
    const { data, error } = await this.sb().from("clinic_patients").update(rest).eq("id", patientRowId).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? patientFrom(data as Row) : null;
  }

  async addSafety(input: Omit<SafetyEvent, "id">): Promise<SafetyEvent> {
    const { data, error } = await this.sb().from("circle_safety_events").insert({
      clinic_patient_id: input.clinic_patient_id,
      kind: input.kind,
      recorded_on: input.recorded_on,
      payload: input.payload,
    }).select("*").single();
    if (error || !data) throw new Error(error?.message || "safety insert failed");
    return safetyFrom(data as Row);
  }

  async getSafety(eventId: string): Promise<SafetyEvent | null> {
    const { data, error } = await this.sb().from("circle_safety_events").select("*").eq("id", eventId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? safetyFrom(data as Row) : null;
  }

  async findByWellnessPhone(phone: string): Promise<PatientRecord | null> {
    const normalized = toE164(phone);
    if (!normalized) return null;
    const { data, error } = await this.sb().from("clinic_patients").select("*").eq("wellness_phone", normalized).eq("wellness_opt_in", true).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? patientFrom(data as Row) : null;
  }

  async claimInboundSid(sid: string): Promise<boolean> {
    const trimmed = sid.trim();
    if (!trimmed) return false;
    const { error } = await this.sb().from("clinic_inbound_messages").insert({ message_sid: trimmed });
    if (!error) return true;
    const code = (error as { code?: string }).code;
    if (code === "23505" || /duplicate key/i.test(error.message)) return false;
    throw new Error(error.message);
  }

  async updateSafety(eventId: string, payload: SafetyEvent["payload"]): Promise<SafetyEvent | null> {
    const existing = await this.sb().from("circle_safety_events").select("payload").eq("id", eventId).maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (!existing.data) return null;
    const merged = { ...(existing.data.payload as SafetyEvent["payload"]), ...payload };
    const { data, error } = await this.sb().from("circle_safety_events").update({ payload: merged }).eq("id", eventId).select("*").maybeSingle();
    if (error) throw new Error(error.message);
    return data ? safetyFrom(data as Row) : null;
  }

  async listSafety(clinicPatientId: string): Promise<SafetyEvent[]> {
    const { data, error } = await this.sb().from("circle_safety_events").select("*").eq("clinic_patient_id", clinicPatientId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => safetyFrom(row as Row));
  }

  async getCareSettings(clinicId: string): Promise<CareSettings> {
    const { data, error } = await this.sb().from("clinic_care_settings").select("*").eq("clinic_id", clinicId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return { ...DEFAULT_CARE_SETTINGS };
    return {
      wellness_window_hours: Number(data.wellness_window_hours),
      cancer_followup_days: Number(data.cancer_followup_days),
      cognitive_interval_days: Number(data.cognitive_interval_days),
      cognitive_concern_at: Number(data.cognitive_concern_at),
      strain_high_at: Number(data.strain_high_at),
    };
  }

  async setCareSettings(clinicId: string, patch: Partial<CareSettings>): Promise<CareSettings> {
    const next = { ...(await this.getCareSettings(clinicId)), ...patch, clinic_id: clinicId };
    const { error } = await this.sb().from("clinic_care_settings").upsert(next, { onConflict: "clinic_id" });
    if (error) throw new Error(error.message);
    return this.getCareSettings(clinicId);
  }
}

function safetyFrom(row: Row): SafetyEvent {
  const payload = (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, string | number | boolean | null>;
  const kind = row.kind === "cognitive" || row.kind === "falls" || row.kind === "strain" ? row.kind : "cancer";
  return {
    id: String(row.id),
    clinic_patient_id: String(row.clinic_patient_id),
    kind,
    recorded_on: day(row.recorded_on) || "",
    payload,
  };
}

function screenFrom(row: Row): ScreenRecord {
  return {
    id: String(row.id),
    clinic_patient_id: String(row.clinic_patient_id),
    instrument: row.instrument === "phq2" ? "phq2" : "phq9",
    score: Number(row.score),
    follow_up: Boolean(row.follow_up),
    recorded_on: day(row.recorded_on) || "",
  };
}

function readingFrom(row: Row): ReadingRecord {
  return {
    id: String(row.id),
    clinic_patient_id: String(row.clinic_patient_id),
    kind: row.kind === "glucose" ? "glucose" : "bp",
    systolic: num(row.systolic),
    diastolic: num(row.diastolic),
    glucose: num(row.glucose),
    recorded_on: day(row.recorded_on) || "",
  };
}
