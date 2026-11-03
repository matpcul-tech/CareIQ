"use client";

import { useEffect, useState } from "react";
import {
  createClinicKey, LOST_KEYS_NOTICE, recoveryKeyConfirmed, unlockWithPassphrase, unlockWithShares, unlockWithRecoveryKey,
  CLINIC_PASSPHRASE_MIN, type ClinicKeyRecord, type NewClinicKey,
} from "@/lib/e2e/clinic";
import { postJson } from "../onboarding-client";

type Status = { clinic_id: string; has_key: boolean; admin: boolean } & Partial<ClinicKeyRecord>;

export default function ClinicKeySetup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [useSplit, setUseSplit] = useState(false);
  const [made, setMade] = useState<NewClinicKey | null>(null);
  const [typed, setTyped] = useState("");
  const [ack, setAck] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/clinic/keys", { credentials: "same-origin" })
      .then(async (r) => (r.ok ? setStatus(await r.json()) : setMsg("Sign in as clinic staff first.")))
      .catch(() => setMsg("Could not load the clinic key."));
  }, []);

  async function generate() {
    if (!status) return;
    if (pass.length < CLINIC_PASSPHRASE_MIN) return setMsg(`Use at least ${CLINIC_PASSPHRASE_MIN} characters.`);
    if (pass !== pass2) return setMsg("The passphrases do not match.");
    setBusy(true); setMsg("");
    try { setMade(await createClinicKey({ clinicId: status.clinic_id, passphrase: pass, split: useSplit })); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!made) return;
    if (!ack) return setMsg("Check the box to confirm you understand lost keys cannot be recovered.");
    if (!recoveryKeyConfirmed(made.recoveryKey, typed)) return setMsg("Those words do not match the recovery key. Check your printout.");
    setBusy(true); setMsg("");
    const { clinic_id: _id, ...rest } = made.record;
    const r = await postJson("/api/clinic/keys", { ...rest, recovery_confirmed: true });
    setBusy(false);
    if (!r.ok) return setMsg(typeof r.body.error === "string" ? r.body.error : "Could not save the clinic key.");
    setMade(null); setPass(""); setPass2(""); setTyped("");
    setStatus({ ...status!, has_key: true, ...made.record });
    setMsg("Clinic key saved. Keep the printed recovery key in a locked place.");
  }

  async function testUnlock(kind: "pass" | "words" | "shares") {
    if (!status?.passphrase_sealed) return;
    setBusy(true); setMsg("");
    try {
      const rec = status as ClinicKeyRecord;
      if (kind === "pass") await unlockWithPassphrase(rec, pass);
      else if (kind === "words") await unlockWithRecoveryKey(rec, recoveryInput);
      else await unlockWithShares(rec, recoveryInput.split(/\n+/).map((s) => s.trim()).filter(Boolean));
      setMsg("Unlocked on this device.");
    } catch { setMsg("That did not unlock the clinic key."); }
    finally { setBusy(false); }
  }

  if (!status) return <p className="text-sm">{msg || "Loading..."}</p>;
  if (!status.admin && !status.has_key) return <p className="text-sm">Your clinic admin has not set up the clinic key yet.</p>;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="rounded-xl border border-amber-300 bg-amber-50 p-3" role="note"><strong>Lost keys are unrecoverable.</strong> {LOST_KEYS_NOTICE}</p>

      {!status.has_key && !made && (
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <label>Admin passphrase (at least {CLINIC_PASSPHRASE_MIN} characters)
            <input className="field-input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <label>Type it again
            <input className="field-input" type="password" autoComplete="new-password" value={pass2} onChange={(e) => setPass2(e.target.value)} />
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={useSplit} onChange={(e) => setUseSplit(e.target.checked)} />
            <span>Also split the recovery key into 3 shares, so any 2 holders (for example clinic director, IT lead, council delegate) can rebuild it.</span>
          </label>
          <button type="button" className="btn-primary w-fit" disabled={busy} onClick={generate}>Create clinic key</button>
        </section>
      )}

      {made && (
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <p className="font-semibold">Recovery key. Print it now. It is shown only once and CareIQ does not keep it.</p>
          <ol className="grid grid-cols-3 gap-1 font-mono">
            {made.recoveryKey.split(" ").map((w, i) => <li key={i}>{i + 1}. {w}</li>)}
          </ol>
          {made.shares && (
            <div>
              <p className="font-semibold">Recovery shares. Give each one to a different person. Any 2 rebuild the recovery key.</p>
              {made.shares.map((s, i) => <p key={i} className="break-all font-mono">Share {i + 1}: {s}</p>)}
            </div>
          )}
          <button type="button" className="w-fit underline" onClick={() => window.print()}>Print</button>
          <label>Type all 24 recovery words to confirm you saved them
            <textarea className="field-input" rows={3} autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand that if the passphrase and recovery key are lost, the data cannot be recovered by anyone, including CareIQ.</span>
          </label>
          <button type="button" className="btn-primary w-fit" disabled={busy} onClick={save}>Save clinic key</button>
        </section>
      )}

      {status.has_key && status.admin && (
        <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
          <p>Clinic key is set up ({status.custody_mode === "passphrase_split_2of3" ? "passphrase plus 2 of 3 recovery shares" : "passphrase plus recovery key"}).</p>
          <label>Passphrase
            <input className="field-input" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} />
          </label>
          <button type="button" className="btn-primary w-fit" disabled={busy} onClick={() => testUnlock("pass")}>Unlock with passphrase</button>
          <label>Or recovery words, or 2 shares (one per line)
            <textarea className="field-input" rows={3} autoComplete="off" value={recoveryInput} onChange={(e) => setRecoveryInput(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="button" className="underline" disabled={busy} onClick={() => testUnlock("words")}>Unlock with recovery words</button>
            <button type="button" className="underline" disabled={busy} onClick={() => testUnlock("shares")}>Unlock with 2 shares</button>
          </div>
        </section>
      )}
      {status.has_key && !status.admin && <p>Your clinic key is set up. Your admin holds the passphrase.</p>}
      {msg && <p role="status">{msg}</p>}
    </div>
  );
}
