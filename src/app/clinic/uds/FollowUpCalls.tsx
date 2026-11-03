"use client";

import { useEffect, useState } from "react";
import type { FollowUpRow } from "@/lib/clinic/followups/logic";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

type Outcome = { id: string; label: string; closes: boolean };
type Data = { rows: FollowUpRow[]; open: number; outcomes: Outcome[] };
const PRIORITY: Record<number, { label: string; cls: string }> = {
  1: { label: "Call today", cls: "bg-red-100 text-red-800" },
  2: { label: "Call soon", cls: "bg-amber-100 text-amber-900" },
  3: { label: "Routine", cls: "bg-slate-100 text-slate-700" },
};

/** Staff only. Renders nothing for patients. */
export default function FollowUpCalls() {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [outcome, setOutcome] = useState("reached");
  const [note, setNote] = useState("");
  const [showDone, setShowDone] = useState(false);

  async function load() {
    const r = await fetch("/api/clinic/followups", { credentials: "same-origin" });
    if (!r.ok) { setData(null); if (r.status === 503) setStatus("Follow-up list unavailable."); return; }
    setData((await r.json()) as Data);
  }
  useEffect(() => { void load(); }, []);
  if (!data) return status ? <p style={{ fontSize: 12 }}>{status}</p> : null;

  async function save(patientId: string) {
    const r = await fetch("/api/clinic/followups", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ patientId, outcome, note }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string };
    setStatus(r.ok ? "Call logged." : body.error || "Could not log the call");
    if (r.ok) { setOpen(null); setNote(""); void load(); }
  }

  const label = (id: string) => data.outcomes.find((o) => o.id === id)?.label || id;
  const rows = data.rows.filter((r) => showDone || !r.done);
  return (
    <div className="text-sm text-slate-900">
      <div className="flex items-center gap-3">
        <h2 className="font-semibold">Follow-up calls</h2>
        <span>{data.open} to call</span>
        <label className="ml-auto text-xs"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done</label>
      </div>
      <p className="text-xs text-slate-500">From open home reading alerts, care gaps, and appointments in the next 2 weeks. Call from the clinic phone. CareIQ does not book visits.</p>
      {status && <p className="mt-1" role="status">{status}</p>}
      {rows.length === 0 && <p className="mt-2">No one to call right now.</p>}
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.patientId} className="rounded-lg border border-slate-200 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{r.patientId}</span>
              <span className={`rounded-full px-2 text-xs ${PRIORITY[r.priority].cls}`}>{PRIORITY[r.priority].label}</span>
              {r.done && <span className="rounded-full bg-green-100 px-2 text-xs text-green-800">Done</span>}
              <button type="button" className="ml-auto rounded-full border px-3 py-0.5 text-xs" onClick={() => { setOpen(open === r.patientId ? null : r.patientId); setOutcome("reached"); setNote(""); }}>Mark called</button>
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs">{r.reasons.map((x, i) => <li key={i}>{x.text}</li>)}</ul>
            {r.lastCall && <p className="mt-1 text-xs text-slate-500">Last call {r.lastCall.calledAt.slice(0, 16).replace("T", " ")} UTC by {r.lastCall.staffName}: {label(r.lastCall.outcome)}{r.lastCall.note ? `. ${r.lastCall.note}` : ""}</p>}
            {open === r.patientId && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select className="field-input w-auto" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Call outcome">
                  {data.outcomes.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                </select>
                <input className="field-input flex-1" maxLength={500} placeholder="Outcome note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                <button type="button" className="rounded-full bg-slate-900 px-3 py-1 text-xs text-white" onClick={() => void save(r.patientId)}>Save</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
