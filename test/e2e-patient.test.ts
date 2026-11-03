import assert from "node:assert/strict";
import test from "node:test";
import {
  accountKeyId, assertCanEnterHealthData, decryptHealthEntry, encryptHealthEntry, exportPublicJwk,
  finishEnrollment, formatRecoveryCode, generateRecipientKeyPair, generateRecoveryCode, grantClinicConsent,
  isClientEncEnabled, isWellFormedRecoveryCode, MemoryKeyStore, normalizeRecoveryCode, recoverAccount,
  recoveryCodesMatch, RecoveryNotConfirmedError, startEnrollment, unlockDataKey, withdrawClinicConsent,
  type EntryRow,
} from "../src/lib/e2e";
import { handleEnroll, handleEntry, handleStatus, handleWithdraw, type E2eStore } from "../src/lib/e2e-server";

// Synthetic ids and values only.
const PATIENT = "11111111-1111-4111-8111-111111111111";
const CLINIC = "22222222-2222-4222-8222-222222222222";
const FAMILY = "33333333-3333-4333-8333-333333333333";
const ITER = 100_000;
const ON = { NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1: "true" };

async function party() {
  const pair = await generateRecipientKeyPair();
  return { priv: pair.privateKey, pub: await exportPublicJwk(pair.publicKey) };
}

async function enrolled(opts: { consent?: boolean; family?: boolean } = {}) {
  const clinic = await party();
  const fam = await party();
  const keystore = new MemoryKeyStore();
  const pending = await startEnrollment(PATIENT, { iterations: ITER });
  const { bundle, dek } = await finishEnrollment(pending, pending.recoveryCode, {
    keystore,
    clinic: { clinicId: CLINIC, publicJwk: clinic.pub, consent: opts.consent ?? false },
    family: opts.family ? [{ id: FAMILY, publicJwk: fam.pub }] : [],
  });
  return { clinic, fam, keystore, pending, bundle, dek };
}

test("flag is off unless exactly true", () => {
  for (const v of [undefined, "", "1", "TRUE", " true", "false", "yes"]) assert.equal(isClientEncEnabled({ NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1: v }), false);
  assert.equal(isClientEncEnabled({}), false);
  assert.equal(isClientEncEnabled(ON), true);
});

test("recovery code format, normalization, and matching", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const c = generateRecoveryCode();
    assert.match(c, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/);
    assert.ok(isWellFormedRecoveryCode(c));
    codes.add(c);
  }
  assert.equal(codes.size, 50);
  const c = generateRecoveryCode();
  assert.ok(recoveryCodesMatch(c, c.toLowerCase().replace(/-/g, " ")));
  assert.equal(normalizeRecoveryCode("o0-il"), "0011");
  assert.equal(formatRecoveryCode("abcdefgh"), "ABCD-EFGH");
  assert.ok(!recoveryCodesMatch(c, c.slice(0, -1) + (c.endsWith("0") ? "1" : "0")));
  assert.ok(!isWellFormedRecoveryCode("ABCD"));
  assert.ok(!isWellFormedRecoveryCode("U".repeat(32)));
});

test("enrollment requires typing the recovery code back", async () => {
  const pending = await startEnrollment(PATIENT, { iterations: ITER });
  const keystore = new MemoryKeyStore();
  await assert.rejects(finishEnrollment(pending, "", { keystore }), RecoveryNotConfirmedError);
  await assert.rejects(finishEnrollment(pending, generateRecoveryCode(), { keystore }), RecoveryNotConfirmedError);
  assert.equal(await keystore.get(accountKeyId(PATIENT)), undefined);
  assert.throws(() => assertCanEnterHealthData(null), RecoveryNotConfirmedError);
  assert.throws(() => assertCanEnterHealthData({ recovery_confirmed_at: null }), RecoveryNotConfirmedError);
  const { bundle } = await finishEnrollment(pending, pending.recoveryCode.toLowerCase(), { keystore });
  assert.doesNotThrow(() => assertCanEnterHealthData(bundle));
  const k = await keystore.get(accountKeyId(PATIENT));
  assert.ok(k);
  assert.equal(k.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("jwk", k));
});

test("bundle never carries the recovery code or private key material", async () => {
  const { bundle, pending } = await enrolled({ consent: true, family: true });
  const json = JSON.stringify(bundle);
  assert.ok(!json.includes(normalizeRecoveryCode(pending.recoveryCode)));
  assert.ok(!json.includes(pending.recoveryCode));
  assert.ok(!/"d":/.test(json));
});

test("solo patient: no clinic wrap without consent", async () => {
  const { bundle } = await enrolled({ consent: false });
  assert.deepEqual(bundle.wraps.map((w) => w.recipient_type), ["patient"]);
  assert.deepEqual(bundle.clinic_consent, { clinic_id: CLINIC, granted: false });
});

test("health entry round trip for patient, consented clinic, and family", async () => {
  const { bundle, keystore, clinic, fam, dek } = await enrolled({ consent: true, family: true });
  const data = { systolic: 128, diastolic: 82, note: "synthetic reading" };
  const row = await encryptHealthEntry({ patientId: PATIENT, category: "vitals", dekId: bundle.dek_id, dek, data, le8Band: "moderate", alertSeverity: "informational" });
  assert.ok(!JSON.stringify(row).includes("128"));
  assert.equal(row.le8_band, "moderate");
  const patientKey = (await keystore.get(accountKeyId(PATIENT)))!;
  const byType = (t: string) => bundle.wraps.find((w) => w.recipient_type === t)!;
  for (const [t, priv] of [["patient", patientKey], ["clinic", clinic.priv], ["family", fam.priv]] as const) {
    const k = await unlockDataKey(byType(t), priv);
    assert.deepEqual(await decryptHealthEntry(row, k), data);
  }
});

test("wrong key, wrong recipient, swapped row, and tampering all fail", async () => {
  const { bundle, keystore, clinic, dek } = await enrolled({ consent: true });
  const row = await encryptHealthEntry({ patientId: PATIENT, category: "labs", dekId: bundle.dek_id, dek, data: { a1c: 5.4 } });
  const stranger = await party();
  const patientWrap = bundle.wraps.find((w) => w.recipient_type === "patient")!;
  await assert.rejects(unlockDataKey(patientWrap, stranger.priv));
  await assert.rejects(unlockDataKey(patientWrap, clinic.priv));
  await assert.rejects(unlockDataKey({ ...patientWrap, recipient_id: FAMILY }, (await keystore.get(accountKeyId(PATIENT)))!));
  const other = await enrolled();
  await assert.rejects(decryptHealthEntry(row, other.dek));
  await assert.rejects(decryptHealthEntry({ ...row, id: crypto.randomUUID() }, dek));
  await assert.rejects(decryptHealthEntry({ ...row, patient_id: FAMILY }, dek));
  await assert.rejects(decryptHealthEntry({ ...row, category: "vitals" }, dek));
  const ct = Buffer.from(row.envelope.ct, "base64"); ct[0] ^= 1;
  await assert.rejects(decryptHealthEntry({ ...row, envelope: { ...row.envelope, ct: ct.toString("base64") } }, dek));
  await assert.rejects(decryptHealthEntry({ ...row, dek_id: crypto.randomUUID() }, dek));
});

test("only fixed band and severity values may stay readable", async () => {
  const { bundle, dek } = await enrolled();
  const base = { patientId: PATIENT, category: "vitals", dekId: bundle.dek_id, dek, data: {} };
  await assert.rejects(encryptHealthEntry({ ...base, le8Band: "72" as never }));
  await assert.rejects(encryptHealthEntry({ ...base, alertSeverity: "bp 180/120" as never }));
  await assert.rejects(encryptHealthEntry({ ...base, category: "Vitals; drop" }));
});

test("recovery on a new device with the code, and wrong code fails", async () => {
  const { bundle, pending, dek } = await enrolled();
  const row = await encryptHealthEntry({ patientId: PATIENT, category: "history", dekId: bundle.dek_id, dek, data: { smoker: false } });
  const newDevice = new MemoryKeyStore();
  await assert.rejects(recoverAccount(PATIENT, bundle.recovery, generateRecoveryCode(), newDevice));
  await assert.rejects(recoverAccount(FAMILY, bundle.recovery, pending.recoveryCode, newDevice));
  await assert.rejects(recoverAccount(PATIENT, bundle.recovery, "not a code", newDevice));
  assert.equal(await newDevice.get(accountKeyId(PATIENT)), undefined);
  const priv = await recoverAccount(PATIENT, bundle.recovery, pending.recoveryCode.replace(/-/g, " ").toLowerCase(), newDevice);
  assert.equal(priv.extractable, false);
  const k = await unlockDataKey(bundle.wraps[0], priv);
  assert.deepEqual(await decryptHealthEntry(row, k), { smoker: false });
});

test("consent withdrawal rotates the key so the clinic wrap opens nothing new", async () => {
  const { bundle, keystore, clinic, fam, dek, pending } = await enrolled({ consent: true, family: true });
  const rows: EntryRow[] = [];
  for (const v of [120, 130]) rows.push(await encryptHealthEntry({ patientId: PATIENT, category: "vitals", dekId: bundle.dek_id, dek, data: { systolic: v }, alertSeverity: "high" }));
  const oldClinicWrap = bundle.wraps.find((w) => w.recipient_type === "clinic")!;
  const out = await withdrawClinicConsent({
    patientId: PATIENT, patientPublicJwk: pending.accountPublicJwk, oldDek: dek, oldDekId: bundle.dek_id,
    entries: rows, family: [{ id: FAMILY, publicJwk: fam.pub }],
  });
  assert.notEqual(out.dekId, bundle.dek_id);
  assert.deepEqual(out.wraps.map((w) => w.recipient_type).sort(), ["family", "patient"]);
  assert.equal(out.deleteWrapsForDekId, bundle.dek_id);
  const clinicOld = await unlockDataKey(oldClinicWrap, clinic.priv);
  for (const r of out.entries) {
    assert.equal(r.alert_severity, "high");
    await assert.rejects(decryptHealthEntry(r, clinicOld));
  }
  const pk = await unlockDataKey(out.wraps.find((w) => w.recipient_type === "patient")!, (await keystore.get(accountKeyId(PATIENT)))!);
  const fk = await unlockDataKey(out.wraps.find((w) => w.recipient_type === "family")!, fam.priv);
  assert.deepEqual(await Promise.all(out.entries.map((r) => decryptHealthEntry(r, pk))), [{ systolic: 120 }, { systolic: 130 }]);
  assert.deepEqual(await decryptHealthEntry(out.entries[1], fk), { systolic: 130 });
  // Re-grant later is possible with a fresh wrap of the new key.
  const regrant = await grantClinicConsent(out.dek, out.dekId, { clinicId: CLINIC, publicJwk: clinic.pub });
  assert.deepEqual(await decryptHealthEntry(out.entries[0], await unlockDataKey(regrant, clinic.priv)), { systolic: 120 });
});

function memStore(): E2eStore & { state: Record<string, unknown> } {
  const state: Record<string, any> = { key: null, wraps: [], entries: [], consents: [] };
  return {
    state,
    async getUserKey() { return state.key; },
    async getWraps(_p, d) { return state.wraps.filter((w: any) => w.dek_id === d); },
    async getClinicPublicKey() { return null; },
    async enroll(_p, b) {
      state.key = { active_dek_id: b.dek_id, recovery_confirmed_at: b.recovery_confirmed_at, public_jwk: b.public_jwk, recovery_sealed: b.recovery };
      state.wraps.push(...b.wraps);
    },
    async saveEntry(_p, e) { state.entries.push(e); },
    async withdraw(_p, w) {
      state.wraps = state.wraps.filter((x: any) => x.dek_id !== w.old_dek_id).concat(w.wraps);
      state.key.active_dek_id = w.new_dek_id;
      state.entries = w.entries;
    },
  };
}

test("server handlers are 404 while the flag is off", async () => {
  const s = memStore();
  for (const r of [await handleStatus(PATIENT, s, {}), await handleEnroll(PATIENT, {}, s, {}), await handleEntry(PATIENT, {}, s, {}), await handleWithdraw(PATIENT, {}, s, {})]) assert.equal(r.status, 404);
});

test("server handlers: enroll, gate, entries, consent rules, withdrawal", async () => {
  const s = memStore();
  const { bundle, dek, pending, fam } = await enrolled({ consent: true });
  const { patient_id: _ignored, ...body } = bundle;
  assert.equal((await handleEnroll(null, body, s, ON)).status, 401);
  const entry = await encryptHealthEntry({ patientId: PATIENT, category: "vitals", dekId: bundle.dek_id, dek, data: { systolic: 140 } });
  const { patient_id: _p, ...entryBody } = entry;
  assert.equal((await handleEntry(PATIENT, entryBody, s, ON)).status, 403, "no entries before recovery is confirmed");
  // Clinic wrap without consent is rejected.
  assert.equal((await handleEnroll(PATIENT, { ...body, clinic_consent: { clinic_id: CLINIC, granted: false } }, s, ON)).status, 400);
  // Private key material is rejected.
  assert.equal((await handleEnroll(PATIENT, { ...body, public_jwk: { ...body.public_jwk, d: "x" } }, s, ON)).status, 400);
  // Plaintext fields are rejected.
  assert.equal((await handleEnroll(PATIENT, { ...body, recovery_code: pending.recoveryCode }, s, ON)).status, 400);
  assert.equal((await handleEnroll(PATIENT, body, s, ON)).status, 200);
  assert.equal((await handleEnroll(PATIENT, body, s, ON)).status, 409);
  assert.equal((await handleEntry(PATIENT, { ...entryBody, systolic: 140 }, s, ON)).status, 400);
  assert.equal((await handleEntry(PATIENT, { ...entryBody, le8_band: "72" }, s, ON)).status, 400);
  assert.equal((await handleEntry(PATIENT, entryBody, s, ON)).status, 200);
  const st = await handleStatus(PATIENT, s, ON);
  assert.equal(st.body.enrolled, true);
  assert.equal((st.body.wraps as unknown[]).length, 1);

  const out = await withdrawClinicConsent({ patientId: PATIENT, patientPublicJwk: pending.accountPublicJwk, oldDek: dek, oldDekId: bundle.dek_id, entries: [entry], family: [{ id: FAMILY, publicJwk: fam.pub }] });
  const strip = (r: EntryRow) => { const { patient_id: _x, ...rest } = r; return rest; };
  const w = { clinic_id: CLINIC, new_dek_id: out.dekId, old_dek_id: bundle.dek_id, wraps: out.wraps, entries: out.entries.map(strip) };
  assert.equal((await handleWithdraw(PATIENT, { ...w, wraps: [...out.wraps, bundle.wraps.find((x) => x.recipient_type === "clinic")] }, s, ON)).status, 400);
  assert.equal((await handleWithdraw(PATIENT, { ...w, entries: [entryBody] }, s, ON)).status, 400);
  assert.equal((await handleWithdraw(PATIENT, w, s, ON)).status, 200);
  assert.equal((await handleWithdraw(PATIENT, w, s, ON)).status, 409);
  assert.equal((await handleEntry(PATIENT, entryBody, s, ON)).status, 409, "old key is stale after rotation");
});
