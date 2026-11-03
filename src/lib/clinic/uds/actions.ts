/**
 * UDS panel actions. Clinic staff only; import is clinic admin only.
 * Patients and care circle members never see the panel.
 * Logic tested against the measure specs, not certified eCQM software.
 */

import { isActiveStaff, type Actor } from "../logic";
import type { ClinicStore } from "../store";
import {
  calendarYearPeriod,
  isIsoDate,
  type PanelPatient,
  type Period,
} from "./measures";
import type { UdsPanelStore } from "./panel-store";
import { CARE_GAP_UNSUPPORTED, evaluateCareGapPanel, type CareGapSummary } from "./care-gaps";

type Result<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

const fail = (status: number, error: string) => ({ ok: false as const, status, error });

export function parsePeriod(start: string | null, end: string | null, asOf: string): Period | null {
  if (!start && !end) return calendarYearPeriod(Number(asOf.slice(0, 4)));
  if (!start || !end || !isIsoDate(start) || !isIsoDate(end) || start > end) return null;
  return { start, end };
}

/** Clinic admin uploads rows already parsed and validated in the browser. Server validates again. */
export async function importUdsPanel(
  clinicStore: ClinicStore,
  panelStore: UdsPanelStore,
  actor: Actor,
  patients: unknown,
): Promise<Result<{ imported: number }>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const staff = await clinicStore.getStaff(actor.staffId);
  if (!staff || staff.revoked_at || !staff.is_admin || staff.clinic_id !== actor.clinicId) {
    return fail(403, "clinic admin only");
  }
  if (!Array.isArray(patients)) return fail(400, "patients must be a list");
  if (patients.length > 5000) return fail(413, "up to 5000 patients per import");
  const clean: PanelPatient[] = [];
  const seen = new Set<string>();
  for (const raw of patients) {
    const p = sanitize(raw);
    if (!p) return fail(400, "a patient row is not valid");
    if (seen.has(p.patientId)) return fail(400, "duplicate patient id");
    seen.add(p.patientId);
    clean.push(p);
  }
  const imported = await panelStore.replacePanel(actor.clinicId, clean);
  return { ok: true, data: { imported } };
}

function bool(v: unknown): boolean {
  return v === true;
}

function sanitize(raw: unknown): PanelPatient | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const patientId = typeof r.patientId === "string" ? r.patientId.trim() : "";
  const birthDate = typeof r.birthDate === "string" ? r.birthDate : "";
  if (!patientId || patientId.length > 64 || !isIsoDate(birthDate)) return null;
  const sex = r.sex === "female" || r.sex === "male" || r.sex === "other" ? r.sex : "unknown";
  const bp = Array.isArray(r.bp) ? r.bp : [];
  const a1c = Array.isArray(r.a1c) ? r.a1c : [];
  const visits = Array.isArray(r.visitDates) ? r.visitDates : [];
  const cleanBp = [];
  for (const x of bp.slice(0, 200)) {
    const b = x as Record<string, unknown>;
    if (typeof b.date !== "string" || !isIsoDate(b.date)) return null;
    const s = Number(b.systolic); const d = Number(b.diastolic);
    if (!Number.isFinite(s) || !Number.isFinite(d) || s < 50 || s > 300 || d < 20 || d > 200) return null;
    cleanBp.push({ date: b.date, systolic: s, diastolic: d, source: "csv" as const });
  }
  const cleanA1c = [];
  for (const x of a1c.slice(0, 200)) {
    const a = x as Record<string, unknown>;
    if (typeof a.date !== "string" || !isIsoDate(a.date)) return null;
    const v = Number(a.value);
    if (!Number.isFinite(v) || v < 3 || v > 20) return null;
    cleanA1c.push({ date: a.date, value: v, source: "csv" as const });
  }
  const visitDates = visits.filter((v): v is string => typeof v === "string" && isIsoDate(v)).slice(0, 400);
  const onset = typeof r.hypertensionOnset === "string" && isIsoDate(r.hypertensionOnset) ? r.hypertensionOnset : null;
  return {
    patientId,
    birthDate,
    sex,
    hypertension: bool(r.hypertension),
    hypertensionOnset: onset,
    diabetes: bool(r.diabetes),
    bp: cleanBp,
    a1c: cleanA1c,
    visitDates,
    hospice: bool(r.hospice),
    palliativeCare: bool(r.palliativeCare),
    frailty: bool(r.frailty),
    advancedIllness: bool(r.advancedIllness),
    longTermCare: bool(r.longTermCare),
    esrd: bool(r.esrd),
    dialysis: bool(r.dialysis),
    kidneyTransplant: bool(r.kidneyTransplant),
    pregnancy: bool(r.pregnancy),
    sexAtBirth: r.sexAtBirth === "female" || r.sexAtBirth === "male" ? r.sexAtBirth : null,
    mammograms: dates(r.mammograms),
    colorectalScreens: typedList(r.colorectalScreens, COLORECTAL_TYPES) as PanelPatient["colorectalScreens"],
    cervicalScreens: typedList(r.cervicalScreens, CERVICAL_TYPES) as PanelPatient["cervicalScreens"],
    phqResults: (Array.isArray(r.phqResults) ? r.phqResults : []).slice(0, 200).flatMap((x) => {
      const q = x as Record<string, unknown>;
      const tool = q.tool === "phq2" || q.tool === "phq9" ? q.tool : null;
      const score = Number(q.score);
      if (!tool || typeof q.date !== "string" || !isIsoDate(q.date) || !Number.isInteger(score) || score < 0 || score > (tool === "phq2" ? 6 : 27)) return [];
      return [{ date: q.date, tool, score }];
    }),
    depressionFollowUps: dates(r.depressionFollowUps),
    tobaccoScreens: (Array.isArray(r.tobaccoScreens) ? r.tobaccoScreens : []).slice(0, 200).flatMap((x) => {
      const t = x as Record<string, unknown>;
      if (typeof t.date !== "string" || !isIsoDate(t.date) || typeof t.user !== "boolean") return [];
      return [{ date: t.date, user: t.user }];
    }),
    tobaccoInterventions: dates(r.tobaccoInterventions),
    ascvd: bool(r.ascvd),
    ldl190OrFh: bool(r.ldl190OrFh),
    ascvdRisk20: bool(r.ascvdRisk20),
    statin: bool(r.statin),
    bilateralMastectomy: bool(r.bilateralMastectomy),
    hysterectomy: bool(r.hysterectomy),
    colorectalCancer: bool(r.colorectalCancer),
    totalColectomy: bool(r.totalColectomy),
    bipolar: bool(r.bipolar),
    depressionScreenException: bool(r.depressionScreenException),
    breastfeeding: bool(r.breastfeeding),
    rhabdomyolysis: bool(r.rhabdomyolysis),
    statinException: bool(r.statinException),
  };
}

const COLORECTAL_TYPES = new Set(["colonoscopy", "fit", "fit_dna", "ct_colonography", "flex_sig"]);
const CERVICAL_TYPES = new Set(["cytology", "hpv", "cotest"]);

function dates(v: unknown): string[] {
  return (Array.isArray(v) ? v : []).filter((d): d is string => typeof d === "string" && isIsoDate(d)).slice(0, 200);
}

function typedList(v: unknown, allowed: Set<string>): { date: string; type: string }[] {
  return (Array.isArray(v) ? v : []).slice(0, 200).flatMap((x) => {
    const t = x as Record<string, unknown>;
    if (typeof t.date !== "string" || !isIsoDate(t.date) || typeof t.type !== "string" || !allowed.has(t.type)) return [];
    return [{ date: t.date, type: t.type }];
  });
}

/**
 * Merge readings from CareIQ app users linked to this clinic. A clinic patient row
 * links to an imported panel row when its external_id matches the panel patient id.
 * Home BP readings and the last BP and A1C on the clinic patient row are added.
 */
export async function mergeAppReadings(
  clinicStore: ClinicStore,
  clinicId: string,
  panel: PanelPatient[],
): Promise<(PanelPatient & { source: "csv" | "csv+app" })[]> {
  const linked = await clinicStore.listPatients(clinicId);
  const byExternal = new Map(linked.filter((p) => p.clinic_id === clinicId).map((p) => [p.external_id, p]));
  const out: (PanelPatient & { source: "csv" | "csv+app" })[] = [];
  for (const p of panel) {
    const row = byExternal.get(p.patientId);
    if (!row) { out.push({ ...p, source: "csv" }); continue; }
    const bp = [...p.bp];
    const a1c = [...p.a1c];
    const readings = await clinicStore.listReadings(row.id);
    for (const r of readings) {
      if (r.kind === "bp" && r.systolic != null && r.diastolic != null && isIsoDate(r.recorded_on)) {
        bp.push({ date: r.recorded_on, systolic: r.systolic, diastolic: r.diastolic, source: "app" });
      }
    }
    if (row.bp_systolic != null && row.bp_diastolic != null && row.last_bp_date && isIsoDate(row.last_bp_date)) {
      bp.push({ date: row.last_bp_date, systolic: row.bp_systolic, diastolic: row.bp_diastolic, source: "app" });
    }
    if (row.last_a1c != null && row.last_a1c_date && isIsoDate(row.last_a1c_date)) {
      a1c.push({ date: row.last_a1c_date, value: Number(row.last_a1c), source: "app" });
    }
    const added = bp.length > p.bp.length || a1c.length > p.a1c.length;
    out.push({ ...p, bp, a1c, source: added ? "csv+app" : "csv" });
  }
  return out;
}

export async function viewUdsPanel(
  clinicStore: ClinicStore,
  panelStore: UdsPanelStore,
  actor: Actor,
  period: Period,
): Promise<Result<CareGapSummary & { unsupported_exclusions: string[] }>> {
  if (!isActiveStaff(actor)) return fail(403, "clinic staff only");
  const panel = await panelStore.listPanel(actor.clinicId);
  const merged = await mergeAppReadings(clinicStore, actor.clinicId, panel);
  return { ok: true, data: { ...evaluateCareGapPanel(merged, period), unsupported_exclusions: CARE_GAP_UNSUPPORTED } };
}
