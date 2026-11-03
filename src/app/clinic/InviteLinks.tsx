"use client";

import { useEffect, useState } from "react";
import { postJson } from "./onboarding-client";

type Invite = { id: string; role: string; is_admin: boolean; expires_at: string; used_at: string | null; revoked_at: string | null };

/** Clinic admin only. Hidden for other staff. */
export default function InviteLinks() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [role, setRole] = useState("provider");
  const [admin, setAdmin] = useState(false);
  const [link, setLink] = useState("");
  const [status, setStatus] = useState("");

  async function load() {
    const res = await fetch("/api/clinic/invites", { credentials: "same-origin" });
    if (!res.ok) { setInvites(null); return; }
    setInvites(((await res.json()) as { invites: Invite[] }).invites);
  }
  useEffect(() => { void load(); }, []);
  if (!invites) return null;

  async function create() {
    const r = await postJson("/api/clinic/invites", { action: "create", role, admin });
    if (!r.ok) { setStatus(String(r.body.error || "Could not create the link")); return; }
    setLink(`${window.location.origin}/clinic/join#token=${String(r.body.token)}`);
    setStatus("Copy this link now. It is shown only once, works once, and expires in 7 days.");
    void load();
  }

  async function revoke(id: string) {
    const r = await postJson("/api/clinic/invites", { action: "revoke", id });
    setStatus(r.ok ? "Invite revoked." : String(r.body.error || "Could not revoke"));
    void load();
  }

  const state = (i: Invite) => (i.used_at ? "Used" : i.revoked_at ? "Revoked" : Date.parse(i.expires_at) < Date.now() ? "Expired" : "Open");
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3">
      <h2 className="font-semibold">Invite links</h2>
      <p className="text-sm text-ink-soft">Make a single-use link for one teammate. Send it to them yourself.</p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <select className="field-input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="provider">Provider</option><option value="care_manager">Care manager</option><option value="front_desk">Front desk</option>
        </select>
        <label><input type="checkbox" checked={admin} onChange={(e) => setAdmin(e.target.checked)} /> Clinic admin</label>
        <button type="button" className="btn-primary w-fit" onClick={() => void create()}>Create invite link</button>
      </div>
      {link && <input readOnly className="field-input font-mono text-xs" value={link} onFocus={(e) => e.target.select()} />}
      {status && <p className="text-sm" role="status">{status}</p>}
      <ul className="text-sm">
        {invites.map((i) => (
          <li key={i.id}>
            {i.role.replace("_", " ")}{i.is_admin ? ", admin" : ""}: {state(i)}, expires {i.expires_at.slice(0, 10)}
            {state(i) === "Open" && <button type="button" className="ml-2 text-xs underline" onClick={() => void revoke(i.id)}>Revoke</button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
