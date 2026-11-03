"use client";

import { useEffect, useState } from "react";
import type { QueueItem } from "@/lib/clinic/alerts/queue";
import { ALERT_GUIDANCE_LABEL } from "@/lib/clinic/alerts/labels";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]).split(".")[0] : "";
}

const SEVERITY_STYLE: Record<QueueItem["severity"], string> = {
  critical: "bg-red-100 text-red-800",
  high: "bg-amber-100 text-amber-800",
  informational: "bg-slate-100 text-slate-700",
};

function ageText(iso: string): string {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (mins < 60) return `${mins} min ago`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}

export default function AlertQueue() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");

  async function load() {
    const res = await fetch(`/api/clinic/alerts${showResolved ? "?resolved=1" : ""}`, { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { setItems(null); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(body.error || "Could not load alerts"); setItems([]); return; }
    setItems(body.items as QueueItem[]);
    setStatus("");
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showResolved]);

  async function act(id: string, action: "acknowledge" | "resolve") {
    const res = await fetch("/api/clinic/alerts", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ alertId: id, action, note: notes[id] || "" }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(body.error || "Update failed"); return; }
    setNotes({ ...notes, [id]: "" });
    void load();
  }

  if (items === null) return null;

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">Alert queue</h2>
        <span className="text-sm text-ink-soft">{items.filter((i) => i.status !== "resolved").length} open</span>
        <label className="ml-auto text-sm">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> Show resolved
        </label>
      </div>
      <p className="text-xs text-ink-mute">Home readings from linked patients. Sorted by severity, then oldest first. {ALERT_GUIDANCE_LABEL}</p>
      {status && <p className="text-sm text-red-700">{status}</p>}
      {items.length === 0 && <p className="mt-2 text-sm text-ink-soft">No open alerts.</p>}
      <ul className="mt-3 space-y-3">
        {items.map((a) => (
          <li key={a.id} className="rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_STYLE[a.severity]}`}>{a.severity}</span>
              <span className="font-mono">{a.patientId}</span>
              <span>{a.readingType === "bp" ? "Blood pressure" : "Glucose"} {a.reading}</span>
              <span className="text-ink-mute">reading {a.recordedOn}, alert {ageText(a.createdAt)}</span>
              <span className="ml-auto text-xs uppercase">{a.status}</span>
            </div>
            <p className="mt-1 text-ink-soft">{a.guidance}</p>
            {a.acknowledgedAt && <p className="text-xs text-ink-mute">Acknowledged by {a.acknowledgedBy} at {new Date(a.acknowledgedAt).toLocaleString()}</p>}
            {a.resolvedAt && <p className="text-xs text-ink-mute">Resolved by {a.resolvedBy} at {new Date(a.resolvedAt).toLocaleString()}</p>}
            {a.notes.map((n, i) => <p key={i} className="text-xs">Note ({n.action}, {n.staffName}, {new Date(n.at).toLocaleString()}): {n.text}</p>)}
            {a.status !== "resolved" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  className="field-input flex-1"
                  maxLength={500}
                  placeholder="Note (required to resolve)"
                  value={notes[a.id] || ""}
                  onChange={(e) => setNotes({ ...notes, [a.id]: e.target.value })}
                />
                {a.status === "new" && <button type="button" className="rounded-full border px-3 py-1" onClick={() => void act(a.id, "acknowledge")}>Acknowledge</button>}
                <button type="button" className="rounded-full bg-slate-900 px-3 py-1 text-white" onClick={() => void act(a.id, "resolve")}>Resolve</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
