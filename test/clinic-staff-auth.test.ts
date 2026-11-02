import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { clinicWorklist, inviteClinicStaff } from "../src/lib/clinic/actions";
import { bootstrapClinicAdmin } from "../src/lib/clinic/bootstrap-admin";
import { handleClinicHttp } from "../src/lib/clinic/http";
import type { Actor } from "../src/lib/clinic/logic";
import { toPublicClinicPayload } from "../src/lib/clinic/public-payload";
import { bindStaffOnSignIn, enforceStaffClinic, parseInviteRole, staffMayReceiveSignInLink } from "../src/lib/clinic/staff-auth";
import { deliverStaffInvite, type StaffAuthAdmin } from "../src/lib/clinic/staff-mail";
import { issueStaffToken } from "../src/lib/clinic/staff-session";
import { MemoryClinicStore } from "../src/lib/clinic/store";
import { readClinicActor } from "../src/lib/clinic/token";
import { resolveServiceRoleKey, SERVICE_ROLE_ENV_WARNING } from "../src/lib/supabase-env";

const AS_OF = "2026-11-02";

function patientRow(externalId: string) {
  return {
    external_id: externalId,
    age: 60,
    has_diabetes: false,
    has_hypertension: true,
    last_a1c: null,
    last_a1c_date: null,
    bp_systolic: 180,
    bp_diastolic: 100,
    last_bp_date: "2026-10-01",
    next_visit_date: null,
    patient_id: null,
  };
}

test("patient metadata cannot grant a staff role", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const row = await store.addStaff(clinic.id, "front_desk", "Front Desk", null, { email_hash: "hash:staff@example.org" });
  const fromMetadata = await bindStaffOnSignIn(store, {
    emailHash: "hash:patient@example.org",
    authUserId: "auth-patient",
    userMetadata: { role: "provider", clinic_id: clinic.id },
    appMetadata: { role: "provider", clinic_id: clinic.id },
  });
  assert.equal(fromMetadata, null);
  assert.equal((await store.listStaff(clinic.id)).length, 1);

  const bound = await bindStaffOnSignIn(store, {
    emailHash: "hash:staff@example.org",
    authUserId: "auth-staff",
    userMetadata: { role: "provider" },
    appMetadata: { role: "provider" },
  });
  assert.equal(bound?.role, "front_desk");
  assert.equal(bound?.staffId, row.id);
  const takeover = await bindStaffOnSignIn(store, {
    emailHash: "hash:staff@example.org",
    authUserId: "auth-other",
    userMetadata: { role: "provider" },
  });
  assert.equal(takeover, null);

  const token = bound ? issueStaffToken(bound, "test-secret", 1_000) : null;
  assert.ok(token);
  const read = readClinicActor(token || "", "test-secret", 1_000);
  assert.equal(read?.kind, "staff");
  if (read?.kind === "staff") assert.equal(read.role, "front_desk");
});

test("a patient cannot invite staff or receive a staff token", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  let sent = 0;
  const http = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "invite_staff",
      email: "new.staff@example.org",
      role: "provider",
      displayName: "Should Fail",
      clinicId: clinic.id,
    }),
  }), {
    store,
    actor: { kind: "patient", patientId: "patient-1" },
    smsEnv: {},
    asOf: AS_OF,
    hashStaffEmail: (email) => `hash:${email}`,
    sendStaffInvite: async () => {
      sent += 1;
      return { ok: true, delivery: "supabase" };
    },
  });
  const body = await http.json() as Record<string, unknown>;
  assert.equal(http.status, 403);
  assert.equal(sent, 0);
  assert.equal((await store.listStaff(clinic.id)).length, 0);
  const published = toPublicClinicPayload({
    ...body,
    staff_id: "staff-1",
    clinic_id: clinic.id,
    role: "provider",
    staff_token: "forged",
    sign_in: "ready",
  });
  assert.equal(published.staff_token, undefined);
  assert.equal(published.staff_id, undefined);
  assert.equal(published.sign_in, undefined);
  assert.equal("staff_token" in published, false);
});

test("clinic admin invite stays inside the admin clinic and does not return a token", async () => {
  const store = new MemoryClinicStore();
  const clinic = await store.createClinic("Synthetic FQHC");
  const other = await store.createClinic("Other Clinic");
  const admin = await store.addStaff(clinic.id, "provider", "Clinic Admin", null, {
    email_hash: "hash:admin@example.org",
    is_admin: true,
  });
  const provider: Actor = { kind: "staff", clinicId: clinic.id, staffId: admin.id, role: "provider" };
  const notAdmin = await store.addStaff(clinic.id, "provider", "Plain Provider");
  const plain: Actor = { kind: "staff", clinicId: clinic.id, staffId: notAdmin.id, role: "provider" };
  const denied = await inviteClinicStaff(store, plain, {
    clinicId: clinic.id,
    role: "care_manager",
    displayName: "Care Manager",
    emailHash: "hash:cm@example.org",
  });
  assert.equal(denied.ok, false);

  let sentTo = "";
  const http = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "invite_staff",
      email: "Desk@Example.org",
      role: "front desk",
      displayName: "Front Desk",
      clinicId: other.id,
    }),
  }), {
    store,
    actor: provider,
    smsEnv: {},
    asOf: AS_OF,
    hashStaffEmail: (email) => `hash:${email}`,
    sendStaffInvite: async (email) => {
      sentTo = email;
      return { ok: true, delivery: "resend" };
    },
  });
  assert.equal(http.status, 403);
  assert.equal(sentTo, "");
  assert.equal((await store.listStaff(other.id)).length, 0);

  const invited = await handleClinicHttp(new Request("http://localhost/api/clinic", {
    method: "POST",
    body: JSON.stringify({
      action: "invite_staff",
      email: "cm@example.org",
      role: "care_manager",
      displayName: "Care Manager",
    }),
  }), {
    store,
    actor: provider,
    smsEnv: {},
    asOf: AS_OF,
    hashStaffEmail: (email) => `hash:${email}`,
    sendStaffInvite: async (email) => {
      sentTo = email;
      return { ok: true, delivery: "supabase" };
    },
  });
  const payload = await invited.json() as Record<string, unknown>;
  assert.equal(invited.status, 200);
  assert.equal(payload.role, "care_manager");
  assert.equal(payload.invited, true);
  assert.equal(payload.staff_token, undefined);
  assert.equal(payload.staff_id, undefined);
  assert.equal(sentTo, "cm@example.org");
  const created = (await store.listStaff(clinic.id)).find((row) => row.email_hash === "hash:cm@example.org");
  assert.equal(created?.is_admin, false);
  assert.equal(created?.role, "care_manager");
  assert.equal(parseInviteRole("care manager"), "care_manager");
  assert.equal(parseInviteRole("ma"), null);
});

test("staff routes do not cross clinics", async () => {
  const store = new MemoryClinicStore();
  const clinicA = await store.createClinic("Clinic A");
  const clinicB = await store.createClinic("Clinic B");
  const staffA = await store.addStaff(clinicA.id, "provider", "Provider A");
  const staffB = await store.addStaff(clinicB.id, "care_manager", "Care Manager B");
  await store.upsertPatients(clinicA.id, [patientRow("SYN-CLINIC-A")]);
  await store.upsertPatients(clinicB.id, [patientRow("SYN-CLINIC-B")]);
  const actorA: Actor = { kind: "staff", clinicId: clinicA.id, staffId: staffA.id, role: "provider" };
  const work = await clinicWorklist(store, actorA, AS_OF);
  assert.equal(work.ok, true);
  const listed = JSON.stringify(work);
  assert.equal(listed.includes("SYN-CLINIC-A"), true);
  assert.equal(listed.includes("SYN-CLINIC-B"), false);

  const http = await handleClinicHttp(new Request("http://localhost/api/clinic?view=worklist"), {
    store,
    actor: actorA,
    smsEnv: {},
    asOf: AS_OF,
  });
  const body = JSON.stringify(await http.json());
  assert.equal(http.status, 200);
  assert.equal(body.includes("SYN-CLINIC-B"), false);

  const mismatched = await enforceStaffClinic(store, {
    kind: "staff",
    clinicId: clinicB.id,
    staffId: staffA.id,
    role: "provider",
  });
  assert.equal(mismatched && "revoked" in mismatched ? mismatched.revoked : false, true);
  const denied = await clinicWorklist(store, mismatched || actorA, AS_OF);
  assert.equal(denied.ok, false);

  const otherRole = await enforceStaffClinic(store, {
    kind: "staff",
    clinicId: clinicB.id,
    staffId: staffB.id,
    role: "provider",
  });
  assert.equal(otherRole && "revoked" in otherRole ? otherRole.revoked : false, true);
  assert.equal(staffMayReceiveSignInLink(await store.getStaff(staffB.id)), true);
  await store.revokeStaff(staffB.id, AS_OF);
  assert.equal(staffMayReceiveSignInLink(await store.getStaff(staffB.id)), false);
});

test("bootstrap creates one admin and does not run unless enabled", async () => {
  const store = new MemoryClinicStore();
  let sends = 0;
  const send = async () => {
    sends += 1;
    return { ok: true };
  };
  const blocked = await bootstrapClinicAdmin(store, {
    enabled: false,
    email: "admin@example.org",
    emailHash: "hash:admin@example.org",
    clinicName: "Synthetic FQHC",
    displayName: "Clinic Admin",
    resend: false,
  }, send);
  assert.equal(blocked.ok, false);
  assert.equal(sends, 0);

  const created = await bootstrapClinicAdmin(store, {
    enabled: true,
    email: "admin@example.org",
    emailHash: "hash:admin@example.org",
    clinicName: "Synthetic FQHC",
    displayName: "Clinic Admin",
    resend: false,
  }, send);
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const staff = await store.getStaff(created.staffId);
  assert.equal(staff?.is_admin, true);
  assert.equal(staff?.role, "provider");
  const again = await bootstrapClinicAdmin(store, {
    enabled: true,
    email: "admin@example.org",
    emailHash: "hash:admin@example.org",
    clinicName: "Second Clinic",
    displayName: "Clinic Admin",
    resend: false,
  }, send);
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.created, false);
  assert.equal(store.clinics.length, 1);
  assert.equal(sends, 1);
});

test("service role key prefers the current env name and warns on the old name", () => {
  const warnings: string[] = [];
  const primary = resolveServiceRoleKey({
    SUPABASE_SERVICE_ROLE_KEY: "role-key",
    SUPABASE_SERVICE_KEY: "legacy-key",
  } as unknown as NodeJS.ProcessEnv, (message) => warnings.push(message));
  assert.equal(primary, "role-key");
  assert.equal(warnings.length, 0);
  const legacy = resolveServiceRoleKey({
    SUPABASE_SERVICE_KEY: "legacy-key",
  } as unknown as NodeJS.ProcessEnv, (message) => warnings.push(message));
  assert.equal(legacy, "legacy-key");
  assert.equal(warnings[0], SERVICE_ROLE_ENV_WARNING);
  const missing = resolveServiceRoleKey({} as unknown as NodeJS.ProcessEnv, (message) => warnings.push(message));
  assert.equal(missing, "");
});

test("staff invite mail does not put a role in the auth user metadata", async () => {
  const calls: string[] = [];
  const admin: StaffAuthAdmin = {
    async inviteUserByEmail() {
      calls.push("invite-user");
      return { error: null };
    },
    async generateLink(params) {
      calls.push(params.type);
      assert.equal("data" in params, false);
      if (params.type === "invite") {
        return { data: null, error: { message: "A user with this email address has already been registered" } };
      }
      return {
        data: { properties: { hashed_token: "token-1", verification_type: "magiclink" } },
        error: null,
      };
    },
  };
  let link = "";
  const sent = await deliverStaffInvite(admin, "staff@example.org", "https://example.test/auth/callback", async (value) => {
    link = value;
    return true;
  });
  assert.equal(sent.ok, true);
  assert.equal(link.includes("token_hash=token-1"), true);
  assert.equal(link.includes("role="), false);
  assert.deepEqual(calls, ["invite", "magiclink"]);
});

test("advisor migration sets search_path and does not drop live tables", async () => {
  const advisor = await readFile("supabase/migrations/0010_advisor_function_hardening.sql", "utf8");
  const staff = await readFile("supabase/migrations/0011_clinic_staff_auth.sql", "utf8");
  assert.match(advisor, /set search_path = ''/i);
  assert.match(advisor, /audit_log_immutable/);
  assert.match(advisor, /revoke all on function public\.is_patient_or_member\(uuid\) from public, anon/i);
  assert.match(advisor, /grant execute on function public\.is_patient_or_member\(uuid\) to authenticated/i);
  assert.match(advisor, /set schema private/i);
  for (const name of ["medications", "medication_logs", "appointments", "care_tasks", "vault_files"]) {
    assert.equal(new RegExp(`drop\\s+table[\\s\\S]{0,40}${name}`, "i").test(advisor), false);
    assert.equal(new RegExp(`drop\\s+table[\\s\\S]{0,40}${name}`, "i").test(staff), false);
  }
});
