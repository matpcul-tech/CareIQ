"use client";

import { useState } from "react";

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
  const [worklist, setWorklist] = useState<Array<Record<string, unknown>>>([]);
  const [measures, setMeasures] = useState<Record<string, unknown> | null>(null);

  async function load() {
    setStatus("Loading");
    const list = await clinicFetch("/api/clinic?view=worklist", token);
    const rates = await clinicFetch("/api/clinic?view=measures", token);
    if (!list.ok) {
      setStatus(typeof list.body.error === "string" ? list.body.error : "Could not load the worklist");
      setWorklist([]);
      setMeasures(null);
      return;
    }
    setWorklist(Array.isArray(list.body.items) ? list.body.items : []);
    setMeasures(rates.ok ? rates.body : null);
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
      <button type="button" className="btn-primary w-fit" onClick={load}>Load worklist</button>
      {status && <p className="text-sm text-ink-soft">{status}</p>}
      {measures && (
        <div className="rounded-xl border border-slate-200 p-3 text-sm">
          <p>{String((measures.cms165 as { label?: string } | undefined)?.label || "")}</p>
          <p className="mt-1">{String((measures.cms122 as { label?: string } | undefined)?.label || "")}</p>
        </div>
      )}
      <ul className="flex flex-col gap-2">
        {worklist.map((item) => (
          <li key={String(item.external_id)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <span className="font-semibold">{String(item.rank)}. {String(item.external_id)}</span>
            <span className="mt-1 block text-ink-soft">
              {Array.isArray(item.reasons) ? item.reasons.join(", ") : ""}
              {item.bp ? ` BP ${String(item.bp)}` : ""}
              {item.a1c != null ? ` A1c ${String(item.a1c)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {worklist.length === 0 && !status && (
        <p className="text-sm text-ink-soft">No ranked rows yet. Import a registry CSV from the clinic API. The file must not include names.</p>
      )}
    </section>
  );
}
