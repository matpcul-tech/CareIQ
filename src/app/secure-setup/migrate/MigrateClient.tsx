"use client";

import { useEffect, useState } from "react";
import {
  accountKeyId, DeviceLockedError, fetchMigrationApi, fetchTransport, IndexedDbKeyStore, NotEnrolledError, runMigration,
  type E2eStatus, type MigrationProgress, type MigrationResult,
} from "@/lib/e2e";

const store = new IndexedDbKeyStore();
const api = fetchMigrationApi(fetchTransport);

type Ready = "loading" | "signed_out" | "not_enrolled" | "locked" | "ready";

export default function MigrateClient() {
  const [ready, setReady] = useState<Ready>("loading");
  const [progress, setProgress] = useState<MigrationProgress | null>(null);
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetchTransport.status()
      .then(async (s: E2eStatus) => {
        if (!s.enrolled || !s.recovery_confirmed_at) return setReady("not_enrolled");
        setReady((await store.get(accountKeyId(s.patient_id))) ? "ready" : "locked");
      })
      .catch(() => setReady("signed_out"));
  }, []);

  async function start() {
    setBusy(true);
    setMsg("");
    setResult(null);
    try {
      setResult(await runMigration({ api, keystore: store, onProgress: setProgress }));
    } catch (e) {
      if (e instanceof DeviceLockedError) setReady("locked");
      else if (e instanceof NotEnrolledError) setReady("not_enrolled");
      else setMsg("The move stopped before it finished. Your original records are still safe. You can try again.");
    } finally {
      setBusy(false);
    }
  }

  if (ready === "loading") return <main className="p-6">Loading...</main>;
  if (ready === "signed_out") return <main className="p-6">Sign in to protect your existing records.</main>;
  if (ready !== "ready") {
    return (
      <main className="mx-auto max-w-xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Protect your existing records</h1>
        <p>{ready === "not_enrolled"
          ? "First create and confirm your recovery code."
          : "First unlock this device with your recovery code."}</p>
        <a className="underline" href="/secure-setup">Go to setup</a>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Protect your existing records</h1>
      <p>Your profile, health history, lab values, and wearable readings were saved before on-device encryption. This step locks a copy of each one with your own key, on this device.</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Each record is checked after it is saved. Only checked records count as done.</li>
        <li>Your original copies are kept for now. Nothing is deleted.</li>
        <li>If you stop or lose your connection, run it again. It picks up where it left off.</li>
        <li>Your clinic care team can open the new copies only if you allowed it during setup.</li>
      </ul>
      <button className="rounded bg-black px-4 py-2 text-white disabled:opacity-50" disabled={busy} onClick={start}>
        {busy ? "Working..." : result ? "Run again" : "Start"}
      </button>
      {progress && (
        <section role="status" aria-live="polite" className="space-y-2">
          <p>{progress.message}</p>
          {progress.total > 0 && (
            <>
              <progress className="w-full" max={progress.total} value={progress.done} />
              <p>Done: {progress.migrated}. Already had a newer copy: {progress.superseded}. Could not move: {progress.failed}.</p>
            </>
          )}
        </section>
      )}
      {msg && <p role="status">{msg}</p>}
    </main>
  );
}
