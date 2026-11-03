/**
 * Patient-run, on-device move of legacy server-encrypted records into patient_e2e_entries
 * (design PR 8). Runs in the patient's browser while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is on.
 *
 * - The server opens only this signed-in patient's own legacy rows and sends them over a
 *   CSRF-protected POST. This device re-encrypts each one with the patient's active data key.
 * - The active data key is wrapped to the clinic only if the patient consented, so migrated
 *   entries follow the same consent. This module never adds or removes a key wrap.
 * - Each new entry is read back from the server and decrypted before its legacy row is marked.
 * - Resumable and idempotent: entry ids are stable, so a rerun overwrites nothing new and
 *   simply marks rows that were written but not yet marked.
 * - If the patient already saved a newer encrypted form, the legacy copy is marked superseded
 *   and the newer entry is kept.
 * - Legacy rows are never deleted here.
 */
import { accountKeyId, decryptHealthEntry, encryptHealthEntry, unlockDataKey, type EntryRow } from "./patient";
import type { KeyStore } from "./keystore";
import { DeviceLockedError, formEntryId, NotEnrolledError, type E2eStatus } from "./forms";
import { coarseFieldsFor, FORM_CATEGORIES, type FormCategory, type FormSnapshot } from "./scoring";

export const LEGACY_SOURCES = ["profile", "health_history", "health_history_labs", "biomarker_log", "wearable_data"] as const;
export type LegacySource = (typeof LEGACY_SOURCES)[number];

export const SOURCE_CATEGORY: Record<LegacySource, string> = {
  profile: "profile",
  health_history: "health_history",
  health_history_labs: "manual_labs",
  biomarker_log: "biomarker_log",
  wearable_data: "wearable",
};

export interface LegacyItem {
  source: LegacySource;
  source_id: string;
  category: string;
  /** Decrypted legacy value. Absent when the server could not open the row. */
  data?: unknown;
  unreadable?: boolean;
}

export type MigrationOutcome = "migrated" | "superseded";
export interface MarkItem { source: LegacySource; source_id: string; entry_id: string; outcome: MigrationOutcome }

export interface MigrationApi {
  status(): Promise<E2eStatus>;
  pending(): Promise<LegacyItem[]>;
  readEntries(ids: string[]): Promise<EntryRow[]>;
  saveEntry(row: Omit<EntryRow, "patient_id">): Promise<void>;
  mark(items: MarkItem[]): Promise<void>;
  report(r: { migrated: number; superseded: number; failed: number; outcome: "complete" | "partial" | "failed" }): Promise<void>;
}

export interface MigrationProgress { done: number; total: number; migrated: number; superseded: number; failed: number; message: string }
export interface MigrationResult { migrated: number; superseded: number; failed: number; outcome: "complete" | "partial" | "failed" }

function uuidFromHash(bytes: Uint8Array): string {
  const h = bytes.slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Stable entry id for a legacy row. Profile, history, and labs land on the same ids the encrypted forms use. */
export async function legacyEntryId(patientId: string, source: LegacySource, sourceId: string): Promise<string> {
  const cat = SOURCE_CATEGORY[source];
  if ((FORM_CATEGORIES as readonly string[]).includes(cat)) return formEntryId(patientId, cat as FormCategory);
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`careiq-legacy:${patientId}:${source}:${sourceId}`));
  return uuidFromHash(new Uint8Array(d));
}

/** Key order independent JSON, for comparing a read-back value with the original. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

const sameValue = (a: unknown, b: unknown) => stableJson(a) === stableJson(b);
const MAX_ROUNDS = 100;

export async function runMigration(deps: { api: MigrationApi; keystore: KeyStore; onProgress?: (p: MigrationProgress) => void }): Promise<MigrationResult> {
  const { api } = deps;
  const st = await api.status();
  if (!st.enrolled || !st.recovery_confirmed_at || !st.dek_id) throw new NotEnrolledError();
  const priv = await deps.keystore.get(accountKeyId(st.patient_id));
  if (!priv) throw new DeviceLockedError();
  const wrap = (st.wraps ?? []).find((w) => w.recipient_type === "patient" && w.recipient_id === st.patient_id && w.dek_id === st.dek_id);
  if (!wrap) throw new DeviceLockedError();
  const dek = await unlockDataKey(wrap, priv);
  const dekId = st.dek_id;
  const pid = st.patient_id;

  const p: MigrationProgress = { done: 0, total: 0, migrated: 0, superseded: 0, failed: 0, message: "Checking your records" };
  const tell = (message: string) => { p.message = message; deps.onProgress?.({ ...p }); };
  const failedKeys = new Set<string>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const items = (await api.pending()).filter((i) => !failedKeys.has(`${i.source}:${i.source_id}`));
    if (items.length === 0) break;
    p.total += items.length;
    tell(`Found ${p.total} record${p.total === 1 ? "" : "s"} to protect`);

    const ids = await Promise.all(items.map((i) => legacyEntryId(pid, i.source, i.source_id)));
    const formIds = await Promise.all(FORM_CATEGORIES.map((c) => formEntryId(pid, c)));
    const existing = new Map((await api.readEntries([...new Set([...ids, ...formIds])])).map((e) => [e.id, e]));

    // Snapshot for on-device LE8 band and alert severity: newer encrypted forms win over legacy copies.
    const snapshot: FormSnapshot = {};
    for (const [i, c] of FORM_CATEGORIES.entries()) {
      const e = existing.get(formIds[i]);
      if (e && e.dek_id === dekId) {
        try { (snapshot as Record<string, unknown>)[c] = await decryptHealthEntry(e, dek); } catch { /* left out */ }
      }
    }
    for (const it of items) {
      if (!it.unreadable && (FORM_CATEGORIES as readonly string[]).includes(it.category) && !(it.category in snapshot)) {
        (snapshot as Record<string, unknown>)[it.category] = it.data;
      }
    }

    const marks: MarkItem[] = [];
    for (const [n, it] of items.entries()) {
      const id = ids[n];
      const key = `${it.source}:${it.source_id}`;
      p.done++;
      try {
        if (it.unreadable || it.category !== SOURCE_CATEGORY[it.source]) throw new Error("unreadable");
        const prior = existing.get(id);
        if (prior) {
          const value = prior.dek_id === dekId ? await decryptHealthEntry<unknown>(prior, dek) : undefined;
          if (value === undefined) throw new Error("existing entry under another key");
          marks.push({ source: it.source, source_id: it.source_id, entry_id: id, outcome: sameValue(value, it.data) ? "migrated" : "superseded" });
          if (sameValue(value, it.data)) p.migrated++; else p.superseded++;
        } else {
          const coarse = (FORM_CATEGORIES as readonly string[]).includes(it.category)
            ? coarseFieldsFor(it.category as FormCategory, snapshot)
            : { le8Band: null, alertSeverity: null };
          const row = await encryptHealthEntry({ id, patientId: pid, category: it.category, dekId, dek, data: it.data, ...coarse });
          const { patient_id: _p, ...body } = row;
          await api.saveEntry(body);
          const [back] = await api.readEntries([id]);
          if (!back || back.dek_id !== dekId || back.category !== it.category) throw new Error("read back failed");
          const value = await decryptHealthEntry<unknown>(back, dek);
          if (!sameValue(value, it.data)) throw new Error("read back mismatch");
          marks.push({ source: it.source, source_id: it.source_id, entry_id: id, outcome: "migrated" });
          p.migrated++;
        }
      } catch {
        failedKeys.add(key);
        p.failed++;
      }
      tell(`Protected ${p.migrated + p.superseded} of ${p.total}`);
    }
    if (marks.length > 0) await api.mark(marks);
    else break;
  }

  const outcome: MigrationResult["outcome"] = p.failed === 0 ? "complete" : p.migrated + p.superseded > 0 ? "partial" : "failed";
  await api.report({ migrated: p.migrated, superseded: p.superseded, failed: p.failed, outcome }).catch(() => undefined);
  tell(outcome === "complete" ? "All done. Your records are now protected on this device."
    : outcome === "partial" ? "Some records could not be moved. Your original copies are still safe. You can try again."
      : p.total === 0 ? "Nothing to move." : "Nothing could be moved. Your original copies are still safe. You can try again.");
  return { migrated: p.migrated, superseded: p.superseded, failed: p.failed, outcome: p.total === 0 ? "complete" : outcome };
}

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

async function post<T>(body: unknown): Promise<T> {
  const r = await fetch("/api/e2e/migrate", {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrf() },
    body: JSON.stringify(body),
  });
  if (r.status === 403) throw new NotEnrolledError();
  if (!r.ok) throw new Error("migration request failed");
  return r.json() as Promise<T>;
}

/** Browser transport. Every call is a POST so the CSRF check in middleware applies. */
export function fetchMigrationApi(base: { status(): Promise<E2eStatus>; saveEntry(row: Omit<EntryRow, "patient_id">): Promise<void> }): MigrationApi {
  return {
    status: () => base.status(),
    saveEntry: (row) => base.saveEntry(row),
    pending: async () => (await post<{ items: LegacyItem[] }>({ action: "pending" })).items,
    readEntries: async (ids) => (ids.length ? (await post<{ entries: EntryRow[] }>({ action: "read", ids })).entries : []),
    mark: async (items) => { await post({ action: "mark", items }); },
    report: async (r) => { await post({ action: "report", ...r }); },
  };
}
