import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAad, decryptJson, decryptString, deriveKeyFromPassphrase, encryptJson, encryptString,
  exportPublicJwk, generateDataKey, generateRecipientKeyPair, importPublicJwk, MemoryKeyStore,
  openPrivateKey, sealPrivateKey, unwrapDataKey, wrapDataKey,
} from "../src/lib/e2e";

const aad = buildAad({ table: "health_history", rowId: "r1", patientId: "p1" });

test("encrypt and decrypt round trip with AAD", async () => {
  const k = await generateDataKey();
  const env = await encryptJson(k, "dek1", { a1c: 5.6 }, aad);
  assert.equal(env.v, 1);
  assert.deepEqual(await decryptJson(k, env, aad), { a1c: 5.6 });
});

test("fresh IV per call", async () => {
  const k = await generateDataKey();
  const a = await encryptString(k, "d", "x", aad);
  const b = await encryptString(k, "d", "x", aad);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test("wrong AAD, wrong key, and tampering fail", async () => {
  const k = await generateDataKey();
  const env = await encryptString(k, "d", "secret", aad);
  await assert.rejects(decryptString(k, env, buildAad({ table: "health_history", rowId: "r2", patientId: "p1" })));
  await assert.rejects(decryptString(await generateDataKey(), env, aad));
  const bad = { ...env, ct: env.ct.slice(0, -4) + (env.ct.endsWith("AAAA") ? "BBBB" : "AAAA") };
  await assert.rejects(decryptString(k, bad, aad));
});

test("device private keys are non-extractable", async () => {
  const pair = await generateRecipientKeyPair();
  assert.equal(pair.privateKey.extractable, false);
  await assert.rejects(crypto.subtle.exportKey("jwk", pair.privateKey));
});

test("wrap DEK to patient, clinic, and family; only recipients unwrap", async () => {
  const dek = await generateDataKey();
  const env = await encryptString(dek, "dek1", "labs", aad);
  const patient = await generateRecipientKeyPair();
  const clinic = await generateRecipientKeyPair();
  const family = await generateRecipientKeyPair();
  const outsider = await generateRecipientKeyPair();
  for (const r of [patient, clinic, family]) {
    const pub = await importPublicJwk(await exportPublicJwk(r.publicKey));
    const w = await wrapDataKey(dek, pub, "dek1:recipient");
    const k = await unwrapDataKey(w, r.privateKey, "dek1:recipient");
    assert.equal(await decryptString(k, env, aad), "labs");
    await assert.rejects(unwrapDataKey(w, outsider.privateKey, "dek1:recipient"));
    await assert.rejects(unwrapDataKey(w, r.privateKey, "dek1:other"));
  }
});

test("clinic root key sealed by passphrase reopens; wrong passphrase fails", async () => {
  const root = await generateRecipientKeyPair(true);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const seal = await deriveKeyFromPassphrase("correct horse battery", salt, 1000);
  const sealed = await sealPrivateKey(root.privateKey, seal, "clinic:c1");
  const reopened = await openPrivateKey(sealed, seal, "clinic:c1");
  assert.equal(reopened.extractable, false);
  const wrong = await deriveKeyFromPassphrase("wrong horse battery", salt, 1000);
  await assert.rejects(openPrivateKey(sealed, wrong, "clinic:c1"));
  await assert.rejects(deriveKeyFromPassphrase("short", salt, 1000));
});

test("memory keystore", async () => {
  const s = new MemoryKeyStore();
  const k = await generateDataKey();
  await s.put("a", k);
  assert.equal(await s.get("a"), k);
  await s.delete("a");
  assert.equal(await s.get("a"), undefined);
});
