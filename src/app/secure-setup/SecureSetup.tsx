"use client";

import { useEffect, useState } from "react";
import {
  accountKeyId, finishEnrollment, IndexedDbKeyStore, recoverAccount, RecoveryNotConfirmedError,
  startEnrollment, type PendingEnrollment, type SealedRecovery,
} from "@/lib/e2e";

interface Status {
  enrolled: boolean;
  clinic: { clinic_id: string; public_jwk: JsonWebKey } | null;
  recovery?: SealedRecovery;
}

const store = new IndexedDbKeyStore();

export default function SecureSetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pending, setPending] = useState<PendingEnrollment | null>(null);
  const [patientId, setPatientId] = useState("");
  const [typed, setTyped] = useState("");
  const [consent, setConsent] = useState(false);
  const [hasDeviceKey, setHasDeviceKey] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/e2e/enroll")
      .then((r) => r.json())
      .then((d: Status & { patient_id?: string }) => {
        if ("error" in d) return setMsg("Sign in to set up encryption.");
        setStatus(d);
        if (d.patient_id) setPatientId(d.patient_id);
      })
      .catch(() => setMsg("Could not load setup."));
  }, []);

  useEffect(() => {
    if (patientId) store.get(accountKeyId(patientId)).then((k) => setHasDeviceKey(Boolean(k))).catch(() => undefined);
  }, [patientId, status]);

  async function begin() {
    if (!patientId) return setMsg("Sign in first.");
    setBusy(true);
    try { setPending(await startEnrollment(patientId)); } finally { setBusy(false); }
  }

  async function finish() {
    if (!pending) return;
    setBusy(true);
    setMsg("");
    try {
      const clinic = status?.clinic ? { clinicId: status.clinic.clinic_id, publicJwk: status.clinic.public_jwk, consent } : undefined;
      const { bundle } = await finishEnrollment(pending, typed, { keystore: store, clinic });
      const r = await fetch("/api/e2e/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bundle) });
      if (!r.ok) throw new Error("save failed");
      setPending(null);
      setStatus({ ...(status as Status), enrolled: true });
      setMsg("Setup complete. New health entries will be encrypted on this device.");
    } catch (e) {
      setMsg(e instanceof RecoveryNotConfirmedError ? "That code does not match. Check what you saved and try again." : "Could not finish setup.");
    } finally {
      setBusy(false);
    }
  }

  async function recover() {
    if (!status?.recovery) return;
    setBusy(true);
    try {
      await recoverAccount(patientId, status.recovery, typed, store);
      setHasDeviceKey(true);
      setMsg("This device is unlocked.");
    } catch {
      setMsg("That recovery code did not unlock your records.");
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <main className="p-6">{msg || "Loading..."}</main>;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Protect your health records</h1>
      <p>Your health entries are encrypted on this device before they are sent. You hold the key.</p>
      {!status.enrolled && !pending && (
        <button className="rounded bg-black px-4 py-2 text-white" disabled={busy} onClick={begin}>Create my recovery code</button>
      )}
      {pending && (
        <section className="space-y-3">
          <p className="font-semibold">Your recovery code. Write it down or print it now. It is shown only once.</p>
          <pre className="rounded border p-3 text-lg tracking-wider">{pending.recoveryCode}</pre>
          <p>If you lose every device and this code, nobody can recover your encrypted records, including CareIQ.</p>
          {status.clinic && (
            <label className="flex gap-2">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>Let my clinic care team open my records. I can withdraw this later.</span>
            </label>
          )}
          <label className="block">Type the code back to confirm you saved it
            <input className="mt-1 w-full rounded border p-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <button className="rounded bg-black px-4 py-2 text-white" disabled={busy} onClick={finish}>Confirm and finish</button>
        </section>
      )}
      {status.enrolled && !hasDeviceKey && !pending && (
        <section className="space-y-3">
          <p>This device does not have your key yet. Enter your recovery code.</p>
          <input className="w-full rounded border p-2" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          <button className="rounded bg-black px-4 py-2 text-white" disabled={busy} onClick={recover}>Unlock this device</button>
        </section>
      )}
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
