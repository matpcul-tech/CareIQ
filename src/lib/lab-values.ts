/**
 * Resolve lab values from a decrypted health_history record.
 *
 * /api/onboard/manual-labs stores parsed and typed labs under
 * `biomarkers.<key>` (for example `biomarkers.a1c.value`). Older records
 * kept them under `manualLabs.<camelKey>` as plain numbers. Read
 * `biomarkers` first and fall back to `manualLabs`. Both plain numbers and
 * `{ value }` objects are accepted in either place.
 */

export interface ResolvedLabs {
  a1c?: number;
  ldl?: number;
  hdl?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
  tsh?: number;
  vitaminD?: number;
  totalCholesterol?: number;
  weight?: number;
  height?: number;
}

export interface LabHistoryLike {
  manualLabs?: object | null;
  biomarkers?: object | null;
}

function toNumber(raw: unknown): number | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  if (raw && typeof raw === "object" && "value" in raw) {
    return toNumber((raw as { value: unknown }).value);
  }
  return undefined;
}

// resolved key -> [biomarker keys, legacy manualLabs keys]
const KEY_MAP: Record<keyof ResolvedLabs, [string[], string[]]> = {
  a1c: [["a1c"], ["a1c"]],
  ldl: [["ldl"], ["ldl"]],
  hdl: [["hdl"], ["hdl"]],
  fastingGlucose: [["fasting_glucose"], ["fastingGlucose", "fasting_glucose"]],
  triglycerides: [["triglycerides"], ["triglycerides"]],
  bpSystolic: [["bp_systolic"], ["bpSystolic"]],
  bpDiastolic: [["bp_diastolic"], ["bpDiastolic"]],
  egfr: [["egfr"], ["egfr"]],
  tsh: [["tsh"], ["tsh"]],
  vitaminD: [["vitamin_d"], ["vitaminD", "vitamin_d"]],
  totalCholesterol: [["total_cholesterol"], ["totalCholesterol", "total_cholesterol"]],
  weight: [["weight"], ["weight"]],
  height: [["height"], ["height"]],
};

export function resolveLabs(history: LabHistoryLike | null | undefined): ResolvedLabs {
  const out: ResolvedLabs = {};
  if (!history) return out;
  const bio = (history.biomarkers ?? {}) as Record<string, unknown>;
  const manual = (history.manualLabs ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(KEY_MAP) as (keyof ResolvedLabs)[]) {
    const [bioKeys, legacyKeys] = KEY_MAP[key];
    let v: number | undefined;
    for (const k of bioKeys) {
      v = toNumber(bio[k]);
      if (v !== undefined) break;
    }
    if (v === undefined) {
      for (const k of legacyKeys) {
        v = toNumber(manual[k]);
        if (v !== undefined) break;
      }
    }
    if (v !== undefined) out[key] = v;
  }
  return out;
}
