"use client";

import { useEffect, useState } from "react";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

type Settings = { timeZone: string; isAdmin: boolean; zones: string[] };

/** Clinic time zone. Reminders and the panel's "today" use it. Admins can change it. */
export default function ClinicSettings() {
  const [s, setS] = useState<Settings | null>(null);
  const [tz, setTz] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    void fetch("/api/clinic/settings", { credentials: "same-origin" }).then(async (r) => {
      if (!r.ok) return;
      const body = (await r.json()) as Settings;
      setS(body);
      setTz(body.timeZone);
    });
  }, []);
  if (!s) return null;

  async function save() {
    const r = await fetch("/api/clinic/settings", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ timeZone: tz }),
    });
    const body = (await r.json().catch(() => ({}))) as { error?: string; timeZone?: string };
    if (r.ok && body.timeZone) { setS({ ...s!, timeZone: body.timeZone }); setStatus("Saved. Reminders and the panel now use this time zone."); }
    else setStatus(body.error || "Could not save");
  }

  const zones = s.zones.includes(s.timeZone) ? s.zones : [s.timeZone, ...s.zones];
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm">
      <span className="font-semibold">Clinic time zone</span>
      {s.isAdmin ? (
        <>
          <select className="field-input w-auto" value={tz} onChange={(e) => setTz(e.target.value)} aria-label="Clinic time zone">
            {zones.map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}
          </select>
          <button type="button" className="rounded-full border px-3 py-1" disabled={tz === s.timeZone} onClick={() => void save()}>Save</button>
        </>
      ) : (
        <span>{s.timeZone.replace("_", " ")}</span>
      )}
      <span className="text-xs text-ink-mute">Used for reminder send days and hours and the panel date.</span>
      {status && <span role="status">{status}</span>}
    </div>
  );
}
