import type { CircleRole, CsvPatient, HomeReading, StaffRole, Thresholds } from "./logic";
import { DEFAULT_THRESHOLDS } from "./logic";

export interface ClinicRecord {
  id: string;
  name: string;
}

export interface StaffRecord {
  id: string;
  clinic_id: string;
  role: StaffRole;
  display_name: string;
  phone: string | null;
  revoked_at: string | null;
}

export interface PatientRecord {
  id: string;
  clinic_id: string;
  patient_id: string | null;
  external_id: string;
  age: number | null;
  has_diabetes: boolean;
  has_hypertension: boolean;
  last_a1c: number | null;
  last_a1c_date: string | null;
  bp_systolic: number | null;
  bp_diastolic: number | null;
  last_bp_date: string | null;
  next_visit_date: string | null;
}

export interface MemberRecord {
  id: string;
  clinic_patient_id: string;
  role: CircleRole;
  display_name: string;
  staff_id: string | null;
  revoked_at: string | null;
}

export interface ReadingRecord extends HomeReading {
  id: string;
  clinic_patient_id: string;
}

export interface AlertRecord {
  id: string;
  clinic_patient_id: string;
  metric: string;
  value_text: string;
  created_on: string;
}

export interface MessageRecord {
  id: string;
  clinic_patient_id: string;
  author_role: string;
  body: string;
  created_on: string;
}

export interface CheckinRecord {
  id: string;
  clinic_patient_id: string;
  kind: "medication" | "appointment";
  status: "missed" | "completed";
  occurred_on: string;
}

export interface OutreachRecord {
  id: string;
  clinic_id: string;
  clinic_patient_id: string;
  staff_role: StaffRole;
  outcome: "contacted" | "scheduled" | "closed" | "no_answer" | "declined";
  created_on: string;
}

export interface MinuteRecord {
  clinic_patient_id: string;
  month: string;
  minutes: number;
}

export interface ScreenRecord {
  id: string;
  clinic_patient_id: string;
  instrument: "phq2" | "phq9";
  score: number;
  follow_up: boolean;
  recorded_on: string;
}

export interface ClinicStore {
  createClinic(name: string): Promise<ClinicRecord>;
  addStaff(clinicId: string, role: StaffRole, displayName: string, phone?: string | null): Promise<StaffRecord>;
  getStaff(staffId: string): Promise<StaffRecord | null>;
  listStaff(clinicId: string): Promise<StaffRecord[]>;
  revokeStaff(staffId: string, at: string): Promise<void>;
  getThresholds(clinicId: string): Promise<Thresholds>;
  setThresholds(clinicId: string, patch: Partial<Thresholds>): Promise<Thresholds>;
  upsertPatients(clinicId: string, rows: CsvPatient[]): Promise<PatientRecord[]>;
  listPatients(clinicId: string): Promise<PatientRecord[]>;
  getPatient(id: string): Promise<PatientRecord | null>;
  addMember(input: Omit<MemberRecord, "id" | "revoked_at">): Promise<MemberRecord>;
  getMember(memberId: string): Promise<MemberRecord | null>;
  revokeMember(memberId: string, at: string): Promise<MemberRecord | null>;
  listMembers(clinicPatientId: string): Promise<MemberRecord[]>;
  addReading(input: Omit<ReadingRecord, "id">): Promise<ReadingRecord>;
  listReadings(clinicPatientId: string): Promise<ReadingRecord[]>;
  addAlert(input: Omit<AlertRecord, "id">): Promise<AlertRecord>;
  listAlerts(clinicPatientId: string): Promise<AlertRecord[]>;
  addMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord>;
  listMessages(clinicPatientId: string): Promise<MessageRecord[]>;
  addCheckin(input: Omit<CheckinRecord, "id">): Promise<CheckinRecord>;
  listCheckins(clinicPatientId: string): Promise<CheckinRecord[]>;
  addOutreach(input: Omit<OutreachRecord, "id">): Promise<OutreachRecord>;
  listOutreach(clinicPatientId: string): Promise<OutreachRecord[]>;
  addMinutes(clinicPatientId: string, month: string, minutes: number): Promise<MinuteRecord>;
  getMinutes(clinicPatientId: string, month: string): Promise<number>;
  addScreen(input: Omit<ScreenRecord, "id">): Promise<ScreenRecord>;
  listScreens(clinicPatientId: string): Promise<ScreenRecord[]>;
  getMeasureTargets(clinicId: string): Promise<Record<string, number>>;
  setMeasureTarget(clinicId: string, measureId: string, target: number): Promise<void>;
}

function id(): string {
  return crypto.randomUUID();
}

export class MemoryClinicStore implements ClinicStore {
  clinics: ClinicRecord[] = [];
  staff: StaffRecord[] = [];
  thresholds = new Map<string, Thresholds>();
  patients: PatientRecord[] = [];
  members: MemberRecord[] = [];
  readings: ReadingRecord[] = [];
  alerts: AlertRecord[] = [];
  messages: MessageRecord[] = [];
  checkins: CheckinRecord[] = [];
  outreach: OutreachRecord[] = [];
  minutes: MinuteRecord[] = [];
  screens: ScreenRecord[] = [];
  measureTargets = new Map<string, Record<string, number>>();

  async createClinic(name: string): Promise<ClinicRecord> {
    const row = { id: id(), name: name.slice(0, 120) };
    this.clinics.push(row);
    this.thresholds.set(row.id, { ...DEFAULT_THRESHOLDS });
    return row;
  }

  async addStaff(clinicId: string, role: StaffRole, displayName: string, phone?: string | null): Promise<StaffRecord> {
    const row: StaffRecord = {
      id: id(),
      clinic_id: clinicId,
      role,
      display_name: displayName.slice(0, 80),
      phone: phone || null,
      revoked_at: null,
    };
    this.staff.push(row);
    return row;
  }

  async getStaff(staffId: string): Promise<StaffRecord | null> {
    return this.staff.find((row) => row.id === staffId) || null;
  }

  async listStaff(clinicId: string): Promise<StaffRecord[]> {
    return this.staff.filter((row) => row.clinic_id === clinicId);
  }

  async revokeStaff(staffId: string, at: string): Promise<void> {
    const row = this.staff.find((item) => item.id === staffId);
    if (row) row.revoked_at = at;
    for (const member of this.members) {
      if (member.staff_id === staffId && !member.revoked_at) member.revoked_at = at;
    }
  }

  async getThresholds(clinicId: string): Promise<Thresholds> {
    return { ...(this.thresholds.get(clinicId) || DEFAULT_THRESHOLDS) };
  }

  async setThresholds(clinicId: string, patch: Partial<Thresholds>): Promise<Thresholds> {
    const next = { ...(await this.getThresholds(clinicId)), ...patch };
    this.thresholds.set(clinicId, next);
    return next;
  }

  async upsertPatients(clinicId: string, rows: CsvPatient[]): Promise<PatientRecord[]> {
    const saved: PatientRecord[] = [];
    for (const row of rows) {
      let existing = this.patients.find((item) => item.clinic_id === clinicId && item.external_id === row.external_id);
      if (!existing) {
        existing = {
          id: id(),
          clinic_id: clinicId,
          patient_id: row.patient_id,
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
        this.patients.push(existing);
      } else {
        existing.age = row.age;
        existing.has_diabetes = row.has_diabetes;
        existing.has_hypertension = row.has_hypertension;
        existing.last_a1c = row.last_a1c;
        existing.last_a1c_date = row.last_a1c_date;
        existing.bp_systolic = row.bp_systolic;
        existing.bp_diastolic = row.bp_diastolic;
        existing.last_bp_date = row.last_bp_date;
        existing.next_visit_date = row.next_visit_date;
        if (row.patient_id) existing.patient_id = row.patient_id;
      }
      saved.push(existing);
    }
    return saved;
  }

  async listPatients(clinicId: string): Promise<PatientRecord[]> {
    return this.patients.filter((row) => row.clinic_id === clinicId);
  }

  async getPatient(patientRowId: string): Promise<PatientRecord | null> {
    return this.patients.find((row) => row.id === patientRowId) || null;
  }

  async getMember(memberId: string): Promise<MemberRecord | null> {
    return this.members.find((row) => row.id === memberId) || null;
  }

  async addMember(input: Omit<MemberRecord, "id" | "revoked_at">): Promise<MemberRecord> {
    const existing = this.members.find((row) =>
      row.clinic_patient_id === input.clinic_patient_id &&
      row.role === input.role &&
      row.display_name.toLowerCase() === input.display_name.toLowerCase() &&
      !row.revoked_at,
    );
    if (existing) return existing;
    const row: MemberRecord = { ...input, id: id(), revoked_at: null };
    this.members.push(row);
    return row;
  }

  async revokeMember(memberId: string, at: string): Promise<MemberRecord | null> {
    const row = this.members.find((item) => item.id === memberId);
    if (!row) return null;
    row.revoked_at = at;
    return row;
  }

  async listMembers(clinicPatientId: string): Promise<MemberRecord[]> {
    return this.members.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addReading(input: Omit<ReadingRecord, "id">): Promise<ReadingRecord> {
    const row = { ...input, id: id() };
    this.readings.push(row);
    return row;
  }

  async listReadings(clinicPatientId: string): Promise<ReadingRecord[]> {
    return this.readings.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addAlert(input: Omit<AlertRecord, "id">): Promise<AlertRecord> {
    const row = { ...input, id: id() };
    this.alerts.push(row);
    return row;
  }

  async listAlerts(clinicPatientId: string): Promise<AlertRecord[]> {
    return this.alerts.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addMessage(input: Omit<MessageRecord, "id">): Promise<MessageRecord> {
    const row = { ...input, id: id(), body: input.body.slice(0, 500) };
    this.messages.push(row);
    return row;
  }

  async listMessages(clinicPatientId: string): Promise<MessageRecord[]> {
    return this.messages.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addCheckin(input: Omit<CheckinRecord, "id">): Promise<CheckinRecord> {
    const row = { ...input, id: id() };
    this.checkins.push(row);
    return row;
  }

  async listCheckins(clinicPatientId: string): Promise<CheckinRecord[]> {
    return this.checkins.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addOutreach(input: Omit<OutreachRecord, "id">): Promise<OutreachRecord> {
    const row = { ...input, id: id() };
    this.outreach.push(row);
    return row;
  }

  async listOutreach(clinicPatientId: string): Promise<OutreachRecord[]> {
    return this.outreach.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async addMinutes(clinicPatientId: string, month: string, minutes: number): Promise<MinuteRecord> {
    const found = this.minutes.find((row) => row.clinic_patient_id === clinicPatientId && row.month === month);
    if (found) {
      found.minutes += minutes;
      return found;
    }
    const row = { clinic_patient_id: clinicPatientId, month, minutes };
    this.minutes.push(row);
    return row;
  }

  async getMinutes(clinicPatientId: string, month: string): Promise<number> {
    return this.minutes.find((row) => row.clinic_patient_id === clinicPatientId && row.month === month)?.minutes || 0;
  }

  async addScreen(input: Omit<ScreenRecord, "id">): Promise<ScreenRecord> {
    const row = { ...input, id: id() };
    this.screens.push(row);
    return row;
  }

  async listScreens(clinicPatientId: string): Promise<ScreenRecord[]> {
    return this.screens.filter((row) => row.clinic_patient_id === clinicPatientId);
  }

  async getMeasureTargets(clinicId: string): Promise<Record<string, number>> {
    return { ...(this.measureTargets.get(clinicId) || {}) };
  }

  async setMeasureTarget(clinicId: string, measureId: string, target: number): Promise<void> {
    const current = await this.getMeasureTargets(clinicId);
    current[measureId] = target;
    this.measureTargets.set(clinicId, current);
  }
}
