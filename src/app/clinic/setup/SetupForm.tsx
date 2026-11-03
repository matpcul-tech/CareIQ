"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { postJson, takeFragmentToken } from "../onboarding-client";

export default function SetupForm({ encEnabled = false }: { encEnabled?: boolean }) {
  const [token, setToken] = useState("");
  const [clinicName, setClinicName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminRole, setAdminRole] = useState("provider");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { setToken(takeFragmentToken()); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("Creating the clinic");
    const r = await postJson("/api/clinic/setup", { token, clinicName, adminName, adminEmail, adminRole });
    if (r.ok) { setDone(true); setStatus(""); return; }
    setStatus(typeof r.body.error === "string" ? r.body.error : r.status === 429 ? "Too many tries. Wait a minute." : "Setup failed");
  }

  if (done) {
    return (
      <div className="rounded-xl border border-slate-200 p-4 text-sm">
        <p className="font-semibold">Clinic created. You are its admin.</p>
        <p className="mt-2">This setup link is now used up. <Link href="/clinic">Sign in on the clinic page</Link> with the email you entered. Then invite your team from the clinic page.</p>
        {encEnabled && <p className="mt-2">Next, after you sign in: <Link href="/clinic/keys">create your clinic encryption key</Link>. You will set a passphrase and print a recovery key. Lost keys are unrecoverable.</p>}
      </div>
    );
  }
  if (!token) return <p className="text-sm">Open the full setup link from your CareIQ operator. It ends with #token=...</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <label className="text-sm">Clinic name<input className="field-input" required maxLength={120} value={clinicName} onChange={(e) => setClinicName(e.target.value)} /></label>
      <label className="text-sm">Your name<input className="field-input" required maxLength={80} value={adminName} onChange={(e) => setAdminName(e.target.value)} /></label>
      <label className="text-sm">Your work email (you will sign in with it)<input className="field-input" type="email" required value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} /></label>
      <label className="text-sm">Your role
        <select className="field-input" value={adminRole} onChange={(e) => setAdminRole(e.target.value)}>
          <option value="provider">Provider</option><option value="care_manager">Care manager</option><option value="front_desk">Front desk</option>
        </select>
      </label>
      <button type="submit" className="btn-primary w-fit">Create clinic</button>
      {status && <p className="text-sm" role="status">{status}</p>}
    </form>
  );
}
