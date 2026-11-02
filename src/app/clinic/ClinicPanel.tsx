"use client";

import { useState } from "react";
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
  return { ok: response.ok, body };
}

export default function ClinicPanel() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("");
  const [card, setCard] = useState<Record<string, unknown> | null>(null);

  async function load() {
    setStatus("Loading");
    const result = await clinicFetch("/api/clinic?view=scorecard", token);
    if (!result.ok) {
      setStatus(typeof result.body.error === "string" ? result.body.error : "Could not load the scorecard");
      setCard(null);
      return;
    }
    setCard(result.body);
    setStatus("");
  }

  return (
    <section className="mt-6 flex flex-col gap-4">
      <label className="text-sm">
        Care team token
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
    </section>
  );
}
