import "server-only";

import { getServiceClient } from "@/lib/supabase-server";
import { DEFAULT_THRESHOLDS, type StaffRole, type Thresholds } from "./logic";
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
  StaffRecord,
} from "./store";
import type { CsvPatient } from "./logic";

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

  async createClinic(name: string): Promise<ClinicRecord> {
    const { data, error } = await this.sb().from("clinics").insert({ name }).select("id,name").single();
    if (error || !data) throw new Error(error?.message || "clinic insert failed");
    return { id: data.id, name: data.name };
  }

  async addStaff(clinicId: string, role: StaffRole, displayName: string, phone?: string | null): Promise<StaffRecord> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .insert({ clinic_id: clinicId, role, display_name: displayName, phone: phone || null })
      .select("id,clinic_id,role,display_name,phone,revoked_at")
      .single();
    if (error || !data) throw new Error(error?.message || "staff insert failed");
    return {
      id: data.id,
      clinic_id: data.clinic_id,
      role: data.role,
      display_name: data.display_name,
      phone: data.phone,
      revoked_at: data.revoked_at,
    };
  }

  async getStaff(staffId: string): Promise<StaffRecord | null> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .select("id,clinic_id,role,display_name,phone,revoked_at")
      .eq("id", staffId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      id: data.id,
      clinic_id: data.clinic_id,
      role: data.role,
      display_name: data.display_name,
      phone: data.phone,
      revoked_at: data.revoked_at,
    };
  }

  async listStaff(clinicId: string): Promise<StaffRecord[]> {
    const { data, error } = await this.sb()
      .from("clinic_staff")
      .select("id,clinic_id,role,display_name,phone,revoked_at")
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
    return (data || []).map((row) => ({
      id: row.id,
      clinic_id: row.clinic_id,
      role: row.role,
      display_name: row.display_name,
      phone: row.phone,
      revoked_at: row.revoked_at,
    }));
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
