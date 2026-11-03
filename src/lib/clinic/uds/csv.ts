/**
 * Browser-safe CSV parsing for the UDS patient panel import.
 * Synthetic or clinic-supplied rows only. No network and no model call.
 * Logic tested against the measure specs, not certified eCQM software.
 */

import { isIsoDate, type A1cResult, type BpReading, type PanelPatient, type PanelRow } from "./measures";

export const MAX_ROWS = 5000;

export type FieldKey =
  | "patient_id"
  | "birth_date"
  | "sex"
  | "diagnosis_codes"
  | "hypertension"
  | "diabetes"
  | "hypertension_onset"
  | "bp_readings"
  | "a1c_results"
  | "visit_dates"
  | "hospice"
  | "palliative_care"
  | "frailty"
  | "advanced_illness"
  | "long_term_care"
  | "esrd"
  | "dialysis"
  | "kidney_transplant"
  | "pregnancy"
  | "sex_at_birth"
  | "mammogram_dates"
  | "colorectal_screenings"
  | "cervical_screenings"
  | "phq_results"
  | "depression_followup_dates"
  | "tobacco_screenings"
  | "tobacco_intervention_dates"
  | "ascvd"
  | "ldl_190_or_fh"
  | "ascvd_risk_20"
  | "statin"
  | "bilateral_mastectomy"
  | "hysterectomy"
  | "colorectal_cancer"
  | "total_colectomy"
  | "bipolar"
  | "depression_screen_exception"
  | "breastfeeding"
  | "rhabdomyolysis"
  | "statin_exception";

export interface FieldSpec {
  key: FieldKey;
  label: string;
  required: boolean;
  help: string;
  aliases: string[];
}

export const FIELDS: FieldSpec[] = [
  { key: "patient_id", label: "Patient ID", required: true, help: "Clinic patient ID or MRN", aliases: ["id", "mrn", "patient", "patientid"] },
  { key: "birth_date", label: "Birth date", required: true, help: "YYYY-MM-DD", aliases: ["dob", "birthdate", "date_of_birth"] },
  { key: "sex", label: "Sex", required: false, help: "female, male, other, or blank", aliases: ["gender"] },
  { key: "diagnosis_codes", label: "Diagnosis codes", required: false, help: "ICD-10 codes separated by ; (I10 hypertension, E10 E11 E13 diabetes)", aliases: ["dx", "dx_codes", "icd10", "diagnoses"] },
  { key: "hypertension", label: "Hypertension flag", required: false, help: "yes or no", aliases: ["htn", "has_hypertension"] },
  { key: "diabetes", label: "Diabetes flag", required: false, help: "yes or no", aliases: ["dm", "has_diabetes"] },
  { key: "hypertension_onset", label: "Hypertension onset date", required: false, help: "YYYY-MM-DD", aliases: ["htn_onset"] },
  { key: "bp_readings", label: "BP readings", required: false, help: "date systolic/diastolic separated by ; e.g. 2026-03-01 132/84", aliases: ["bp", "blood_pressure"] },
  { key: "a1c_results", label: "A1C results", required: false, help: "date value separated by ; e.g. 2026-04-10 7.2", aliases: ["a1c", "hba1c"] },
  { key: "visit_dates", label: "Visit dates", required: false, help: "dates separated by ;", aliases: ["visits", "encounter_dates"] },
  { key: "hospice", label: "Hospice", required: false, help: "yes or no", aliases: [] },
  { key: "palliative_care", label: "Palliative care", required: false, help: "yes or no", aliases: ["palliative"] },
  { key: "frailty", label: "Frailty", required: false, help: "yes or no", aliases: ["frail"] },
  { key: "advanced_illness", label: "Advanced illness", required: false, help: "yes or no", aliases: [] },
  { key: "long_term_care", label: "Long term care", required: false, help: "yes or no (nursing home 90 days or more)", aliases: ["ltc", "nursing_home"] },
  { key: "esrd", label: "ESRD", required: false, help: "yes or no", aliases: [] },
  { key: "dialysis", label: "Dialysis", required: false, help: "yes or no", aliases: [] },
  { key: "kidney_transplant", label: "Kidney transplant", required: false, help: "yes or no", aliases: ["transplant"] },
  { key: "pregnancy", label: "Pregnancy", required: false, help: "yes or no", aliases: ["pregnant"] },
  { key: "sex_at_birth", label: "Sex at birth", required: false, help: "female, male, or blank (falls back to Sex)", aliases: ["birth_sex"] },
  { key: "mammogram_dates", label: "Mammogram dates", required: false, help: "dates separated by ;", aliases: ["mammograms"] },
  { key: "colorectal_screenings", label: "Colorectal screenings", required: false, help: "date type separated by ; types colonoscopy, fit, fit_dna, ct_colonography, flex_sig", aliases: ["crc_screenings"] },
  { key: "cervical_screenings", label: "Cervical screenings", required: false, help: "date type separated by ; types cytology, hpv, cotest", aliases: ["pap_hpv"] },
  { key: "phq_results", label: "PHQ results", required: false, help: "date tool score separated by ; e.g. 2026-03-01 phq9 12", aliases: ["phq"] },
  { key: "depression_followup_dates", label: "Depression follow-up plan dates", required: false, help: "dates separated by ;", aliases: ["depression_followup"] },
  { key: "tobacco_screenings", label: "Tobacco screenings", required: false, help: "date user or date nonuser separated by ;", aliases: ["tobacco"] },
  { key: "tobacco_intervention_dates", label: "Tobacco cessation intervention dates", required: false, help: "dates separated by ;", aliases: ["cessation_dates"] },
  { key: "ascvd", label: "Clinical ASCVD", required: false, help: "yes or no", aliases: [] },
  { key: "ldl_190_or_fh", label: "LDL 190 or more, or familial hypercholesterolemia", required: false, help: "yes or no", aliases: ["ldl190"] },
  { key: "ascvd_risk_20", label: "10-year ASCVD risk 20 percent or more", required: false, help: "yes or no", aliases: [] },
  { key: "statin", label: "Statin active or ordered in period", required: false, help: "yes or no", aliases: ["statin_therapy"] },
  { key: "bilateral_mastectomy", label: "Bilateral mastectomy", required: false, help: "yes or no", aliases: [] },
  { key: "hysterectomy", label: "Hysterectomy, no residual cervix", required: false, help: "yes or no", aliases: [] },
  { key: "colorectal_cancer", label: "Colorectal cancer", required: false, help: "yes or no", aliases: [] },
  { key: "total_colectomy", label: "Total colectomy", required: false, help: "yes or no", aliases: [] },
  { key: "bipolar", label: "Bipolar disorder", required: false, help: "yes or no", aliases: [] },
  { key: "depression_screen_exception", label: "Depression screen exception", required: false, help: "yes or no (patient refused or medical reason)", aliases: [] },
  { key: "breastfeeding", label: "Breastfeeding", required: false, help: "yes or no", aliases: [] },
  { key: "rhabdomyolysis", label: "Rhabdomyolysis", required: false, help: "yes or no", aliases: [] },
  { key: "statin_exception", label: "Statin exception", required: false, help: "yes or no (allergy, muscle symptoms, liver disease, medical reason)", aliases: [] },
];

export type ColumnMapping = Partial<Record<FieldKey, number>>;

export const TEMPLATE_HEADERS = FIELDS.map((f) => f.key);

export function templateCsv(): string {
  const example = [
    "SYN-0001", "1970-05-14", "female", "I10;E11.9", "", "", "", "2026-02-03 148/92;2026-09-12 134/82",
    "2026-03-01 8.1;2026-08-20 9.4", "2026-02-03;2026-09-12", "no", "no", "no", "no", "no", "no", "no", "no", "no",
    "female", "2025-11-10", "2024-06-01 fit_dna", "2023-04-15 cotest", "2026-02-03 phq9 12", "2026-02-04",
    "2026-02-03 user", "2026-02-03", "no", "no", "no", "yes", "no", "no", "no", "no", "no", "no", "no", "no", "no",
  ];
  return `${TEMPLATE_HEADERS.join(",")}\n${example.map(csvCell).join(",")}\n`;
}

/** RFC 4180 style parse: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function norm(h: string): string {
  return h.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map(norm);
  for (const field of FIELDS) {
    const names = [field.key, ...field.aliases];
    const idx = normalized.findIndex((h) => names.includes(h));
    if (idx >= 0) mapping[field.key] = idx;
  }
  return mapping;
}

export interface RowError {
  row: number; // 1-based data row number (header is row 0)
  patientId: string;
  messages: string[];
}

export interface ParseResult {
  patients: PanelPatient[];
  errors: RowError[];
  mappingErrors: string[];
}

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (v === "") return false;
  if (["y", "yes", "true", "1", "x"].includes(v)) return true;
  if (["n", "no", "false", "0"].includes(v)) return false;
  return null;
}

function splitList(raw: string): string[] {
  return raw.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
}

export function codesImply(codes: string[]): { hypertension: boolean; diabetes: boolean } {
  const up = codes.map((c) => c.toUpperCase().replace(/\s/g, ""));
  return {
    hypertension: up.some((c) => c === "I10" || c.startsWith("I10.")),
    diabetes: up.some((c) => /^E(10|11|13)(\.|$)/.test(c)),
  };
}

const BOOL_KEYS: FieldKey[] = [
  "hypertension", "diabetes", "hospice", "palliative_care", "frailty", "advanced_illness", "long_term_care", "esrd",
  "dialysis", "kidney_transplant", "pregnancy", "ascvd", "ldl_190_or_fh", "ascvd_risk_20", "statin",
  "bilateral_mastectomy", "hysterectomy", "colorectal_cancer", "total_colectomy", "bipolar",
  "depression_screen_exception", "breastfeeding", "rhabdomyolysis", "statin_exception",
];

const COLORECTAL = new Set(["colonoscopy", "fit", "fit_dna", "ct_colonography", "flex_sig"]);
const CERVICAL = new Set(["cytology", "hpv", "cotest"]);

const SEX = new Set(["female", "male", "other", "unknown"]);

export function parsePanelCsv(text: string, mapping?: ColumnMapping): ParseResult {
  const table = parseCsvText(text);
  if (table.length === 0) return { patients: [], errors: [], mappingErrors: ["The file is empty."] };
  const headers = table[0];
  const map = mapping || guessMapping(headers);
  const mappingErrors: string[] = [];
  for (const f of FIELDS) {
    if (f.required && map[f.key] === undefined) mappingErrors.push(`Map a column to ${f.label}.`);
  }
  if (map.diagnosis_codes === undefined && map.hypertension === undefined && map.diabetes === undefined) {
    mappingErrors.push("Map diagnosis codes or a hypertension or diabetes flag.");
  }
  if (table.length - 1 > MAX_ROWS) mappingErrors.push(`Up to ${MAX_ROWS} rows per file.`);
  if (mappingErrors.length) return { patients: [], errors: [], mappingErrors };

  const patients: PanelPatient[] = [];
  const errors: RowError[] = [];
  const seen = new Set<string>();
  const get = (cells: string[], key: FieldKey) => {
    const idx = map[key];
    return idx === undefined ? "" : (cells[idx] ?? "").trim();
  };

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const messages: string[] = [];
    const patientId = get(cells, "patient_id");
    if (!patientId) messages.push("Patient ID is required.");
    else if (patientId.length > 64) messages.push("Patient ID is longer than 64 characters.");
    else if (seen.has(patientId)) messages.push("Duplicate patient ID.");
    const birthDate = get(cells, "birth_date");
    if (!isIsoDate(birthDate)) messages.push("Birth date must be YYYY-MM-DD.");
    const sexRaw = get(cells, "sex").toLowerCase();
    const sex = (sexRaw === "f" ? "female" : sexRaw === "m" ? "male" : sexRaw || "unknown") as PanelPatient["sex"];
    if (!SEX.has(sex)) messages.push("Sex must be female, male, other, or blank.");

    const flags: Partial<Record<FieldKey, boolean>> = {};
    for (const key of BOOL_KEYS) {
      const b = parseBool(get(cells, key));
      if (b === null) messages.push(`${FIELDS.find((f) => f.key === key)!.label} must be yes or no.`);
      flags[key] = b === true;
    }
    const implied = codesImply(splitList(get(cells, "diagnosis_codes")));

    const onset = get(cells, "hypertension_onset");
    if (onset && !isIsoDate(onset)) messages.push("Hypertension onset date must be YYYY-MM-DD.");

    const bp: BpReading[] = [];
    for (const item of splitList(get(cells, "bp_readings"))) {
      const m = item.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2,3})\s*\/\s*(\d{2,3})$/);
      if (!m || !isIsoDate(m[1])) { messages.push(`BP reading "${item}" must look like 2026-03-01 132/84.`); continue; }
      const s = Number(m[2]); const d = Number(m[3]);
      if (s < 50 || s > 300 || d < 20 || d > 200 || d >= s) { messages.push(`BP reading "${item}" is out of range.`); continue; }
      bp.push({ date: m[1], systolic: s, diastolic: d, source: "csv" });
    }
    const a1c: A1cResult[] = [];
    for (const item of splitList(get(cells, "a1c_results"))) {
      const m = item.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}(?:\.\d{1,2})?)%?$/);
      if (!m || !isIsoDate(m[1])) { messages.push(`A1C result "${item}" must look like 2026-04-10 7.2.`); continue; }
      const v = Number(m[2]);
      if (v < 3 || v > 20) { messages.push(`A1C result "${item}" is out of range.`); continue; }
      a1c.push({ date: m[1], value: v, source: "csv" });
    }
    const visitDates: string[] = [];
    for (const item of splitList(get(cells, "visit_dates"))) {
      if (!isIsoDate(item)) messages.push(`Visit date "${item}" must be YYYY-MM-DD.`);
      else visitDates.push(item);
    }

    const sabRaw = get(cells, "sex_at_birth").toLowerCase();
    const sexAtBirth = sabRaw === "f" || sabRaw === "female" ? "female" : sabRaw === "m" || sabRaw === "male" ? "male" : null;
    if (sabRaw && !sexAtBirth) messages.push("Sex at birth must be female, male, or blank.");
    const dateList = (key: FieldKey, label: string) => {
      const out: string[] = [];
      for (const item of splitList(get(cells, key))) {
        if (!isIsoDate(item)) messages.push(`${label} "${item}" must be YYYY-MM-DD.`);
        else out.push(item);
      }
      return out;
    };
    const mammograms = dateList("mammogram_dates", "Mammogram date");
    const depressionFollowUps = dateList("depression_followup_dates", "Depression follow-up date");
    const tobaccoInterventions = dateList("tobacco_intervention_dates", "Tobacco intervention date");
    const typed = (key: FieldKey, allowed: Set<string>, label: string) => {
      const out: { date: string; type: string }[] = [];
      for (const item of splitList(get(cells, key))) {
        const m = item.match(/^(\d{4}-\d{2}-\d{2})\s+([a-z_]+)$/i);
        if (!m || !isIsoDate(m[1]) || !allowed.has(m[2].toLowerCase())) {
          messages.push(`${label} "${item}" must look like 2026-03-01 ${[...allowed][0]}.`);
          continue;
        }
        out.push({ date: m[1], type: m[2].toLowerCase() });
      }
      return out;
    };
    const colorectalScreens = typed("colorectal_screenings", COLORECTAL, "Colorectal screening") as PanelPatient["colorectalScreens"];
    const cervicalScreens = typed("cervical_screenings", CERVICAL, "Cervical screening") as PanelPatient["cervicalScreens"];
    const phqResults: NonNullable<PanelPatient["phqResults"]> = [];
    for (const item of splitList(get(cells, "phq_results"))) {
      const m = item.match(/^(\d{4}-\d{2}-\d{2})\s+(phq2|phq9)\s+(\d{1,2})$/i);
      const tool = m ? (m[2].toLowerCase() as "phq2" | "phq9") : "phq9";
      const score = m ? Number(m[3]) : -1;
      if (!m || !isIsoDate(m[1]) || score > (tool === "phq2" ? 6 : 27)) {
        messages.push(`PHQ result "${item}" must look like 2026-03-01 phq9 12 (PHQ-2 0 to 6, PHQ-9 0 to 27).`);
        continue;
      }
      phqResults.push({ date: m[1], tool, score });
    }
    const tobaccoScreens: NonNullable<PanelPatient["tobaccoScreens"]> = [];
    for (const item of splitList(get(cells, "tobacco_screenings"))) {
      const m = item.match(/^(\d{4}-\d{2}-\d{2})\s+(user|nonuser|non_user)$/i);
      if (!m || !isIsoDate(m[1])) { messages.push(`Tobacco screening "${item}" must look like 2026-03-01 user or 2026-03-01 nonuser.`); continue; }
      tobaccoScreens.push({ date: m[1], user: m[2].toLowerCase() === "user" });
    }

    if (messages.length) { errors.push({ row: r, patientId, messages }); continue; }
    seen.add(patientId);
    patients.push({
      patientId,
      birthDate,
      sex,
      hypertension: flags.hypertension || implied.hypertension,
      hypertensionOnset: onset || null,
      diabetes: flags.diabetes || implied.diabetes,
      bp,
      a1c,
      visitDates,
      hospice: flags.hospice,
      palliativeCare: flags.palliative_care,
      frailty: flags.frailty,
      advancedIllness: flags.advanced_illness,
      longTermCare: flags.long_term_care,
      esrd: flags.esrd,
      dialysis: flags.dialysis,
      kidneyTransplant: flags.kidney_transplant,
      pregnancy: flags.pregnancy,
      sexAtBirth,
      mammograms,
      colorectalScreens,
      cervicalScreens,
      phqResults,
      depressionFollowUps,
      tobaccoScreens,
      tobaccoInterventions,
      ascvd: flags.ascvd,
      ldl190OrFh: flags.ldl_190_or_fh,
      ascvdRisk20: flags.ascvd_risk_20,
      statin: flags.statin,
      bilateralMastectomy: flags.bilateral_mastectomy,
      hysterectomy: flags.hysterectomy,
      colorectalCancer: flags.colorectal_cancer,
      totalColectomy: flags.total_colectomy,
      bipolar: flags.bipolar,
      depressionScreenException: flags.depression_screen_exception,
      breastfeeding: flags.breastfeeding,
      rhabdomyolysis: flags.rhabdomyolysis,
      statinException: flags.statin_exception,
    });
  }
  return { patients, errors, mappingErrors };
}

export function csvCell(value: string | number | null | undefined): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Neutralize spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const STATUS_TEXT: Record<string, string> = {
  controlled: "controlled",
  not_controlled: "not controlled",
  missing_reading: "missing reading",
  excluded: "excluded",
  not_in_denominator: "",
  met: "met",
  due: "due",
};

export function gapListCsv(rows: (PanelRow & { gapsDue?: string[] })[]): string {
  const header = ["patient_id", "age", "gaps_due", "cms165_status", "last_bp_date", "last_bp", "cms122_status", "last_a1c_date", "last_a1c"];
  const lines = [header.join(",")];
  for (const row of rows.filter((r) => r.needsOutreach)) {
    const bp = row.cms165.latest as BpReading | null;
    const a = row.cms122.latest as A1cResult | null;
    lines.push([
      row.patientId,
      row.age,
      (row.gapsDue || []).join("; "),
      STATUS_TEXT[row.cms165.status],
      bp?.date ?? "",
      bp ? `${bp.systolic}/${bp.diastolic}` : "",
      STATUS_TEXT[row.cms122.status],
      a?.date ?? "",
      a?.value ?? "",
    ].map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
