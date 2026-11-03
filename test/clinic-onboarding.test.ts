import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createInviteLink, listInviteLinks, MemoryOnboardingStore, redeemInviteLink, redeemSetupToken, revokeInviteLink, TOKEN_INVALID, type OnboardingAuditEvent, type OnboardingDeps } from "../src/lib/clinic/onboarding/logic";
import { hashToken, looksLikeToken, newToken } from "../src/lib/clinic/onboarding/tokens";
import { ONBOARDING_RATE_LIMIT_MAX, rateLimitBucket } from "../src/lib/clinic/inbound-limit";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { setupHours } from "../scripts/create-clinic-setup-token";

function setup(nowIso = "2026-11-03T12:00:00Z") {
  const clinicStore = new MemoryClinicStore();
  const store = new MemoryOnboardingStore();
  const events: OnboardingAuditEvent[] = [];
  let now = new Date(nowIso);
  const deps: OnboardingDeps = { clinicStore, store, audit: async (e) => { events.push(e); }, hashEmail: (e) => `h:${e.toLowerCase()}`, now: () => now };
  return { deps, clinicStore, store, events, setNow: (iso: string) => { now = new Date(iso); } };
}
const form = (token: string) => ({ token, clinicName: "Synthetic Eastside FQHC", adminName: "Synthetic Admin", adminEmail: "admin@example.test", adminRole: "provider" });

test("tokens are 256 bit base64url and stored only as SHA-256 hex", () => {
  const t = newToken();
  assert.ok(looksLikeToken(t));
  assert.notEqual(newToken(), t);
  assert.match(hashToken(t), /^[0-9a-f]{64}$/);
  assert.equal(looksLikeToken("short"), false);
});

test("setup token creates the clinic and its admin, works once", async () => {
  const { deps, clinicStore, store, events } = setup();
  const t = newToken();
  store.addSetupToken(hashToken(t), "2026-11-04T12:00:00Z");
  const r = await redeemSetupToken(deps, form(t));
  assert.ok(r.ok);
  if (!r.ok) return;
  const staff = await clinicStore.getStaff(r.data.staffId);
  assert.equal(staff?.is_admin, true);
  assert.equal(staff?.email_hash, "h:admin@example.test");
  assert.equal((await clinicStore.getClinic(r.data.clinicId))?.name, "Synthetic Eastside FQHC");
  const again = await redeemSetupToken(deps, { ...form(t), adminEmail: "other@example.test" });
  assert.deepEqual(again, { ok: false, status: 400, error: TOKEN_INVALID });
  assert.ok(!JSON.stringify(events).includes("example.test"));
  assert.ok(!JSON.stringify(events).includes(t));
});

test("expired and unknown setup tokens get the same error; bad input does not burn the token", async () => {
  const { deps, store, setNow } = setup();
  const t = newToken();
  store.addSetupToken(hashToken(t), "2026-11-04T12:00:00Z");
  assert.equal((await redeemSetupToken(deps, { ...form(t), adminEmail: "nope" })).ok, false);
  assert.equal((await redeemSetupToken(deps, { ...form(t), clinicName: " " })).ok, false);
  const unknown = await redeemSetupToken(deps, form(newToken()));
  setNow("2026-11-05T00:00:00Z");
  const expired = await redeemSetupToken(deps, form(t));
  assert.deepEqual(unknown, expired);
  setNow("2026-11-03T13:00:00Z");
  assert.ok((await redeemSetupToken(deps, form(t))).ok);
});

test("an email already on a staff list is refused before the token is used", async () => {
  const { deps, store } = setup();
  const t1 = newToken(); const t2 = newToken();
  store.addSetupToken(hashToken(t1), "2026-11-04T12:00:00Z");
  store.addSetupToken(hashToken(t2), "2026-11-04T12:00:00Z");
  assert.ok((await redeemSetupToken(deps, form(t1))).ok);
  assert.equal((await redeemSetupToken(deps, form(t2))).ok, false);
  assert.equal(store.setup.get(hashToken(t2))?.used_at, null);
});

async function withAdmin() {
  const s = setup();
  const t = newToken();
  s.store.addSetupToken(hashToken(t), "2026-11-04T12:00:00Z");
  const r = await redeemSetupToken(s.deps, form(t));
  if (!r.ok) throw new Error("setup");
  const actor = { kind: "staff" as const, clinicId: r.data.clinicId, staffId: r.data.staffId, role: "provider" as const };
  return { ...s, actor, clinicId: r.data.clinicId };
}

test("admin makes single-use invite links for admin and staff roles", async () => {
  const { deps, clinicStore, actor, clinicId } = await withAdmin();
  const staffLink = await createInviteLink(deps, actor, { role: "front_desk", admin: false });
  const adminLink = await createInviteLink(deps, actor, { role: "care_manager", admin: true });
  assert.ok(staffLink.ok && adminLink.ok);
  if (!staffLink.ok || !adminLink.ok) return;
  assert.equal(staffLink.data.expiresAt, "2026-11-10T12:00:00.000Z");
  const j1 = await redeemInviteLink(deps, { token: staffLink.data.token, displayName: "Synthetic Desk", email: "desk@example.test" });
  assert.deepEqual(j1, { ok: true, data: { role: "front_desk", admin: false } });
  const j2 = await redeemInviteLink(deps, { token: adminLink.data.token, displayName: "Synthetic CM", email: "cm@example.test" });
  assert.deepEqual(j2, { ok: true, data: { role: "care_manager", admin: true } });
  assert.equal((await redeemInviteLink(deps, { token: staffLink.data.token, displayName: "X", email: "x@example.test" })).ok, false);
  const desk = await clinicStore.findStaffByEmailHash("h:desk@example.test");
  assert.equal(desk?.clinic_id, clinicId);
  assert.equal(desk?.is_admin, false);
  const list = await listInviteLinks(deps, actor);
  assert.ok(list.ok && list.data.invites.length === 2 && list.data.invites.every((i) => !("token_hash" in i)));
});

test("non admins cannot make, list, or revoke links; revoked and expired links fail", async () => {
  const { deps, clinicStore, actor, clinicId, setNow } = await withAdmin();
  const nurse = await clinicStore.addStaff(clinicId, "provider", "Synthetic Staff");
  const staffActor = { kind: "staff" as const, clinicId, staffId: nurse.id, role: "provider" as const };
  assert.equal((await createInviteLink(deps, staffActor, { role: "provider", admin: true })).ok, false);
  assert.equal((await listInviteLinks(deps, staffActor)).ok, false);
  assert.equal((await createInviteLink(deps, null, { role: "provider", admin: false })).ok, false);
  assert.equal((await createInviteLink(deps, { kind: "patient", patientId: "p" }, { role: "provider", admin: false })).ok, false);
  assert.equal((await createInviteLink(deps, actor, { role: "ma", admin: false })).ok, false);
  const a = await createInviteLink(deps, actor, { role: "provider", admin: false });
  const b = await createInviteLink(deps, actor, { role: "provider", admin: false });
  if (!a.ok || !b.ok) throw new Error("links");
  assert.equal((await revokeInviteLink(deps, staffActor, a.data.id)).ok, false);
  assert.ok((await revokeInviteLink(deps, actor, a.data.id)).ok);
  assert.equal((await redeemInviteLink(deps, { token: a.data.token, displayName: "Y", email: "y@example.test" })).ok, false);
  setNow("2026-11-11T12:00:00Z");
  assert.equal((await redeemInviteLink(deps, { token: b.data.token, displayName: "Z", email: "z@example.test" })).ok, false);
});

test("setup and join are rate limited, CSRF checked, and need no patient session; invites are staff only", () => {
  assert.equal(rateLimitBucket("/api/clinic/setup", "1.2.3.4").max, ONBOARDING_RATE_LIMIT_MAX);
  assert.equal(rateLimitBucket("/api/clinic/join", "1.2.3.4").key, "onboarding:1.2.3.4");
  assert.ok(ONBOARDING_RATE_LIMIT_MAX <= 5);
  const mw = readFileSync("src/middleware.ts", "utf8");
  const csrfExempt = mw.slice(mw.indexOf("CSRF_EXEMPT_API_PATHS = new Set"), mw.indexOf("]);", mw.indexOf("CSRF_EXEMPT_API_PATHS = new Set")));
  assert.doesNotMatch(csrfExempt, /clinic\/setup|clinic\/join/);
  assert.match(mw, /NO_PATIENT_SESSION_API_PATHS[\s\S]*"\/api\/clinic\/setup"[\s\S]*"\/api\/clinic\/join"/);
  assert.match(mw, /STAFF_ONLY_CLINIC_APIS = new Set<string>\(\[[^\]]*"\/api\/clinic\/invites"/);
  for (const f of ["src/app/api/clinic/setup/route.ts", "src/app/api/clinic/join/route.ts", "src/app/api/clinic/invites/route.ts"]) {
    assert.match(readFileSync(f, "utf8"), /csrfReject\(req\)/);
  }
});

test("operator script caps the setup link lifetime", () => {
  assert.equal(setupHours(undefined), 24);
  assert.equal(setupHours("500"), 72);
  assert.equal(setupHours("-1"), 24);
  const sql = readFileSync("supabase/migrations/0019_clinic_onboarding_tokens.sql", "utf8");
  assert.match(sql, /force row level security/);
  assert.doesNotMatch(sql, /token\s+text/);
});
