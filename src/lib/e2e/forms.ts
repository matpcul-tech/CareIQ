/**
 * Browser path for onboarding and health forms while NEXT_PUBLIC_CAREIQ_CLIENT_ENC_V1 is on.
 * The form data is encrypted on this device with the patient data key and posted to
 * /api/e2e/entries. Scoring runs here first so only the LE8 band and alert severity stay readable.
 * Consent: the clinic can open entries only if the patient granted it at enrollment; this module
 * never adds a clinic wrap.
 */
import { decryptHealthEntry, encryptHealthEntry, unlockDataKey, accountKeyId, type EntryRow, type KeyWrapRow } from "./patient";
import type { KeyStore } from "./keystore";
import { coarseFieldsFor, FORM_CATEGORIES, type FormCategory, type FormSnapshot } from "./scoring";

export class NotEnrolledError extends Error {
  constructor() { super("Set up encryption first"); this.name = "NotEnrolledError"; }
}
export class DeviceLockedError extends Error {
  constructor() { super("Unlock this device with your recovery code"); this.name = "DeviceLockedError"; }
}

export interface E2eStatus {
  patient_id: string;
  enrolled: boolean;
  recovery_confirmed_at?: string;
  dek_id?: string;
  wraps?: KeyWrapRow[];
}

export interface FormTransport {
  status(): Promise<E2eStatus>;
  listEntries(): Promise<EntryRow[]>;
  saveEntry(row: Omit<EntryRow, "patient_id">): Promise<void>;
}

/** Latest decrypted entry per form category, for scoring across forms. */
export async function loadSnapshot(entries: EntryRow[], dek: CryptoKey, dekId: string): Promise<FormSnapshot> {
  const snap: FormSnapshot = {};
  for (const cat of FORM_CATEGORIES) {
    const row = entries.find((e) => e.category === cat && e.dek_id === dekId);
    if (row) (snap as Record<string, unknown>)[cat] = await decryptHealthEntry(row, dek);
  }
  return snap;
}

/** One stable row id per patient and form, so saving a form again replaces the earlier entry. */
export async function formEntryId(patientId: string, category: FormCategory): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`careiq-form:${patientId}:${category}`))).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export async function saveEncryptedForm(category: FormCategory, data: unknown, deps: { transport: FormTransport; keystore: KeyStore }): Promise<EntryRow> {
  const st = await deps.transport.status();
  if (!st.enrolled || !st.recovery_confirmed_at || !st.dek_id) throw new NotEnrolledError();
  const priv = await deps.keystore.get(accountKeyId(st.patient_id));
  if (!priv) throw new DeviceLockedError();
  const wrap = (st.wraps ?? []).find((w) => w.recipient_type === "patient" && w.recipient_id === st.patient_id && w.dek_id === st.dek_id);
  if (!wrap) throw new DeviceLockedError();
  const dek = await unlockDataKey(wrap, priv);
  const snapshot = await loadSnapshot(await deps.transport.listEntries(), dek, st.dek_id);
  (snapshot as Record<string, unknown>)[category] = data;
  const { le8Band, alertSeverity } = coarseFieldsFor(category, snapshot);
  const row = await encryptHealthEntry({
    id: await formEntryId(st.patient_id, category), patientId: st.patient_id, category, dekId: st.dek_id, dek, data, le8Band, alertSeverity,
  });
  const { patient_id: _p, ...body } = row;
  await deps.transport.saveEntry(body);
  return row;
}

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

/** Browser transport for the e2e API routes. */
export const fetchTransport: FormTransport = {
  async status() {
    const r = await fetch("/api/e2e/enroll", { credentials: "same-origin" });
    if (!r.ok) throw new NotEnrolledError();
    return r.json();
  },
  async listEntries() {
    const r = await fetch("/api/e2e/entries", { credentials: "same-origin" });
    if (!r.ok) throw new Error("could not load entries");
    return ((await r.json()) as { entries: EntryRow[] }).entries;
  },
  async saveEntry(row) {
    const r = await fetch("/api/e2e/entries", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify(row),
    });
    if (r.status === 403) throw new NotEnrolledError();
    if (!r.ok) throw new Error("save failed");
  },
};
