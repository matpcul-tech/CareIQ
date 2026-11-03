import type { Actor } from "./logic";
import type { ClinicRecord, ClinicStore } from "./store";

export const DEFAULT_CLINIC_TZ = "America/Chicago";

/** Common US clinic zones for the picker. Any valid IANA zone is accepted. */
export const COMMON_TIME_ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "Pacific/Honolulu", "America/Puerto_Rico", "Pacific/Guam", "Pacific/Pago_Pago",
];

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function clinicTimeZone(rec: Pick<ClinicRecord, "time_zone"> | null | undefined): string {
  return rec && isValidTimeZone(rec.time_zone) ? rec.time_zone : DEFAULT_CLINIC_TZ;
}

/** Clinic local calendar date and hour (0 to 23) at the given instant. */
export function localDateHour(tz: string, at: Date = new Date()): { today: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return { today: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

export async function getClinicSettings(store: ClinicStore, actor: Actor | null): Promise<{ ok: true; data: { timeZone: string; isAdmin: boolean; zones: string[] } } | Fail> {
  if (!actor || actor.kind !== "staff") return fail(401, "authentication required");
  const me = await store.getStaff(actor.staffId);
  if (!me || me.revoked_at || me.clinic_id !== actor.clinicId) return fail(403, "clinic staff only");
  const clinic = await store.getClinic(actor.clinicId);
  return { ok: true, data: { timeZone: clinicTimeZone(clinic), isAdmin: me.is_admin, zones: COMMON_TIME_ZONES } };
}

export async function updateClinicTimeZone(store: ClinicStore, actor: Actor | null, tz: unknown): Promise<{ ok: true; data: { timeZone: string } } | Fail> {
  if (!actor || actor.kind !== "staff") return fail(401, "authentication required");
  const me = await store.getStaff(actor.staffId);
  if (!me || me.revoked_at || !me.is_admin || me.clinic_id !== actor.clinicId) return fail(403, "clinic admin only");
  if (!isValidTimeZone(tz)) return fail(400, "time zone must be a valid IANA name, for example America/Chicago");
  await store.setClinicTimeZone(actor.clinicId, tz);
  return { ok: true, data: { timeZone: tz } };
}
