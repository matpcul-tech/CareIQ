"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { postJson, takeFragmentToken } from "../onboarding-client";

export default function JoinForm() {
  const [token, setToken] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => { setToken(takeFragmentToken()); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setStatus("Joining");
    const r = await postJson("/api/clinic/join", { token, displayName, email });
    if (r.ok) { setDone(true); setStatus(""); return; }
    setStatus(typeof r.body.error === "string" ? r.body.error : r.status === 429 ? "Too many tries. Wait a minute." : "Could not join");
  }

  if (done) return <p className="text-sm">You are on the clinic staff list. <Link href="/clinic">Sign in on the clinic page</Link> with the email you entered.</p>;
  if (!token) return <p className="text-sm">Open the full invite link your clinic admin sent. It ends with #token=...</p>;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4">
      <label className="text-sm">Your name<input className="field-input" required maxLength={80} value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <label className="text-sm">Your work email (you will sign in with it)<input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <button type="submit" className="btn-primary w-fit">Join clinic</button>
      {status && <p className="text-sm" role="status">{status}</p>}
    </form>
  );
}
