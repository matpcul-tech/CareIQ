import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ensureOwnerCircleRow } from "../src/lib/circle-owner";

const PID = "11111111-2222-4333-8444-555555555555";
const UID = "aaaaaaaa-2222-4333-8444-555555555555";
const hash = (e: string) => `h:${e.toLowerCase()}`;

function fakeSb(opts: { email?: string; patientHash?: string; rows?: Array<Record<string, unknown>> }) {
  const rows = opts.rows ?? [];
  const writes: Array<{ op: string; payload: unknown }> = [];
  function q(table: string) {
    const f: Array<[string, string, unknown]> = [];
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (c: string, v: unknown) => (f.push(["eq", c, v]), api),
      ilike: (c: string, v: unknown) => (f.push(["ilike", c, v]), api),
      limit: async () => ({ data: rows.filter((r) => f.every(([k, c, v]) => k === "eq" ? r[c] === v : String(r[c]).toLowerCase() === String(v).toLowerCase())) }),
      maybeSingle: async () => ({ data: table === "patients" && opts.patientHash ? { email_hash: opts.patientHash } : null }),
      insert: async (p: Record<string, unknown>) => (writes.push({ op: "insert", payload: p }), rows.push(p), { error: null }),
      update: (p: Record<string, unknown>) => ({ eq: async () => (writes.push({ op: "update", payload: p }), { error: null }) }),
    };
    return api;
  }
  return {
    writes,
    auth: { admin: { getUserById: async () => ({ data: opts.email ? { user: { email: opts.email, user_metadata: { full_name: "Syn Patient" } } } : null, error: null }) } },
    from: q,
  };
}

test("inserts an admin owner row for the verified patient", async () => {
  const sb = fakeSb({ email: "Syn@Example.com", patientHash: hash("syn@example.com") });
  const r = await ensureOwnerCircleRow(sb, { patientId: PID, authUserId: UID, hashEmail: hash });
  assert.deepEqual(r, { ok: true, action: "inserted" });
  const p = sb.writes[0].payload as Record<string, unknown>;
  assert.equal(p.care_role, "admin");
  assert.equal(p.member_user_id, UID);
  assert.equal(p.patient_id, PID);
  assert.equal(p.member_email, "syn@example.com");
  assert.equal(p.relationship, "Self");
});

test("is idempotent when the owner row exists", async () => {
  const sb = fakeSb({ email: "syn@example.com", patientHash: hash("syn@example.com"), rows: [{ id: "c1", patient_id: PID, member_user_id: UID }] });
  const r = await ensureOwnerCircleRow(sb, { patientId: PID, authUserId: UID, hashEmail: hash });
  assert.deepEqual(r, { ok: true, action: "exists" });
  assert.equal(sb.writes.length, 0);
});

test("links an existing same-email row instead of inserting a duplicate", async () => {
  const sb = fakeSb({ email: "syn@example.com", patientHash: hash("syn@example.com"), rows: [{ id: "c2", patient_id: PID, member_email: "SYN@example.com", member_user_id: null }] });
  const r = await ensureOwnerCircleRow(sb, { patientId: PID, authUserId: UID, hashEmail: hash });
  assert.deepEqual(r, { ok: true, action: "linked" });
  assert.equal(sb.writes[0].op, "update");
});

test("SECURITY: refuses when the auth user's email does not match the patient (forged cookie)", async () => {
  const sb = fakeSb({ email: "attacker@example.com", patientHash: hash("syn@example.com") });
  const r = await ensureOwnerCircleRow(sb, { patientId: PID, authUserId: UID, hashEmail: hash });
  assert.deepEqual(r, { ok: false, reason: "owner_mismatch" });
  assert.equal(sb.writes.length, 0);
});

test("skips cleanly for old cookies without an auth user id", async () => {
  const sb = fakeSb({});
  const r = await ensureOwnerCircleRow(sb, { patientId: PID, authUserId: null, hashEmail: hash });
  assert.equal(r.ok, false);
});

test("invite link fallback domain is carecircleos.vercel.app and routes call the owner helper", () => {
  const gi = readFileSync(new URL("../src/app/api/circle/generate-invite/route.ts", import.meta.url), "utf8");
  assert.match(gi, /"https:\/\/carecircleos\.vercel\.app"/);
  assert.doesNotMatch(gi, /care-os-uo7x/);
  assert.match(gi, /ensureOwnerCircleRow\(/);
  const list = readFileSync(new URL("../src/app/api/circle/list/route.ts", import.meta.url), "utf8");
  assert.match(list, /ensureOwnerCircleRow\(/);
  const cb = readFileSync(new URL("../src/app/auth/callback/route.ts", import.meta.url), "utf8");
  assert.match(cb, /writeAuthCookie\(\s*patientId,[\s\S]*?userId,\s*\)/);
});
