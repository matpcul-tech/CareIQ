import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildFollowUpList, logFollowUpCall, MemoryFollowUpCallStore, viewFollowUps, type AlertSignal, type AppointmentSignal, type FollowUpAuditEvent, type FollowUpDeps, type GapSignal } from "../src/lib/clinic/followups/logic";
import { MemoryClinicStore } from "../src/lib/clinic/store";

const today = "2026-11-03";
const alert = (o: Partial<AlertSignal>): AlertSignal => ({ patientId: "SYN-0001", severity: "critical", status: "new", createdAt: "2026-11-03T14:00:00Z", guidance: "Synthetic guidance.", ...o });
const appt = (o: Partial<AppointmentSignal>): AppointmentSignal => ({ patientId: "SYN-0003", date: "2026-11-05", visitType: "checkup", reachable: true, optedOut: false, ...o });

test("priority: critical alert today, high alert and unreachable visit within 3 days soon, the rest routine", () => {
  const rows = buildFollowUpList({
    today,
    alerts: [alert({}), alert({ patientId: "SYN-0002", severity: "high" }), alert({ patientId: "SYN-0009", severity: "informational" }), alert({ patientId: "SYN-0010", status: "resolved" })],
    gaps: [{ patientId: "SYN-0004", gapsDue: ["CMS130: colorectal screening"] }],
    appointments: [appt({ reachable: false }), appt({ patientId: "SYN-0005", date: "2026-11-09", optedOut: true }), appt({ patientId: "SYN-0006" })],
    calls: [],
  });
  const p = Object.fromEntries(rows.map((r) => [r.patientId, r.priority]));
  assert.deepEqual(p, { "SYN-0001": 1, "SYN-0002": 2, "SYN-0003": 2, "SYN-0009": 3, "SYN-0004": 3, "SYN-0005": 3 });
  assert.equal(rows[0].patientId, "SYN-0001");
  assert.ok(!("SYN-0010" in p), "resolved alerts are not listed");
  assert.ok(!("SYN-0006" in p), "reachable visit without gaps needs no call");
  assert.match(rows.find((r) => r.patientId === "SYN-0005")!.reasons[0].text, /opted out/);
});

test("one row per patient with every reason, highest priority wins", () => {
  const rows = buildFollowUpList({
    today,
    alerts: [alert({ patientId: "SYN-0007", severity: "informational" })],
    gaps: [{ patientId: "SYN-0007", gapsDue: ["CMS2: depression screening"] }],
    appointments: [appt({ patientId: "SYN-0007", reachable: false, date: "2026-11-04" })],
    calls: [],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].priority, 2);
  assert.deepEqual(rows[0].reasons.map((r) => r.kind).sort(), ["alert", "appointment", "appointment", "care_gap"]);
});

test("a reached call marks done; no answer keeps it open; a newer alert reopens it", () => {
  const base = { today, gaps: [] as GapSignal[], appointments: [] as AppointmentSignal[] };
  const call = (outcome: "reached" | "no_answer", at: string) => ({ id: "c", clinicId: "k", patientId: "SYN-0001", staffId: "s1", calledAt: at, outcome, note: "Synthetic note" });
  assert.equal(buildFollowUpList({ ...base, alerts: [alert({})], calls: [call("reached", "2026-11-03T15:00:00Z")], staffNames: { s1: "Nurse Synthetic" } })[0].done, true);
  const open = buildFollowUpList({ ...base, alerts: [alert({})], calls: [call("no_answer", "2026-11-03T15:00:00Z")] })[0];
  assert.equal(open.done, false);
  assert.equal(open.lastCall?.outcome, "no_answer");
  assert.equal(buildFollowUpList({ ...base, alerts: [alert({ createdAt: "2026-11-03T16:00:00Z" })], calls: [call("reached", "2026-11-03T15:00:00Z")] })[0].done, false);
  // Done rows sort after open rows.
  const rows = buildFollowUpList({ ...base, alerts: [alert({}), alert({ patientId: "SYN-0002", severity: "informational" })], calls: [call("reached", "2026-11-03T15:00:00Z")] });
  assert.deepEqual(rows.map((r) => [r.patientId, r.done]), [["SYN-0002", false], ["SYN-0001", true]]);
});

async function setup() {
  const clinicStore = new MemoryClinicStore();
  const c = await clinicStore.createClinic("Synthetic Clinic");
  const s = await clinicStore.addStaff(c.id, "care_manager", "Synthetic CM");
  const other = await clinicStore.createClinic("Other");
  const o = await clinicStore.addStaff(other.id, "provider", "Other");
  const events: FollowUpAuditEvent[] = [];
  const calls = new MemoryFollowUpCallStore();
  const deps: FollowUpDeps = {
    clinicStore, calls, audit: async (e) => { events.push(e); },
    signals: async (clinicId) => clinicId === c.id ? { alerts: [alert({})], gaps: [], appointments: [] } : { alerts: [], gaps: [], appointments: [] },
    now: () => new Date("2026-11-03T15:30:00Z"),
  };
  const actor = { kind: "staff" as const, clinicId: c.id, staffId: s.id, role: s.role };
  const otherActor = { kind: "staff" as const, clinicId: other.id, staffId: o.id, role: o.role };
  return { deps, events, calls, actor, otherActor, clinicStore, staffId: s.id };
}

test("staff view and call logging; audit carries no patient id or note", async () => {
  const { deps, events, actor } = await setup();
  const v = await viewFollowUps(deps, actor, today);
  assert.ok(v.ok && v.data.open === 1);
  const r = await logFollowUpCall(deps, actor, { patientId: "SYN-0001", outcome: "reached", note: "Synthetic: will recheck BP" }, today);
  assert.ok(r.ok);
  const after = await viewFollowUps(deps, actor, today);
  assert.ok(after.ok && after.data.open === 0 && after.data.rows[0].lastCall?.staffName === "Synthetic CM");
  assert.doesNotMatch(JSON.stringify(events), /SYN-|recheck/);
  assert.ok(events.some((e) => e.action === "clinic.followups.call_logged" && e.outcome === "reached"));
});

test("patients, revoked staff, and other clinics are refused; bad input rejected", async () => {
  const { deps, actor, otherActor, clinicStore, staffId } = await setup();
  assert.equal((await viewFollowUps(deps, { kind: "patient", patientId: "p" }, today)).ok, false);
  assert.equal((await viewFollowUps(deps, null, today)).ok, false);
  assert.equal((await logFollowUpCall(deps, otherActor, { patientId: "SYN-0001", outcome: "reached", note: "" }, today)).ok, false);
  assert.equal((await logFollowUpCall(deps, actor, { patientId: "SYN-0001", outcome: "video", note: "" }, today)).ok, false);
  assert.equal((await logFollowUpCall(deps, actor, { patientId: "", outcome: "reached", note: "" }, today)).ok, false);
  await clinicStore.revokeStaff(staffId, "2026-11-03T00:00:00Z");
  assert.equal((await viewFollowUps(deps, actor, today)).ok, false);
});

test("Telehealth tab tells patients the care team may call; no video or booking; API is staff only", () => {
  const ui = readFileSync("src/components/CareIQHealthOS.tsx", "utf8");
  const tele = ui.slice(ui.indexOf("function Telehealth()"), ui.indexOf("function Sovereignty()"));
  assert.match(tele, /Your care team may call you/);
  assert.match(tele, /does not book visits and has no video visits/);
  assert.match(tele, /<FollowUpCalls\/>/);
  assert.doesNotMatch(tele, /There is no appointment list in this app/);
  assert.match(readFileSync("src/middleware.ts", "utf8"), /STAFF_ONLY_CLINIC_APIS = new Set<string>\(\[[^\]]*"\/api\/clinic\/followups"/);
  const sql = readFileSync("supabase/migrations/0018_clinic_followup_calls.sql", "utf8");
  assert.match(sql, /force row level security/);
  assert.doesNotMatch(sql, /note\s+text|patient_id\s+text/);
});
