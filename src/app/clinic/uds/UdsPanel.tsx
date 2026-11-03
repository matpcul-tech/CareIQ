"use client";

import { useEffect, useMemo, useState } from "react";
import {
  FIELDS,
  gapListCsv,
  guessMapping,
  parseCsvText,
  parsePanelCsv,
  templateCsv,
  type ColumnMapping,
  type FieldKey,
  type ParseResult,
} from "@/lib/clinic/uds/csv";
import AlertQueue from "./AlertQueue";
import Appointments from "./Appointments";
import type { CareGapRow } from "@/lib/clinic/uds/care-gaps";
import { MEASURE_LABEL, type MeasureId, type MeasureRate, type PatientStatus } from "@/lib/clinic/uds/measures";

function csrf(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]).split(".")[0] : "";
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const STATUS_LABEL: Record<PatientStatus, string> = {
  controlled: "Controlled",
  not_controlled: "Not controlled",
  missing_reading: "Missing reading",
  excluded: "Excluded",
  not_in_denominator: "",
  met: "Met",
  due: "Due",
};

interface PanelData {
  period: { start: string; end: string };
  label: string;
  rates: MeasureRate[];
  rows: CareGapRow[];
  unsupported_exclusions: string[];
}

export const NOT_STAFF_MESSAGE = "The patient panel is for clinic staff. Sign in as clinic staff on the clinic page to view it.";

export default function UdsPanel() {
  const [denied, setDenied] = useState(false);
  const thisYear = new Date().getFullYear();
  const [start, setStart] = useState(`${thisYear}-01-01`);
  const [end, setEnd] = useState(`${thisYear}-12-31`);
  const [data, setData] = useState<PanelData | null>(null);
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<"all" | "outreach" | MeasureId>("outreach");
  const [fileText, setFileText] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [parsed, setParsed] = useState<ParseResult | null>(null);

  async function load() {
    setStatus("Loading");
    const res = await fetch(`/api/clinic/uds?start=${start}&end=${end}`, { credentials: "same-origin" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setData(null);
      const notStaff = res.status === 401 || res.status === 403;
      setDenied(notStaff);
      setStatus(notStaff ? "" : body.error || "Could not load the panel");
      return;
    }
    setDenied(false);
    setData(body as PanelData);
    setStatus("");
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const text = await file.text();
    const table = parseCsvText(text);
    setFileText(text);
    setHeaders(table[0] || []);
    setMapping(guessMapping(table[0] || []));
    setParsed(null);
  }

  function validate() {
    setParsed(parsePanelCsv(fileText, mapping));
  }

  async function upload() {
    if (!parsed || parsed.patients.length === 0) return;
    setStatus("Importing");
    const res = await fetch("/api/clinic/uds", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", "x-csrf-token": csrf() },
      body: JSON.stringify({ patients: parsed.patients }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { setStatus(body.error || "Import failed"); return; }
    setStatus(`Imported ${body.imported} patients. This replaces the previous panel.`);
    setFileText(""); setHeaders([]); setParsed(null);
    void load();
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const inAny = data.rows.filter((r) => Object.values(r.measures).some((m) => m && m.status !== "not_in_denominator"));
    if (filter === "outreach") return inAny.filter((r) => r.needsOutreach);
    if (filter === "all") return inAny;
    return inAny.filter((r) => r.measures[filter]?.needsOutreach);
  }, [data, filter]);

  if (denied) {
    return (
      <section className="mt-6">
        <p className="text-sm text-ink-soft">{NOT_STAFF_MESSAGE} <a href="/clinic">Clinic sign-in</a></p>
      </section>
    );
  }

  return (
    <section className="mt-6 space-y-6">
      <AlertQueue />
      <Appointments />
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 p-4">
        <label className="text-sm">
          Reporting year
          <select
            className="field-input"
            value={start.slice(0, 4)}
            onChange={(e) => { setStart(`${e.target.value}-01-01`); setEnd(`${e.target.value}-12-31`); }}
          >
            {[thisYear + 1, thisYear, thisYear - 1, thisYear - 2].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-sm">Start<input type="date" className="field-input" value={start} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="text-sm">End<input type="date" className="field-input" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
        {status && <p className="text-sm text-ink-soft" role="status">{status}</p>}
      </div>

      {data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {data.rates.map((r) => (
              <div key={r.measure} className="rounded-xl border border-slate-200 p-4">
                <p className="font-mono text-xs text-ink-mute">{r.measure}</p>
                <p className="font-semibold">{r.title}</p>
                <p className="mt-2 text-3xl font-bold">{r.percent === null ? "No patients" : `${r.percent}%`}</p>
                <p className="text-sm text-ink-soft">{r.numerator} of {r.denominator} patients. {r.exclusions} excluded.</p>
                <p className="text-xs text-ink-mute">{r.inverse ? "Inverse measure: lower is better. Missing A1C counts as poor control." : r.measure === "CMS165" ? "Higher is better. Missing BP counts as not controlled." : "Higher is better."}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-mute">{data.label || MEASURE_LABEL}</p>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              {(["outreach", "all"] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full border px-3 py-1 text-sm ${filter === f ? "bg-slate-900 text-white" : ""}`}>
                  {f === "outreach" ? "Needs outreach" : "All in a measure"}
                </button>
              ))}
              <label className="text-sm">
                Due for
                <select className="field-input" value={filter === "outreach" || filter === "all" ? "" : filter} onChange={(e) => setFilter((e.target.value || "outreach") as MeasureId | "outreach")}>
                  <option value="">Any measure</option>
                  {data.rates.map((r) => <option key={r.measure} value={r.measure}>{r.measure} {r.title}</option>)}
                </select>
              </label>
              <button type="button" className="ml-auto rounded-full border px-3 py-1 text-sm" onClick={() => download(`uds-gap-list-${data.period.start}-${data.period.end}.csv`, gapListCsv(data.rows))}>
                Export gaps CSV
              </button>
            </div>
            <table className="mt-3 w-full text-left text-sm">
              <thead><tr><th>Patient</th><th>Age</th><th>Gaps due</th><th>CMS165 BP</th><th>Last BP</th><th>CMS122 A1C</th><th>Last A1C</th><th>Source</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const bp = r.cms165.latest as { date: string; systolic: number; diastolic: number } | null;
                  const a = r.cms122.latest as { date: string; value: number } | null;
                  return (
                    <tr key={r.patientId} className="border-t border-slate-100">
                      <td>{r.patientId}</td>
                      <td>{r.age}</td>
                      <td>{r.gapsDue.length ? <ul className="list-disc pl-4">{r.gapsDue.map((g) => <li key={g}>{g}</li>)}</ul> : "None"}</td>
                      <td>{STATUS_LABEL[r.cms165.status]}{r.cms165.exclusion ? ` (${r.cms165.exclusion})` : ""}</td>
                      <td>{bp ? `${bp.systolic}/${bp.diastolic} on ${bp.date}` : ""}</td>
                      <td>{STATUS_LABEL[r.cms122.status]}{r.cms122.exclusion ? ` (${r.cms122.exclusion})` : ""}</td>
                      <td>{a ? `${a.value}% on ${a.date}` : ""}</td>
                      <td>{r.source}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && <p className="mt-2 text-sm text-ink-soft">No patients match this filter.</p>}
          </div>

          <details className="rounded-xl border border-slate-200 p-4 text-sm">
            <summary className="font-semibold">Exclusions and rules this panel cannot check</summary>
            <ul className="mt-2 list-disc pl-5">{data.unsupported_exclusions.map((u) => <li key={u}>{u}</li>)}</ul>
          </details>
        </>
      )}

      <div className="rounded-xl border border-slate-200 p-4">
        <h2 className="font-semibold">Import a patient CSV (clinic admin)</h2>
        <p className="text-sm text-ink-soft">The file is read in this browser. Only valid rows are sent, and the server stores them encrypted for this clinic. A new import replaces the previous panel.</p>
        <div className="mt-2 flex flex-wrap gap-3">
          <button type="button" className="rounded-full border px-3 py-1 text-sm" onClick={() => download("careiq-uds-panel-template.csv", templateCsv())}>Download template</button>
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {headers.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Map your columns</h3>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <label key={f.key} className="text-sm">
                  {f.label}{f.required ? " (required)" : ""} <span className="text-xs text-ink-mute">{f.help}</span>
                  <select
                    className="field-input"
                    value={mapping[f.key] ?? ""}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value === "") delete next[f.key as FieldKey];
                      else next[f.key as FieldKey] = Number(e.target.value);
                      setMapping(next);
                    }}
                  >
                    <option value="">Not in file</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <button type="button" className="mt-3 rounded-full border px-3 py-1 text-sm" onClick={validate}>Check rows</button>
          </div>
        )}
        {parsed && (
          <div className="mt-4 text-sm">
            {parsed.mappingErrors.map((m) => <p key={m} className="text-red-700">{m}</p>)}
            {parsed.mappingErrors.length === 0 && (
              <p>{parsed.patients.length} rows ready. {parsed.errors.length} rows have errors and will be skipped.</p>
            )}
            {parsed.errors.length > 0 && (
              <table className="mt-2 w-full text-left">
                <thead><tr><th>Row</th><th>Patient</th><th>Problem</th></tr></thead>
                <tbody>
                  {parsed.errors.slice(0, 200).map((e) => (
                    <tr key={e.row} className="border-t border-slate-100"><td>{e.row}</td><td>{e.patientId}</td><td>{e.messages.join(" ")}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {parsed.patients.length > 0 && (
              <button type="button" className="mt-3 rounded-full bg-slate-900 px-3 py-1 text-sm text-white" onClick={() => void upload()}>
                Import {parsed.patients.length} patients
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
