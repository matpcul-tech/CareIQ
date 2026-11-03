/**
 * Health history form state, browser safe. The form opens with the patient's saved
 * answers so a save never blanks anything by accident. A saved answer is cleared only
 * when the person removes it (Remove button, unchecking a condition, or emptying a
 * prefilled field), and those removals are sent as an explicit clear list.
 */

export const MEPA_KEYS = [
  "oliveOilPerDay", "leafyVegetablesPerWeek", "otherVegetablesPerDay", "berriesPerWeek",
  "otherFruitPerDay", "redMeatPerWeek", "fishPerWeek", "chickenPerWeek", "cheesePerWeek",
  "butterPerWeek", "beansPerWeek", "wholeGrainsPerDay", "sweetsPerWeek", "nutsPerWeek",
  "fastFoodPerWeek", "alcoholPerDay",
] as const;

export const LE8_SCALAR_KEYS = [
  "moderateMinutesPerWeek", "vigorousMinutesPerWeek", "nicotine", "livesWithIndoorSmoker",
  "sleepHours", "lipidTreated", "bpTreated",
] as const;

export const CLEARABLE_KEYS = [...LE8_SCALAR_KEYS, ...MEPA_KEYS.map((k) => `mepa.${k}` as const)] as const;
export type ClearableKey = (typeof CLEARABLE_KEYS)[number];

/** Only the fields the form edits. Built on the server from the decrypted record. */
export interface SavedHistory {
  chronicConditions: string[];
  medications: string;
  allergies: string;
  familyHistory: string;
  le8: {
    moderateMinutesPerWeek?: number;
    vigorousMinutesPerWeek?: number;
    nicotine?: string;
    livesWithIndoorSmoker?: boolean;
    sleepHours?: number;
    lipidTreated?: boolean;
    bpTreated?: boolean;
    mepa: Record<string, number>;
  };
}

export interface HistoryFormState {
  conditions: string[];
  meds: string;
  allergies: string;
  family: string;
  moderate: string;
  vigorous: string;
  nicotine: string;
  indoor: string;
  sleepHours: string;
  lipidTreated: string;
  bpTreated: string;
  mepa: Record<string, string>;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Picks form fields from a decrypted record. Unknown or malformed values are dropped. */
export function toSavedHistory(record: Record<string, unknown> | null | undefined): SavedHistory | null {
  if (!record || typeof record !== "object") return null;
  const le8 = record.le8 && typeof record.le8 === "object" ? (record.le8 as Record<string, unknown>) : {};
  const rawMepa = le8.mepa && typeof le8.mepa === "object" ? (le8.mepa as Record<string, unknown>) : {};
  const mepa: Record<string, number> = {};
  for (const k of MEPA_KEYS) {
    const v = num(rawMepa[k]);
    if (v !== undefined) mepa[k] = v;
  }
  return {
    chronicConditions: Array.isArray(record.chronicConditions)
      ? record.chronicConditions.filter((c): c is string => typeof c === "string")
      : [],
    medications: str(record.medications),
    allergies: str(record.allergies),
    familyHistory: str(record.familyHistory),
    le8: {
      moderateMinutesPerWeek: num(le8.moderateMinutesPerWeek),
      vigorousMinutesPerWeek: num(le8.vigorousMinutesPerWeek),
      nicotine: typeof le8.nicotine === "string" ? le8.nicotine : undefined,
      livesWithIndoorSmoker: bool(le8.livesWithIndoorSmoker),
      sleepHours: num(le8.sleepHours),
      lipidTreated: bool(le8.lipidTreated),
      bpTreated: bool(le8.bpTreated),
      mepa,
    },
  };
}

const yn = (v: boolean | undefined) => (v === true ? "yes" : v === false ? "no" : "");
const n2s = (v: number | undefined) => (v === undefined ? "" : String(v));

export function initialFormState(saved: SavedHistory | null): HistoryFormState {
  const l = saved?.le8;
  const mepa: Record<string, string> = {};
  for (const [k, v] of Object.entries(l?.mepa || {})) mepa[k] = String(v);
  return {
    conditions: saved?.chronicConditions ?? [],
    meds: saved?.medications ?? "",
    allergies: saved?.allergies ?? "",
    family: saved?.familyHistory ?? "",
    moderate: n2s(l?.moderateMinutesPerWeek),
    vigorous: n2s(l?.vigorousMinutesPerWeek),
    nicotine: l?.nicotine ?? "",
    indoor: yn(l?.livesWithIndoorSmoker),
    sleepHours: n2s(l?.sleepHours),
    lipidTreated: yn(l?.lipidTreated),
    bpTreated: yn(l?.bpTreated),
    mepa,
  };
}

function toNum(raw: string): number | undefined {
  const t = raw.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
const toBool = (raw: string) => (raw === "yes" ? true : raw === "no" ? false : undefined);

/** Builds the save payload. Saved answers the person emptied are listed in clearLe8. */
export function formToPayload(form: HistoryFormState, saved: SavedHistory | null) {
  const mepa: Record<string, number> = {};
  const clearLe8: ClearableKey[] = [];
  for (const k of MEPA_KEYS) {
    const v = toNum(form.mepa[k] ?? "");
    if (v !== undefined) mepa[k] = v;
    else if (saved?.le8.mepa[k] !== undefined) clearLe8.push(`mepa.${k}`);
  }
  const le8 = {
    mepa: Object.keys(mepa).length > 0 ? mepa : undefined,
    moderateMinutesPerWeek: toNum(form.moderate),
    vigorousMinutesPerWeek: toNum(form.vigorous),
    nicotine: form.nicotine || undefined,
    livesWithIndoorSmoker: toBool(form.indoor),
    sleepHours: toNum(form.sleepHours),
    lipidTreated: toBool(form.lipidTreated),
    bpTreated: toBool(form.bpTreated),
  };
  for (const k of LE8_SCALAR_KEYS) {
    if (le8[k] === undefined && saved?.le8[k] !== undefined) clearLe8.push(k);
  }
  return {
    chronicConditions: form.conditions,
    medications: form.meds,
    allergies: form.allergies,
    familyHistory: form.family,
    le8,
    clearLe8: clearLe8.length > 0 ? clearLe8 : undefined,
  };
}
