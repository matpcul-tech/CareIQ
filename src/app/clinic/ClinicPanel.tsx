"use client";

import { useState } from "react";

function pct(value: unknown): string {
  if (typeof value !== "number") return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

function ScorecardView({ card }: { card: Record<string, unknown> }) {
  const measures = Array.isArray(card.measures) ? card.measures as Array<Record<string, unknown>> : [];
  const p4p = (card.p4p || {}) as Record<string, unknown>;
  const combined = (p4p.combined || {}) as Record<string, unknown>;
  const care = (card.care_management || {}) as Record<string, unknown>;
  const worklist = Array.isArray(card.worklist) ? card.worklist as Array<Record<string, unknown>> : [];
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-ink-soft">{String(card.label || "")}</p>
      {measures.map((measure) => (
        <article key={String(measure.id)} className="rounded-xl border border-slate-200 p-3">
          <h2 className="font-semibold">{String(measure.name)}</h2>
          <p>Estimated rate {pct(measure.rate)} ({String(measure.numerator)}/{String(measure.denominator)})</p>
          <p>Target {pct(measure.target)} ({String(measure.target_source)}). Gap {pct(measure.gap)}. Patients to close it: {String(measure.needed ?? "set a target")}.</p>
          <p className="text-ink-soft">{Array.isArray(measure.patients) && measure.patients.length > 0 ? measure.patients.join(", ") : "No gap patients."}</p>
          <p className="text-ink-soft">{String(measure.note || "")}</p>
        </article>
      ))}
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Estimated MCO P4P dollars</h2>
        <p>{String(p4p.label || "")}</p>
        <p>$40 {String(combined.p40 ?? 0)}, $80 {String(combined.p80 ?? 0)}, $100 {String(combined.p100 ?? 0)} for CBP plus GSD.</p>
      </article>
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Estimated care management dollars</h2>
        <p>{String(care.label || "")}</p>
        <p>RPM estimate ${String(care.rpm_dollars ?? 0)} for {String(care.month || "")}.</p>
        <p>{String((care.ccm_apcm as { label?: string } | undefined)?.label || "")}</p>
      </article>
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Patients who would close a gap</h2>
        <ul>
          {worklist.map((item) => (
            <li key={String(item.external_id)}>
              {String(item.external_id)}: {Array.isArray(item.measures) ? item.measures.join(", ") : ""}
            </li>
          ))}
        </ul>
        {worklist.length === 0 && <p className="text-ink-soft">No open gaps against the current targets.</p>}
      </article>
    </div>
  );
}

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
