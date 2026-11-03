import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { clinicTimeZone, DEFAULT_CLINIC_TZ, getClinicSettings, isValidTimeZone, localDateHour, updateClinicTimeZone } from "../src/lib/clinic/time-zone";

test("valid IANA zones only", () => {
  assert.ok(isValidTimeZone("America/Chicago"));
  assert.ok(isValidTimeZone("Pacific/Honolulu"));
  assert.ok(isValidTimeZone("America/Argentina/Buenos_Aires"));
  for (const bad of ["Mars/Base", "", "America/Chicago; drop", 5, null, "x".repeat(70)]) assert.equal(isValidTimeZone(bad), false);
});

test("missing or bad zone on the record falls back to America/Chicago", () => {
  assert.equal(clinicTimeZone(null), DEFAULT_CLINIC_TZ);
  assert.equal(clinicTimeZone({}), DEFAULT_CLINIC_TZ);
  assert.equal(clinicTimeZone({ time_zone: "Nowhere/Land" }), DEFAULT_CLINIC_TZ);
  assert.equal(clinicTimeZone({ time_zone: "America/Denver" }), "America/Denver");
});

test("local date and hour follow the clinic zone, including the day boundary", () => {
  const at = new Date("2026-11-03T04:30:00Z");
  assert.deepEqual(localDateHour("America/Chicago", at), { today: "2026-11-02", hour: 22 });
  assert.deepEqual(localDateHour("America/New_York", at), { today: "2026-11-02", hour: 23 });
  assert.deepEqual(localDateHour("Pacific/Guam", at), { today: "2026-11-03", hour: 14 });
  assert.deepEqual(localDateHour("Pacific/Honolulu", at), { today: "2026-11-02", hour: 18 });
});

test("staff can read the zone; only the clinic admin can change it", async () => {
  const store = new MemoryClinicStore();
  const c = await store.createClinic("Synthetic Clinic");
  const admin = await store.addStaff(c.id, "provider", "Admin", null, { is_admin: true });
  const staff = await store.addStaff(c.id, "front_desk", "Desk");
  const other = await store.createClinic("Other");
  const otherAdmin = await store.addStaff(other.id, "provider", "Other admin", null, { is_admin: true });
  const act = (s: { id: string; clinic_id: string; role: "provider" | "front_desk" }) => ({ kind: "staff" as const, clinicId: s.clinic_id, staffId: s.id, role: s.role });
  const read = await getClinicSettings(store, act(staff as never));
  assert.ok(read.ok && read.data.timeZone === "America/Chicago" && !read.data.isAdmin);
  assert.equal((await updateClinicTimeZone(store, act(staff as never), "America/Denver")).ok, false);
  assert.equal((await updateClinicTimeZone(store, null, "America/Denver")).ok, false);
  assert.equal((await updateClinicTimeZone(store, act(admin as never), "Bad/Zone")).ok, false);
  assert.ok((await updateClinicTimeZone(store, act(admin as never), "America/Denver")).ok);
  assert.equal((await store.getClinic(c.id))?.time_zone, "America/Denver");
  // Another clinic's admin changes only their own clinic.
  await updateClinicTimeZone(store, act(otherAdmin as never), "Pacific/Guam");
  assert.equal((await store.getClinic(c.id))?.time_zone, "America/Denver");
  assert.equal((await store.getClinic(other.id))?.time_zone, "Pacific/Guam");
});

test("reminders and the panel use the clinic zone; migration defaults to America/Chicago", () => {
  const appts = readFileSync("src/app/api/clinic/appointments/route.ts", "utf8");
  assert.doesNotMatch(appts, /const CLINIC_TZ/);
  assert.match(appts, /clinicTimeZone\(clinic\)/);
  assert.match(readFileSync("src/app/api/clinic/uds/route.ts", "utf8"), /localDateHour\(clinicTimeZone/);
  assert.match(readFileSync("src/middleware.ts", "utf8"), /STAFF_ONLY_CLINIC_APIS = new Set<string>\(\[[^\]]*"\/api\/clinic\/settings"/);
  const sql = readFileSync("supabase/migrations/0017_clinic_time_zone.sql", "utf8");
  assert.match(sql, /default 'America\/Chicago'/);
  // Store keeps working before the migration is applied.
  assert.match(readFileSync("src/lib/clinic/supabase-store.ts", "utf8"), /42703/);
});
