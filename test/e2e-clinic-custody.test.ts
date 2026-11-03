import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  combineShares, createClinicKey, decodeShare, encodeShare, isValidRecoveryKey, LOST_KEYS_NOTICE, recoveryKeyConfirmed,
  resealWithPassphrase, splitRecoveryKey, unlockWithPassphrase, unlockWithRecoveryKey, unlockWithShares,
  generateDataKey, wrapDataKey, unwrapDataKey, importPublicJwk,
} from "../src/lib/e2e";
import { handleClinicKeyCreate, handleClinicKeyStatus, MemoryClinicKeyStore } from "../src/lib/e2e-clinic-server";

// Synthetic ids only.
const CLINIC = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const ITER = 100_000;
const PASS = "synthetic-pass-phrase-1";
const ON = { NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1: "true" };
const admin = { kind: "staff" as const, clinicId: CLINIC, staffId: "s-admin", role: "provider" as const };
const staff = { kind: "staff" as const, clinicId: CLINIC, staffId: "s-staff", role: "provider" as const };

function store() {
  const s = new MemoryClinicKeyStore();
  s.staff.set("s-admin", { clinic_id: CLINIC, is_admin: true });
  s.staff.set("s-staff", { clinic_id: CLINIC, is_admin: false });
  s.staff.set("s-other", { clinic_id: OTHER, is_admin: true });
  s.staff.set("s-gone", { clinic_id: CLINIC, is_admin: true, revoked_at: "2026-01-01T00:00:00Z" });
  return s;
}

async function canOpen(pub: JsonWebKey, priv: CryptoKey) {
  const dek = await generateDataKey();
  const w = await wrapDataKey(dek, await importPublicJwk(pub), "ctx");
  const back = await unwrapDataKey(w, priv, "ctx");
  return (await crypto.subtle.exportKey("raw", back)).byteLength === 32;
}

test("clinic key: passphrase and 24-word recovery key both open the same private key", async () => {
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  assert.equal(k.recoveryKey.split(" ").length, 24);
  assert.ok(isValidRecoveryKey(k.recoveryKey));
  assert.equal(k.shares, null);
  assert.equal(k.record.custody_mode, "passphrase");
  assert.equal("d" in k.record.public_jwk, false);
  assert.ok(await canOpen(k.record.public_jwk, k.clinicPrivate));
  assert.ok(await canOpen(k.record.public_jwk, await unlockWithPassphrase(k.record, PASS)));
  assert.ok(await canOpen(k.record.public_jwk, await unlockWithRecoveryKey(k.record, `  ${k.recoveryKey.toUpperCase()} `)));
  const json = JSON.stringify(k.record);
  assert.ok(!json.includes(PASS));
  for (const w of k.recoveryKey.split(" ").slice(0, 3)) assert.ok(!json.includes(`"${w}"`));
});

test("clinic key: wrong passphrase, wrong words, or swapped clinic fail", async () => {
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  const other = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  await assert.rejects(unlockWithPassphrase(k.record, "wrong-pass-phrase-0"));
  await assert.rejects(unlockWithRecoveryKey(k.record, other.recoveryKey));
  await assert.rejects(unlockWithPassphrase({ ...k.record, clinic_id: OTHER }, PASS));
  await assert.rejects(createClinicKey({ clinicId: CLINIC, passphrase: "short" }));
});

test("clinic key: 2 of 3 split, any 2 shares rebuild, 1 share does not", async () => {
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, split: true, iterations: ITER });
  assert.equal(k.record.custody_mode, "passphrase_split_2of3");
  assert.equal(k.shares!.length, 3);
  const [a, b, c] = k.shares!;
  for (const pair of [[a, b], [a, c], [b, c]]) {
    assert.equal(await combineShares(pair), k.recoveryKey);
    assert.ok(await canOpen(k.record.public_jwk, await unlockWithShares(k.record, pair)));
  }
  await assert.rejects(combineShares([a]));
  assert.deepEqual(decodeShare(encodeShare(new Uint8Array([0, 1, 254, 255]))), new Uint8Array([0, 1, 254, 255]));
  const again = await splitRecoveryKey(k.recoveryKey);
  assert.equal(await combineShares([again[0], again[2]]), k.recoveryKey);
});

test("clinic key: recovery then new passphrase", async () => {
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  const priv = await unlockWithRecoveryKey(k.record, k.recoveryKey);
  const resealed = await resealWithPassphrase(k.record, priv, "new-synthetic-pass-2", ITER);
  const rec = { ...k.record, passphrase_sealed: resealed };
  assert.ok(await canOpen(rec.public_jwk, await unlockWithPassphrase(rec, "new-synthetic-pass-2")));
  await assert.rejects(unlockWithPassphrase(rec, PASS));
});

test("recovery key confirmation requires exact words", async () => {
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  assert.ok(recoveryKeyConfirmed(k.recoveryKey, `\n${k.recoveryKey.toUpperCase()}  `));
  const words = k.recoveryKey.split(" ");
  assert.equal(recoveryKeyConfirmed(k.recoveryKey, words.slice(0, 23).join(" ")), false);
});

test("server: flag off returns 404", async () => {
  const s = store();
  assert.equal((await handleClinicKeyStatus(admin, s, {})).status, 404);
  assert.equal((await handleClinicKeyCreate(admin, {}, s, {})).status, 404);
});

test("server: only an active admin of the clinic can save; sealed blobs only to admin", async () => {
  const s = store();
  const k = await createClinicKey({ clinicId: CLINIC, passphrase: PASS, iterations: ITER });
  const { clinic_id: _c, ...body } = k.record;
  const payload = { ...body, recovery_confirmed: true };
  assert.equal((await handleClinicKeyCreate(null, payload, s, ON)).status, 403);
  assert.equal((await handleClinicKeyCreate(staff, payload, s, ON)).status, 403);
  assert.equal((await handleClinicKeyCreate({ ...admin, staffId: "s-gone" }, payload, s, ON)).status, 403);
  assert.equal((await handleClinicKeyCreate({ ...admin, staffId: "s-other" }, payload, s, ON)).status, 403);
  assert.equal((await handleClinicKeyCreate(admin, { ...body }, s, ON)).status, 400, "recovery must be confirmed");
  assert.equal((await handleClinicKeyCreate(admin, { ...payload, public_jwk: { ...body.public_jwk, d: "x" } }, s, ON)).status, 400);
  assert.equal((await handleClinicKeyCreate(admin, payload, s, ON)).status, 200);
  assert.equal((await handleClinicKeyCreate(admin, payload, s, ON)).status, 409);
  const st = await handleClinicKeyStatus(staff, s, ON);
  assert.equal(st.body.has_key, true);
  assert.equal("passphrase_sealed" in st.body, false);
  const ad = await handleClinicKeyStatus(admin, s, ON);
  assert.ok(ad.body.passphrase_sealed);
  const back = { ...(ad.body as never as typeof k.record), clinic_id: CLINIC };
  assert.ok(await canOpen(back.public_jwk, await unlockWithPassphrase(back, PASS)));
});

test("UI and setup flow state that lost keys are unrecoverable, behind the flag", () => {
  assert.match(LOST_KEYS_NOTICE, /cannot be opened by anyone, including CareIQ/);
  const ui = readFileSync("src/app/clinic/keys/ClinicKeySetup.tsx", "utf8");
  assert.match(ui, /Lost keys are unrecoverable/);
  assert.match(ui, /LOST_KEYS_NOTICE/);
  assert.match(readFileSync("src/app/clinic/keys/page.tsx", "utf8"), /isClientEncEnabled\(\)\) notFound\(\)/);
  assert.match(readFileSync("src/app/clinic/setup/SetupForm.tsx", "utf8"), /encEnabled && /);
  const route = readFileSync("src/app/api/clinic/keys/route.ts", "utf8");
  assert.equal((route.match(/isClientEncEnabled\(\)\) return/g) ?? []).length, 2);
  const mig = readFileSync("supabase/migrations/0020_clinic_key_custody.sql", "utf8");
  assert.match(mig, /NOT APPLIED/);
});
