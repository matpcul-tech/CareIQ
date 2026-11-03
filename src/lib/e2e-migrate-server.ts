/**
 * Server side of the patient-run legacy migration (design PR 8). Every handler returns 404 while
 * NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is off. The route is POST only, so the middleware CSRF check applies.
 *
 * - Opens legacy rows only for the signed-in patient, with that patient's own AAD, and only after
 *   the patient has a confirmed recovery code.
 * - Never writes or deletes legacy rows. It records a ledger row only after the device has written
 *   the encrypted entry (checked here: same patient, active data key, expected category and id).
 * - The audit log gets counts and outcome only.
 */
import { decryptJson } from "@/lib/crypto";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import { envelopeSchema } from "@/lib/e2e/schema";
import { LEGACY_SOURCES, SOURCE_CATEGORY, legacyEntryId, type LegacyItem, type LegacySource } from "@/lib/e2e/migrate";
import { z } from "zod";
import type { Result } from "@/lib/e2e-server";

export interface LegacyRows {
  profile: string | null;
  history: { id: string; data_encrypted: string } | null;
  biomarkers: Array<{ id: string; biomarker_key: string; date_collected: string; source: string; value_encrypted: string }>;
  wearables: Array<{ id: string; device_type: string; uploaded_at: string; data_encrypted: string }>;
}

export interface MigrateStore {
  getUserKey(patientId: string): Promise<{ active_dek_id: string; recovery_confirmed_at: string } | null>;
  listLegacy(patientId: string): Promise<LegacyRows>;
  listLedger(patientId: string): Promise<Array<{ source: string; source_id: string }>>;
  getEntries(patientId: string, ids: string[]): Promise<Array<{ id: string; patient_id: string; category: string; dek_id: string; envelope: unknown; le8_band: string | null; alert_severity: string | null }>>;
  markMigrated(patientId: string, rows: Array<{ source: string; source_id: string; entry_id: string; outcome: string }>): Promise<void>;
}

export type MigrationAudit = (e: { action: "patient.e2e.migration.read" | "patient.e2e.migration.finished"; success: boolean; metadata: Record<string, string | number> }) => Promise<void>;

const NOT_FOUND: Result = { status: 404, body: { error: "not found" } };
export const PENDING_BATCH = 100;
const LAB_KEYS = ["biomarkers", "manualLabs", "last_panel_grade", "bpSystolic", "bpDiastolic", "weight", "height"] as const;
const LEGACY_TO_CANONICAL: Record<string, string> = { a1c: "a1c", ldl: "ldl", hdl: "hdl", fastingGlucose: "fasting_glucose", triglycerides: "triglycerides", egfr: "egfr" };

const uuid = z.string().uuid();
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pending") }).strict(),
  z.object({ action: z.literal("read"), ids: z.array(uuid).min(1).max(PENDING_BATCH + 10) }).strict(),
  z.object({
    action: z.literal("mark"),
    items: z.array(z.object({ source: z.enum(LEGACY_SOURCES), source_id: uuid, entry_id: uuid, outcome: z.enum(["migrated", "superseded"]) }).strict()).min(1).max(PENDING_BATCH),
  }).strict(),
  z.object({
    action: z.literal("report"),
    migrated: z.number().int().min(0).max(1_000_000), superseded: z.number().int().min(0).max(1_000_000), failed: z.number().int().min(0).max(1_000_000),
    outcome: z.enum(["complete", "partial", "failed"]),
  }).strict(),
]);

/** Split the legacy history blob: lab values go to the manual_labs entry, the rest to health_history. */
export function splitHistory(blob: Record<string, unknown>): { history: Record<string, unknown>; labs: Record<string, unknown> | null } {
  const history: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(blob)) if (!(LAB_KEYS as readonly string[]).includes(k)) history[k] = v;
  const biomarkers: Record<string, unknown> = {};
  const legacy = blob.manualLabs && typeof blob.manualLabs === "object" ? (blob.manualLabs as Record<string, unknown>) : {};
  for (const [k, v] of Object.entries(legacy)) {
    const c = LEGACY_TO_CANONICAL[k];
    if (c && typeof v === "number" && Number.isFinite(v)) biomarkers[c] = { value: v };
  }
  if (blob.biomarkers && typeof blob.biomarkers === "object") Object.assign(biomarkers, blob.biomarkers as Record<string, unknown>);
  const labs: Record<string, unknown> = {};
  if (Object.keys(biomarkers).length) labs.biomarkers = biomarkers;
  for (const k of ["bpSystolic", "bpDiastolic", "weight", "height"] as const) if (typeof blob[k] === "number") labs[k] = blob[k];
  if (typeof blob.last_panel_grade === "string") labs.last_panel_grade = blob.last_panel_grade;
  return { history, labs: Object.keys(labs).length ? labs : null };
}

function open<T>(ct: string, aad: string): { ok: true; v: T } | { ok: false } {
  try { return { ok: true, v: decryptJson<T>(ct, aad) }; } catch { return { ok: false }; }
}

/** All of this patient's legacy items not yet in the ledger, decrypted with the patient's own AAD. */
export async function pendingItems(patientId: string, store: MigrateStore): Promise<LegacyItem[]> {
  const done = new Set((await store.listLedger(patientId)).map((r) => `${r.source}:${r.source_id}`));
  const rows = await store.listLegacy(patientId);
  const out: LegacyItem[] = [];
  const add = (source: LegacySource, source_id: string, r: { ok: true; v: unknown } | { ok: false }) => {
    if (done.has(`${source}:${source_id}`) || out.length >= PENDING_BATCH) return;
    out.push(r.ok ? { source, source_id, category: SOURCE_CATEGORY[source], data: r.v } : { source, source_id, category: SOURCE_CATEGORY[source], unreadable: true });
  };
  if (rows.profile) add("profile", patientId, open(rows.profile, `profile:${patientId}`));
  if (rows.history) {
    const h = open<Record<string, unknown>>(rows.history.data_encrypted, `history:${patientId}`);
    if (!h.ok) { add("health_history", rows.history.id, h); }
    else {
      const { history, labs } = splitHistory(h.v);
      add("health_history", rows.history.id, { ok: true, v: history });
      if (labs) add("health_history_labs", rows.history.id, { ok: true, v: labs });
    }
  }
  for (const b of rows.biomarkers) {
    if (done.has(`biomarker_log:${b.id}`)) continue;
    const r = open<{ value: number }>(b.value_encrypted, `biomarker_log:${patientId}:${b.biomarker_key}`);
    add("biomarker_log", b.id, r.ok ? { ok: true, v: { biomarker_key: b.biomarker_key, date_collected: b.date_collected, source: b.source, value: r.v.value } } : r);
  }
  for (const w of rows.wearables) {
    if (done.has(`wearable_data:${w.id}`)) continue;
    const r = open<unknown>(w.data_encrypted, `wearable:${patientId}`);
    add("wearable_data", w.id, r.ok ? { ok: true, v: { device_type: w.device_type, uploaded_at: w.uploaded_at, data: r.v } } : r);
  }
  return out;
}

export async function handleMigrate(
  patientId: string | null, raw: unknown, store: MigrateStore, audit: MigrationAudit, e?: Record<string, string | undefined>,
): Promise<Result> {
  if (!isClientEncEnabled(e ?? process.env)) return NOT_FOUND;
  if (!patientId) return { status: 401, body: { error: "authentication required" } };
  const p = bodySchema.safeParse(raw);
  if (!p.success) return { status: 400, body: { error: "invalid request" } };
  const key = await store.getUserKey(patientId);
  if (!key?.recovery_confirmed_at) return { status: 403, body: { error: "save your recovery code first" } };
  const b = p.data;

  if (b.action === "pending") {
    const items = await pendingItems(patientId, store);
    await audit({ action: "patient.e2e.migration.read", success: true, metadata: { metric_count: items.length } });
    return { status: 200, body: { items } };
  }
  if (b.action === "read") {
    const entries = await store.getEntries(patientId, b.ids);
    return { status: 200, body: { entries: entries.filter((x) => x.patient_id === patientId) } };
  }
  if (b.action === "mark") {
    const entries = new Map((await store.getEntries(patientId, b.items.map((i) => i.entry_id))).map((x) => [x.id, x]));
    for (const it of b.items) {
      const ent = entries.get(it.entry_id);
      if (it.entry_id !== await legacyEntryId(patientId, it.source, it.source_id)) return { status: 400, body: { error: "unexpected entry id" } };
      if (!ent || ent.patient_id !== patientId || ent.category !== SOURCE_CATEGORY[it.source] || ent.dek_id !== key.active_dek_id) {
        return { status: 409, body: { error: "encrypted entry not found" } };
      }
      if (!envelopeSchema.safeParse(ent.envelope).success) return { status: 409, body: { error: "encrypted entry not found" } };
    }
    await store.markMigrated(patientId, b.items);
    return { status: 200, body: { ok: true, marked: b.items.length } };
  }
  await audit({
    action: "patient.e2e.migration.finished", success: b.outcome !== "failed",
    metadata: { migrated_count: b.migrated, superseded_count: b.superseded, failed_count: b.failed, outcome: b.outcome },
  });
  return { status: 200, body: { ok: true } };
}
