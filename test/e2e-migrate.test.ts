// Legacy to on-device migration (design PR 8). SYNTHETIC data only: random ids, made up values,
// a throwaway ENCRYPTION_KEY generated per run, and an in-memory store in place of Supabase.
import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");

import { encryptJson } from "../src/lib/crypto";
import {
  decryptHealthEntry, DeviceLockedError, exportPublicJwk, finishEnrollment, formEntryId, generateRecipientKeyPair, legacyEntryId,
  MemoryKeyStore, NotEnrolledError, runMigration, saveEncryptedForm, startEnrollment, unlockDataKey,
  type EntryRow, type FormTransport, type MigrationApi,
} from "../src/lib/e2e";
import { handleEnroll, handleEntry, handleStatus, type E2eStore } from "../src/lib/e2e-server";
import { handleMigrate, splitHistory, type LegacyRows, type MigrateStore } from "../src/lib/e2e-migrate-server";

const ON = { NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1: "true" };

class MemDb {
  userKeys = new Map<string, any>();
  wraps: any[] = [];
  entries = new Map<string, any>();
  ledger: any[] = [];
  legacy = new Map<string, LegacyRows>();
  audits: any[] = [];
  e2e(): E2eStore {
    return {
      getUserKey: async (p) => this.userKeys.get(p) ?? null,
      getWraps: async (p, d) => this.wraps.filter((w) => w.patient_id === p && w.dek_id === d),
      getClinicPublicKey: async () => null,
      enroll: async (p, b) => {
        this.userKeys.set(p, { active_dek_id: b.dek_id, recovery_confirmed_at: b.recovery_confirmed_at, public_jwk: b.public_jwk, recovery_sealed: b.recovery });
        for (const w of b.wraps) this.wraps.push({ ...w, patient_id: p });
      },
      saveEntry: async (p, e) => { this.entries.set(e.id, structuredClone({ ...e, patient_id: p })); },
      listEntries: async (p, d) => [...this.entries.values()].filter((e) => e.patient_id === p && e.dek_id === d),
      withdraw: async () => { throw new Error("unused"); },
    };
  }
  mig(): MigrateStore {
    return {
      getUserKey: async (p) => this.userKeys.get(p) ?? null,
      listLegacy: async (p) => structuredClone(this.legacy.get(p) ?? { profile: null, history: null, biomarkers: [], wearables: [] }),
      listLedger: async (p) => this.ledger.filter((r) => r.patient_id === p),
      getEntries: async (p, ids) => ids.map((i) => this.entries.get(i)).filter((e) => e && e.patient_id === p).map((e) => structuredClone(e)),
      markMigrated: async (p, rows) => {
        for (const r of rows) if (!this.ledger.some((l) => l.patient_id === p && l.source === r.source && l.source_id === r.source_id)) this.ledger.push({ ...r, patient_id: p });
      },
    };
  }
}

async function setup(consent: boolean) {
  const db = new MemDb();
  const patient = randomUUID();
  const clinicId = randomUUID();
  const clinic = await generateRecipientKeyPair();
  const keystore = new MemoryKeyStore();
  const pending = await startEnrollment(patient, { iterations: 100_000 });
  const { bundle } = await finishEnrollment(pending, pending.recoveryCode, {
    keystore, clinic: { clinicId, publicJwk: await exportPublicJwk(clinic.publicKey), consent },
  });
  const { patient_id: _x, ...body } = bundle;
  assert.equal((await handleEnroll(patient, body, db.e2e(), ON)).status, 200);

  const histId = randomUUID(), b1 = randomUUID(), b2 = randomUUID(), w1 = randomUUID();
  db.legacy.set(patient, {
    profile: encryptJson({ firstName: "Synthetic", lastName: "Tester", sex: "female", dateOfBirth: "1970-01-01" }, `profile:${patient}`),
    history: { id: histId, data_encrypted: encryptJson({
      chronicConditions: ["none"], familyHistory: "synthetic",
      manualLabs: { a1c: 5.4 }, biomarkers: { ldl: { value: 101, date_collected: "2026-01-02", source: "lab" } }, last_panel_grade: "B",
    }, `history:${patient}`) },
    biomarkers: [
      { id: b1, biomarker_key: "ldl", date_collected: "2026-01-02", source: "lab", value_encrypted: encryptJson({ value: 101 }, `biomarker_log:${patient}:ldl`) },
      { id: b2, biomarker_key: "a1c", date_collected: "2026-01-02", source: "self_reported", value_encrypted: encryptJson({ value: 5.4 }, `biomarker_log:${patient}:a1c`) },
    ],
    wearables: [{ id: w1, device_type: "generic", uploaded_at: "2026-01-03T00:00:00Z", data_encrypted: encryptJson({ device: "generic", metrics: [{ steps: 1234 }] }, `wearable:${patient}`) }],
  });
  // A second synthetic patient whose rows must never be returned.
  const other = randomUUID();
  db.legacy.set(other, { profile: encryptJson({ firstName: "Other" }, `profile:${other}`), history: null, biomarkers: [], wearables: [] });

  const sid = (s: any) => `${s.source}:${s.source_id}`;
  const api = (opts: { failSaveAfter?: number; corrupt?: boolean } = {}): MigrationApi => {
    let saves = 0;
    const call = async (body: unknown) => {
      const r = await handleMigrate(patient, body, db.mig(), async (a) => { db.audits.push(a); }, ON);
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      return r.body as any;
    };
    return {
      status: async () => ({ ...(await handleStatus(patient, db.e2e(), ON)).body }) as any,
      pending: async () => (await call({ action: "pending" })).items,
      readEntries: async (ids) => (ids.length ? (await call({ action: "read", ids })).entries : []),
      saveEntry: async (row) => {
        if (opts.failSaveAfter !== undefined && saves >= opts.failSaveAfter) throw new Error("network down");
        saves++;
        const r = await handleEntry(patient, row, db.e2e(), ON);
        if (r.status !== 200) throw new Error("save failed");
        if (opts.corrupt) { const e = db.entries.get(row.id); e.envelope.ct = Buffer.from("tampered!").toString("base64"); }
      },
      mark: async (items) => { await call({ action: "mark", items }); },
      report: async (r) => { await call({ action: "report", ...r }); },
    };
  };
  const dek = async () => unlockDataKey(bundle.wraps.find((w) => w.recipient_type === "patient")!, (await keystore.get(`uak:${patient}`))!);
  return { db, patient, other, clinic, clinicId, keystore, bundle, api, dek, histId, sid };
}

test("full run on synthetic rows: re-encrypts, verifies, marks, keeps legacy rows, honors consent", async () => {
  const s = await setup(true);
  const before = JSON.stringify(s.db.legacy.get(s.patient));
  const seen: string[] = [];
  const res = await runMigration({ api: s.api(), keystore: s.keystore, onProgress: (p) => seen.push(p.message) });
  assert.deepEqual(res, { migrated: 6, superseded: 0, failed: 0, outcome: "complete" });
  assert.equal(JSON.stringify(s.db.legacy.get(s.patient)), before, "legacy rows untouched");
  assert.equal(s.db.ledger.length, 6);
  assert.ok(s.db.ledger.every((l) => l.patient_id === s.patient && l.outcome === "migrated"));
  assert.ok(seen.at(-1)!.startsWith("All done"));

  const dek = await s.dek();
  const prof = s.db.entries.get(await formEntryId(s.patient, "profile"));
  assert.equal((await decryptHealthEntry<any>(prof, dek)).firstName, "Synthetic");
  const labs = await decryptHealthEntry<any>(s.db.entries.get(await formEntryId(s.patient, "manual_labs")), dek);
  assert.deepEqual(labs.biomarkers.a1c, { value: 5.4 });
  assert.equal(labs.biomarkers.ldl.value, 101);
  const hist = await decryptHealthEntry<any>(s.db.entries.get(await formEntryId(s.patient, "health_history")), dek);
  assert.equal(hist.manualLabs, undefined);
  assert.equal(hist.familyHistory, "synthetic");
  assert.equal(s.db.entries.get(await formEntryId(s.patient, "manual_labs")).alert_severity, null);
  for (const e of s.db.entries.values()) {
    assert.equal(e.patient_id, s.patient);
    assert.ok(!JSON.stringify(e).includes("Synthetic"), "no plaintext stored");
  }

  // Clinic consented at enrollment, so the clinic wrap opens migrated entries. No new wraps were added.
  assert.equal(s.db.wraps.length, 2);
  const cdek = await unlockDataKey(s.db.wraps.find((w) => w.recipient_type === "clinic"), s.clinic.privateKey);
  assert.equal((await decryptHealthEntry<any>(prof, cdek)).lastName, "Tester");

  // Audit holds counts and outcome only.
  const fin = s.db.audits.find((a) => a.action === "patient.e2e.migration.finished");
  assert.deepEqual(fin.metadata, { migrated_count: 6, superseded_count: 0, failed_count: 0, outcome: "complete" });
  assert.ok(!JSON.stringify(s.db.audits).includes("Synthetic"));

  // Idempotent: a second run finds nothing and writes nothing.
  const n = s.db.entries.size;
  const again = await runMigration({ api: s.api(), keystore: s.keystore });
  assert.deepEqual(again, { migrated: 0, superseded: 0, failed: 0, outcome: "complete" });
  assert.equal(s.db.entries.size, n);
});

test("no clinic consent: migrated entries carry no clinic wrap", async () => {
  const s = await setup(false);
  await runMigration({ api: s.api(), keystore: s.keystore });
  assert.equal(s.db.wraps.filter((w) => w.recipient_type === "clinic").length, 0);
  assert.equal(s.db.wraps.length, 1);
});

test("resumable: stops partway, rerun finishes with no duplicates", async () => {
  const s = await setup(true);
  const r1 = await runMigration({ api: s.api({ failSaveAfter: 2 }), keystore: s.keystore });
  assert.equal(r1.outcome, "partial");
  assert.equal(r1.migrated, 2);
  assert.equal(s.db.ledger.length, 2);
  const r2 = await runMigration({ api: s.api(), keystore: s.keystore });
  assert.equal(r2.outcome, "complete");
  assert.equal(r2.migrated, 4);
  assert.equal(s.db.ledger.length, 6);
  assert.equal(s.db.entries.size, 6);
});

test("crash between write and mark: rerun verifies the existing entry and marks it migrated", async () => {
  const s = await setup(true);
  const a = s.api();
  await runMigration({ api: { ...a, mark: async () => { throw new Error("lost"); } }, keystore: s.keystore }).catch(() => undefined);
  assert.equal(s.db.ledger.length, 0);
  const r = await runMigration({ api: s.api(), keystore: s.keystore });
  assert.deepEqual(r, { migrated: 6, superseded: 0, failed: 0, outcome: "complete" });
});

test("a newer encrypted form wins: legacy copy is marked superseded, not overwritten", async () => {
  const s = await setup(true);
  const transport: FormTransport = {
    status: async () => (await handleStatus(s.patient, s.db.e2e(), ON)).body as any,
    listEntries: async () => [...s.db.entries.values()],
    saveEntry: async (row) => { await handleEntry(s.patient, row, s.db.e2e(), ON); },
  };
  await saveEncryptedForm("profile", { firstName: "Newer" }, { transport, keystore: s.keystore });
  const r = await runMigration({ api: s.api(), keystore: s.keystore });
  assert.deepEqual(r, { migrated: 5, superseded: 1, failed: 0, outcome: "complete" });
  const prof = s.db.entries.get(await formEntryId(s.patient, "profile"));
  assert.equal((await decryptHealthEntry<any>(prof, await s.dek())).firstName, "Newer");
});

test("read-back failure is never marked migrated", async () => {
  const s = await setup(true);
  const r = await runMigration({ api: s.api({ corrupt: true }), keystore: s.keystore });
  assert.equal(r.outcome, "failed");
  assert.equal(r.failed, 6);
  assert.equal(s.db.ledger.length, 0);
});

test("unreadable legacy row is skipped and counted, others still move", async () => {
  const s = await setup(true);
  const rows = s.db.legacy.get(s.patient)!;
  rows.wearables[0].data_encrypted = encryptJson({ x: 1 }, `wearable:${s.other}`); // wrong patient AAD
  const r = await runMigration({ api: s.api(), keystore: s.keystore });
  assert.deepEqual(r, { migrated: 5, superseded: 0, failed: 1, outcome: "partial" });
});

test("requires confirmed recovery code and an unlocked device", async () => {
  const s = await setup(true);
  await assert.rejects(runMigration({ api: s.api(), keystore: new MemoryKeyStore() }), DeviceLockedError);
  const api = s.api();
  await assert.rejects(runMigration({ api: { ...api, status: async () => ({ patient_id: s.patient, enrolled: false }) }, keystore: s.keystore }), NotEnrolledError);
  // Server side: not enrolled means no legacy row is opened.
  const fresh = new MemDb();
  fresh.legacy = s.db.legacy;
  const r = await handleMigrate(s.patient, { action: "pending" }, fresh.mig(), async () => undefined, ON);
  assert.equal(r.status, 403);
});

test("server gates: flag, session, own rows only, entry checks before marking", async () => {
  const s = await setup(true);
  const audit = async () => undefined;
  assert.equal((await handleMigrate(s.patient, { action: "pending" }, s.db.mig(), audit, {})).status, 404);
  assert.equal((await handleMigrate(null, { action: "pending" }, s.db.mig(), audit, ON)).status, 401);
  assert.equal((await handleMigrate(s.patient, { action: "nope" }, s.db.mig(), audit, ON)).status, 400);
  const items = (await handleMigrate(s.patient, { action: "pending" }, s.db.mig(), audit, ON)).body.items as any[];
  assert.equal(items.length, 6);
  assert.ok(!JSON.stringify(items).includes("Other"));
  const it = items.find((i) => i.source === "biomarker_log");
  const entry_id = await legacyEntryId(s.patient, it.source, it.source_id);
  const mark = (x: any) => handleMigrate(s.patient, { action: "mark", items: [x] }, s.db.mig(), audit, ON);
  assert.equal((await mark({ source: it.source, source_id: it.source_id, entry_id, outcome: "migrated" })).status, 409);
  assert.equal((await mark({ source: it.source, source_id: it.source_id, entry_id: randomUUID(), outcome: "migrated" })).status, 400);
  // Another patient's entry with the right id cannot be used to mark this patient's row.
  s.db.entries.set(entry_id, { id: entry_id, patient_id: s.other, category: "biomarker_log", dek_id: s.bundle.dek_id, envelope: { v: 1, kid: s.bundle.dek_id, iv: "AA==", ct: "AA==" } });
  assert.equal((await mark({ source: it.source, source_id: it.source_id, entry_id, outcome: "migrated" })).status, 409);
  assert.equal(s.db.ledger.length, 0);
});

test("history split keeps lab values out of the history entry", () => {
  const { history, labs } = splitHistory({ a: 1, manualLabs: { fastingGlucose: 90, junk: 3 }, biomarkers: { hdl: { value: 50 } }, bpSystolic: 120 });
  assert.deepEqual(history, { a: 1 });
  assert.deepEqual(labs, { biomarkers: { fasting_glucose: { value: 90 }, hdl: { value: 50 } }, bpSystolic: 120 });
  assert.equal(splitHistory({ a: 1 }).labs, null);
});

test("migrate route is POST only (CSRF checked by middleware) and behind the flag", () => {
  const src = readFileSync("src/app/api/e2e/migrate/route.ts", "utf8");
  assert.match(src, /export async function POST/);
  assert.doesNotMatch(src, /export async function GET/);
  assert.match(src, /isClientEncEnabled\(\)/);
  const page = readFileSync("src/app/secure-setup/migrate/page.tsx", "utf8");
  assert.match(page, /notFound\(\)/);
});

test("migration code never deletes legacy rows", () => {
  for (const f of ["src/lib/e2e-migrate-store.ts", "src/lib/e2e-migrate-server.ts", "src/lib/e2e/migrate.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /\.delete\(|\.update\(/);
  }
});
