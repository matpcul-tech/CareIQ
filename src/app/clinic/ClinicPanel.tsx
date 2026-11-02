"use client";

import { useEffect, useState, type FormEvent } from "react";
import ScorecardView from "./ScorecardView";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!match) return "";
  return decodeURIComponent(match[1]).split(".")[0];
}

async function clinicFetch(path: string, token: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (token) headers.set("x-care-circle-token", token);
  if (init?.method === "POST") headers.set("x-csrf-token", csrf());
  if (!headers.has("content-type") && init?.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body: body as Record<string, unknown> };
}

export default function ClinicPanel() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("");
  const [card, setCard] = useState<Record<string, unknown> | null>(null);
  const [email, setEmail] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState("provider");
  const [inviteStatus, setInviteStatus] = useState("");

  async function load() {
    setStatus("Loading");
    const result = await clinicFetch("/api/clinic?view=scorecard", token);
    if (!result.ok) {
      const message = typeof result.body.error === "string" ? result.body.error : "Could not load the scorecard";
      const signedOut = result.status === 401 || message === "Authentication required" || message === "authentication required";
      setStatus(signedOut ? "" : message);
      setCard(null);
      return;
    }
    setCard(result.body);
    setStatus("");
  }

  useEffect(() => {
    void load();
    // Load once on open. Later loads use the button so a typed token is included.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setStatus("Sending sign-in link");
    const result = await clinicFetch("/api/clinic/sign-in", "", {
      method: "POST",
      body: JSON.stringify({ email }),
    });
    if (!result.ok) {
      setStatus(typeof result.body.error === "string" ? result.body.error : "Could not send the sign-in link");
      return;
    }
    setStatus("If this email is on the clinic staff list, a sign-in link is on its way.");
  }

  async function invite(event: FormEvent) {
    event.preventDefault();
    setInviteStatus("Sending invite");
    const result = await clinicFetch("/api/clinic", token, {
      method: "POST",
      body: JSON.stringify({
        action: "invite_staff",
        email: inviteEmail,
        role: inviteRole,
        displayName: inviteName,
      }),
    });
    if (!result.ok) {
      setInviteStatus(typeof result.body.error === "string" ? result.body.error : "Could not send the invite");
      return;
    }
    if (result.body.delivery === "existing_user") {
      setInviteStatus("This email already has a sign-in. Ask them to use the form on this page.");
      return;
    }
    setInviteStatus("Invite sent.");
  }

  return (
    <section className="mt-6 flex flex-col gap-4">
      <form onSubmit={signIn} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3">
        <h2 className="text-sm font-semibold">Staff sign-in</h2>
        <label className="text-sm">
          Work email
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            autoComplete="email"
            required
          />
        </label>
        <button type="submit" className="btn-primary w-fit">Email me a sign-in link</button>
      </form>
      <label className="text-sm">
        Optional staff token
        <input
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          autoComplete="off"
        />
      </label>
      <button type="button" className="btn-primary w-fit" onClick={load}>Load scorecard</button>
      {status && <p className="text-sm text-ink-soft">{status}</p>}
      {card && <ScorecardView card={card} />}
      {card && (
        <form onSubmit={invite} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-3">
          <h2 className="text-sm font-semibold">Invite staff</h2>
          <p className="text-sm text-ink-soft">A clinic admin can invite a provider, care manager, or front desk teammate. The invite does not include a staff token.</p>
          <label className="text-sm">
            Email
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="off"
              required
            />
          </label>
          <label className="text-sm">
            Name
            <input
              value={inviteName}
              onChange={(event) => setInviteName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              autoComplete="off"
              required
            />
          </label>
          <label className="text-sm">
            Role
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="provider">Provider</option>
              <option value="care_manager">Care manager</option>
              <option value="front_desk">Front desk</option>
            </select>
          </label>
          <button type="submit" className="btn-primary w-fit">Send invite</button>
          {inviteStatus && <p className="text-sm text-ink-soft">{inviteStatus}</p>}
        </form>
      )}
    </section>
  );
}
