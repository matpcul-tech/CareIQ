"use client";

import { useEffect, useState } from "react";
import { parseCsvText } from "@/lib/clinic/uds/csv";
import { APPT_FIELDS, appointmentTemplateCsv, guessApptMapping, parseAppointmentCsv, type ApptField, type ApptMapping } from "@/lib/clinic/reminders/csv";
import type { ReminderOverview } from "@/lib/clinic/reminders/actions";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]).split(".")[0] : "";
}

const STATUS_TEXT: Record<string, string> = {
  queued: "Queued",
  skipped_opted_out: "Opted out",
  skipped_no_contact: "No reminders wanted",
  skipped_daily_cap: "Skipped, 1 per day limit",
  skipped_weekly_cap: "Skipped, 3 per week limit",
  skipped_past: "Send day passed",
  staff_call: "Staff call needed",
};

async function post(body: unknown) {
  const res = await fetch("/api/clinic/appointments", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrf() },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, body: await res.json().catch(() => ({})) };
}

export default function Appointments() {
  const [data, setData] = useState<ReminderOverview | null>(null);
  const [hidden, setHidden] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ApptMapping>({});
  const [mode, setMode] = useState<"replace" | "upsert">("upsert");
  const [parsed, setParsed] = useState<ReturnType<typeof parseAppointmentCsv> | null>(null);

  async function load() {
    const res = await fetch("/api/clinic/appointments", { credentials: "same-origin" });
    if (res.status === 401 || res.status === 403) { setHidden(true); return; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(body.error || "Could not load appointments"); return; }
    setData(body as ReminderOverview);
    setStatus("");
  }

  useEffect(() => { void load(); }, []);

  if (hidden) return null;

  function download() {
    const url = URL.createObjectURL(new Blob([appointmentTemplateCsv()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "careiq-appointments-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const t = await f.text();
    const h = parseCsvText(t)[0] || [];
    setText(t); setHeaders(h); setMapping(guessApptMapping(h)); setParsed(null);
  }

  async function upload() {
    if (!parsed?.appointments.length) return;
    const r = await post({ action: "import", appointments: parsed.appointments, mode });
    setStatus(r.ok ? `Imported ${r.body.imported} appointments (${r.body.mode}).` : r.body.error || "Import failed");
    if (r.ok) { setParsed(null); setHeaders([]); void load(); }
  }

  async function dispatch() {
    const r = await post({ action: "dispatch" });
    setStatus(r.ok ? (r.body.dryRun ? `${r.body.message} ${r.body.dryRun} reminders are due today.` : r.body.message) : r.body.error || "Could not run reminders");
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h2 className="font-semibold">Appointments and reminders</h2>
      <p className="text-xs text-ink-mute">CareIQ does not book visits. Your EHR stays the record. Reminders go 3 days and 1 day before, at most 1 a day and 3 a week, with STOP in every text.</p>
      {data && (
        <p className={`mt-2 rounded-lg p-2 text-sm ${data.sending.enabled ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-900"}`} role="status">
          {data.sending.message}
        </p>
      )}
      {status && <p className="mt-2 text-sm">{status}</p>}

      {data && (
        <>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span>{data.upcoming.length} upcoming in 30 days</span>
            <span>{data.optOutCount} opted out</span>
            <span>{data.staffCalls.length} need a staff call</span>
            <span>Languages: {data.languages.join(", ")}</span>
            <button type="button" className="ml-auto rounded-full border px-3 py-1" onClick={() => void dispatch()}>Run today's reminders</button>
          </div>

          {data.staffCalls.length > 0 && (
            <div className="mt-3">
              <h3 className="text-sm font-semibold">Call these patients</h3>
              <ul className="text-sm">
                {data.staffCalls.map((c) => <li key={c.appointmentId}>{c.patientId}, visit {c.date}: {c.reason}</li>)}
              </ul>
            </div>
          )}

          <table className="mt-3 w-full text-left text-sm">
            <thead><tr><th>Visit</th><th>Patient</th><th>Provider and place</th><th>Contact</th><th>Reminders</th></tr></thead>
            <tbody>
              {data.upcoming.map((u) => (
                <tr key={u.appointmentId} className="border-t border-slate-100 align-top">
                  <td>{u.date} {u.time}<br /><span className="text-xs text-ink-mute">{u.visitType}</span></td>
                  <td className="font-mono">{u.patientId}</td>
                  <td>{u.provider}<br /><span className="text-xs text-ink-mute">{u.location}</span></td>
                  <td>{u.optedOut ? "Opted out" : u.reachable ? `${u.contactPreference}, ${u.language}` : "Not reachable"}</td>
                  <td>
                    {u.reminders.length === 0 && <span className="text-ink-mute">None</span>}
                    {u.reminders.map((r) => (
                      <div key={r.sendOn}>
                        {r.sendOn} ({r.offsetDays} day{r.offsetDays === 1 ? "" : "s"} before): {STATUS_TEXT[r.status] || r.status}
                        {r.languageFallback && <span className="text-xs"> (English, no template for this language)</span>}
                        {r.body && <button type="button" className="ml-1 text-xs underline" onClick={() => setPreview(r.body)}>Preview</button>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {preview && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm">
              <p className="text-xs font-semibold">Message preview (dry run)</p>
              <p>{preview}</p>
              <button type="button" className="text-xs underline" onClick={() => setPreview(null)}>Close</button>
            </div>
          )}
        </>
      )}

      <div className="mt-4 border-t border-slate-100 pt-3">
        <h3 className="text-sm font-semibold">Import appointments (clinic admin)</h3>
        <div className="mt-2 flex flex-wrap gap-3 text-sm">
          <button type="button" className="rounded-full border px-3 py-1" onClick={download}>Download template</button>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
          <label><input type="radio" checked={mode === "upsert"} onChange={() => setMode("upsert")} /> Update by appointment ID</label>
          <label><input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace all</label>
        </div>
        {headers.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {APPT_FIELDS.map((f) => (
              <label key={f.key} className="text-sm">
                {f.label}{f.required ? " (required)" : ""} <span className="text-xs text-ink-mute">{f.help}</span>
                <select className="field-input" value={mapping[f.key] ?? ""} onChange={(e) => {
                  const next = { ...mapping };
                  if (e.target.value === "") delete next[f.key as ApptField]; else next[f.key as ApptField] = Number(e.target.value);
                  setMapping(next);
                }}>
                  <option value="">Not in file</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
            <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => setParsed(parseAppointmentCsv(text, mapping, data?.languages))}>Check rows</button>
          </div>
        )}
        {parsed && (
          <div className="mt-3 text-sm">
            {parsed.mappingErrors.map((m) => <p key={m} className="text-red-700">{m}</p>)}
            {parsed.mappingErrors.length === 0 && <p>{parsed.appointments.length} rows ready. {parsed.errors.length} rows have errors and will be skipped.</p>}
            {parsed.errors.slice(0, 200).map((e) => <p key={e.row} className="text-xs">Row {e.row} {e.appointmentId}: {e.messages.join(" ")}</p>)}
            {parsed.appointments.length > 0 && (
              <button type="button" className="mt-2 rounded-full bg-slate-900 px-3 py-1 text-white" onClick={() => void upload()}>Import {parsed.appointments.length} appointments</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
