import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  alertSeverityOnDevice, coarseFieldsFor, decryptHealthEntry, DeviceLockedError, exportPublicJwk, finishEnrollment, formEntryId,
  generateRecipientKeyPair, le8BandOnDevice, le8InputFromForms, MemoryKeyStore, NotEnrolledError, saveEncryptedForm, startEnrollment,
  unlockDataKey, type EntryRow, type FormTransport,
} from "../src/lib/e2e";
import { handleListEntries, type E2eStore } from "../src/lib/e2e-server";

// Synthetic patient and values only.
const PATIENT = "11111111-1111-4111-8111-111111111111";
const CLINIC = "22222222-2222-4222-8222-222222222222";
const ON = { NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1: "true" };

const FULL_HISTORY = {
  chronicConditions: [],
  le8: {
    mepa: { oliveOilPerDay: 1, leafyVegetablesPerWeek: 3, otherVegetablesPerDay: 2, berriesPerWeek: 3, otherFruitPerDay: 1, redMeatPerWeek: 1, fishPerWeek: 2, chickenPerWeek: 3, cheesePerWeek: 2, butterPerWeek: 1, beansPerWeek: 3, wholeGrainsPerDay: 3, sweetsPerWeek: 1, nutsPerWeek: 3, fastFoodPerWeek: 0, alcoholPerDay: 0 },
    moderateMinutesPerWeek: 160, vigorousMinutesPerWeek: 0, nicotine: "never", livesWithIndoorSmoker: false, sleepHours: 8, lipidTreated: false, bpTreated: false,
  },
};
const GOOD_LABS = { biomarkers: { total_cholesterol: { value: 170 }, hdl: { value: 60 }, a1c: { value: 5.2 }, fasting_glucose: { value: 88 } }, bpSystolic: 112, bpDiastolic: 72, weight: 150, height: 68 };

test("on-device LE8: band only when a total exists, mapped from the three forms", () => {
  assert.equal(le8BandOnDevice({}), null);
  const input = le8InputFromForms({ profile: { sex: "female" }, health_history: FULL_HISTORY as never, manual_labs: GOOD_LABS });
  assert.equal(input.sex, "female");
  assert.equal(input.totalCholesterol, 170);
  assert.equal(input.bpSystolic, 112);
  const band = le8BandOnDevice({ profile: { sex: "female" }, health_history: FULL_HISTORY as never, manual_labs: GOOD_LABS });
  assert.ok(band === "high" || band === "moderate" || band === "low");
});

test("on-device alert severity follows clinic alert rules", () => {
  assert.equal(alertSeverityOnDevice(null), null);
  assert.equal(alertSeverityOnDevice(GOOD_LABS), null);
  assert.equal(alertSeverityOnDevice({ bpSystolic: 185, bpDiastolic: 95 }), "critical");
  assert.equal(alertSeverityOnDevice({ bpSystolic: 145, bpDiastolic: 85 }), "informational");
  assert.equal(alertSeverityOnDevice({ biomarkers: { fasting_glucose: { value: 50 } } }), "critical");
  assert.equal(alertSeverityOnDevice({ biomarkers: { fasting_glucose: { value: 320 } } }), "high");
  assert.equal(alertSeverityOnDevice({ biomarkers: { a1c: { value: 9.5 } } }), "informational");
  assert.equal(alertSeverityOnDevice({ bpSystolic: 145, bpDiastolic: 85, biomarkers: { fasting_glucose: { value: 50 } } }), "critical");
  assert.equal(coarseFieldsFor("profile", { manual_labs: { bpSystolic: 190, bpDiastolic: 100 } }).alertSeverity, null);
});

async function setup(consent: boolean) {
  const clinic = await generateRecipientKeyPair();
  const keystore = new MemoryKeyStore();
  const pending = await startEnrollment(PATIENT, { iterations: 100_000 });
  const { bundle } = await finishEnrollment(pending, pending.recoveryCode, {
    keystore, clinic: { clinicId: CLINIC, publicJwk: await exportPublicJwk(clinic.publicKey), consent },
  });
  const saved: EntryRow[] = [];
  const transport: FormTransport = {
    async status() {
      return { patient_id: PATIENT, enrolled: true, recovery_confirmed_at: bundle.recovery_confirmed_at, dek_id: bundle.dek_id, wraps: bundle.wraps.filter((w) => w.recipient_type === "patient") };
    },
    async listEntries() { return saved; },
    async saveEntry(row) {
      const i = saved.findIndex((x) => x.id === row.id);
      const full = { ...row, patient_id: PATIENT };
      if (i >= 0) saved[i] = full; else saved.push(full);
    },
  };
  return { clinic, keystore, bundle, saved, transport };
}

test("forms are encrypted on device; only band and severity readable; re-save replaces", async () => {
  const { keystore, bundle, saved, transport } = await setup(false);
  await saveEncryptedForm("profile", { firstName: "Test", lastName: "Patient", sex: "female" }, { transport, keystore });
  await saveEncryptedForm("health_history", FULL_HISTORY, { transport, keystore });
  const labs = await saveEncryptedForm("manual_labs", { ...GOOD_LABS, bpSystolic: 182, bpDiastolic: 90 }, { transport, keystore });
  assert.equal(saved.length, 3);
  assert.equal(labs.alert_severity, "critical");
  assert.ok(labs.le8_band);
  const json = JSON.stringify(saved);
  for (const s of ["Test", "Patient", "182", "female", "total_cholesterol"]) assert.ok(!json.includes(s), `leaked ${s}`);
  await saveEncryptedForm("manual_labs", GOOD_LABS, { transport, keystore });
  assert.equal(saved.length, 3);
  assert.equal(saved.find((e) => e.category === "manual_labs")!.alert_severity, null);
  const dek = await unlockDataKey(bundle.wraps.find((w) => w.recipient_type === "patient")!, (await keystore.get(`uak:${PATIENT}`))!);
  const back = await decryptHealthEntry<{ firstName: string }>(saved.find((e) => e.category === "profile")!, dek);
  assert.equal(back.firstName, "Test");
  assert.equal(await formEntryId(PATIENT, "profile"), await formEntryId(PATIENT, "profile"));
  assert.match(await formEntryId(PATIENT, "profile"), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("consent at enrollment: clinic can open entries only if granted", async () => {
  for (const consent of [true, false]) {
    const { clinic, keystore, bundle, saved, transport } = await setup(consent);
    await saveEncryptedForm("profile", { firstName: "Test" }, { transport, keystore });
    const wrap = bundle.wraps.find((w) => w.recipient_type === "clinic");
    assert.equal(Boolean(wrap), consent);
    if (wrap) {
      const dek = await unlockDataKey(wrap, clinic.privateKey);
      assert.equal((await decryptHealthEntry<{ firstName: string }>(saved[0], dek)).firstName, "Test");
    }
  }
});

test("forms refuse to save before enrollment or on a locked device", async () => {
  const { transport, bundle } = await setup(false);
  await assert.rejects(saveEncryptedForm("profile", {}, { transport: { ...transport, status: async () => ({ patient_id: PATIENT, enrolled: false }) }, keystore: new MemoryKeyStore() }), NotEnrolledError);
  await assert.rejects(saveEncryptedForm("profile", {}, { transport, keystore: new MemoryKeyStore() }), DeviceLockedError);
  assert.ok(bundle.recovery_confirmed_at);
});

test("server list entries: flag off 404, no session 401, own rows only", async () => {
  const store = { getUserKey: async () => ({ active_dek_id: "d1" }), listEntries: async (p: string, d: string) => [{ patient_id: p, dek_id: d }] } as unknown as E2eStore;
  assert.equal((await handleListEntries(PATIENT, store, {})).status, 404);
  assert.equal((await handleListEntries(null, store, ON)).status, 401);
  const r = await handleListEntries(PATIENT, store, ON);
  assert.deepEqual(r.body.entries, [{ patient_id: PATIENT, dek_id: "d1" }]);
});

test("onboarding forms switch to the encrypted path only behind the flag; consent is an explicit choice", () => {
  const ui = readFileSync("src/app/onboard/OnboardClient.tsx", "utf8");
  for (const c of ['"profile"', '"health_history"', '"manual_labs"']) assert.ok(ui.includes(`saveForm(enc, "/api/onboard/`) && ui.includes(c));
  assert.match(ui, /if \(!enc\) return \{ ok: \(await postJson\(path, payload\)\)\.ok \}/);
  assert.equal((ui.match(/postJson\("\/api\/onboard\/(profile|health-history|manual-labs)"/g) ?? []).length, 0);
  assert.match(readFileSync("src/app/onboard/page.tsx", "utf8"), /encEnabled=\{isClientEncEnabled\(\)\}/);
  const setup = readFileSync("src/app/secure-setup/SecureSetup.tsx", "utf8");
  assert.match(setup, /useState<boolean \| null>\(null\)/);
  assert.match(setup, /x-csrf-token/);
});
