"use client";

import { useState } from "react";
import type { ColumnMap } from "@/lib/wearable/csv";
import { prepareWearableFile, summaryFromColumnMap, type MappingRequest } from "@/lib/wearable/prepare";

const FIELDS: Array<{ key: keyof ColumnMap; label: string }> = [
  { key: "date", label: "Date" },
  { key: "heartRate", label: "Heart rate" },
  { key: "steps", label: "Steps" },
  { key: "sleep", label: "Sleep" },
  { key: "spo2", label: "Blood oxygen" },
  { key: "calories", label: "Calories" },
  { key: "bpSystolic", label: "Systolic blood pressure" },
  { key: "bpDiastolic", label: "Diastolic blood pressure" },
  { key: "glucose", label: "Glucose" },
  { key: "weight", label: "Weight" },
  { key: "hrv", label: "Heart rate variability" },
];

function csrf(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!match) return "";
  return decodeURIComponent(match[1]).split(".")[0];
}

async function postSummary(summary: unknown): Promise<Response> {
  const form = new FormData();
  form.set("zone", "wearable");
  form.set("summary", JSON.stringify(summary));
  return fetch("/api/onboard/upload", {
    method: "POST",
    headers: { "x-csrf-token": csrf() },
    body: form,
    credentials: "same-origin",
  });
}

export default function WearableUpload({ variant = "light" }: { variant?: "light" | "dark" }) {
  const dark = variant === "dark";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);
  const [mapping, setMapping] = useState<MappingRequest | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [weightUnit, setWeightUnit] = useState<"" | "lb" | "kg">("");
  const [glucoseUnit, setGlucoseUnit] = useState<"" | "mg/dL" | "mmol/L">("");

  async function sendSummary(summary: unknown) {
    const res = await postSummary(summary);
    if (res.status === 401) {
      setOk(false);
      setMessage("Sign in to upload this summary.");
      return;
    }
    if (!res.ok) {
      setOk(false);
      setMessage("The summary was rejected. Nothing was stored.");
      return;
    }
    const data = await res.json().catch(() => ({}));
    const days = typeof data.metrics === "number" ? data.metrics : 0;
    setOk(true);
    setMessage(`Saved ${days} day${days === 1 ? "" : "s"} from this device. The original file stayed on this device.`);
    setMapping(null);
  }

  async function onFile(file: File) {
    setBusy(true);
    setMessage("");
    setMapping(null);
    try {
      const prepared = await prepareWearableFile(file);
      if (!prepared.ok && "needsMapping" in prepared) {
        setMapping(prepared.mapping);
        setChoice({});
        setWeightUnit("");
        setGlucoseUnit("");
        setOk(false);
        setMessage("Match your columns, then save the summary.");
        return;
      }
      if (!prepared.ok) {
        setOk(false);
        setMessage(prepared.error);
        return;
      }
      await sendSummary(prepared.summary);
    } catch {
      setOk(false);
      setMessage("That file could not be read on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMapped() {
    if (!mapping) return;
    const dateIndex = Number(choice.date);
    if (!Number.isInteger(dateIndex) || dateIndex < 0) {
      setOk(false);
      setMessage("Choose the date column.");
      return;
    }
    const map: ColumnMap = { date: dateIndex };
    for (const field of FIELDS) {
      if (field.key === "date") continue;
      const raw = choice[field.key];
      if (raw == null || raw === "") continue;
      (map as unknown as Record<string, number>)[field.key] = Number(raw);
    }
    if (map.weight != null) {
      if (weightUnit !== "lb" && weightUnit !== "kg") {
        setOk(false);
        setMessage("Choose pounds or kilograms for weight.");
        return;
      }
      map.weightUnit = weightUnit;
    }
    if (map.glucose != null) {
      if (glucoseUnit !== "mg/dL" && glucoseUnit !== "mmol/L") {
        setOk(false);
        setMessage("Choose a glucose unit.");
        return;
      }
      map.glucoseUnit = glucoseUnit;
    }
    setBusy(true);
    try {
      const prepared = summaryFromColumnMap(mapping, map);
      if (!prepared.ok) {
        setOk(false);
        setMessage("error" in prepared ? prepared.error : "No daily metrics were found.");
        return;
      }
      await sendSummary(prepared.summary);
    } finally {
      setBusy(false);
    }
  }

  const text = dark ? "#eef2f8" : undefined;
  const muted = dark ? "#a3b5cc" : undefined;

  return (
    <div className={dark ? "card" : ""}>
      <div className="font-bold" style={{ color: text }}>Upload an export from any device</div>
      <p className="mb-2 text-sm" style={{ color: muted }}>
        This is not a live connection and does not track RPM time. CSV, JSON, XML, ZIP, and FIT files are read on this device. Only a daily summary is uploaded.
      </p>
      <input
        type="file"
        accept=".csv,.json,.xml,.zip,.fit"
        disabled={busy}
        aria-label="Upload an export from any device"
        className="block w-full text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void onFile(file);
        }}
      />
      {mapping && (
        <div className="mt-3 flex flex-col gap-2">
          <div className="text-sm font-semibold" style={{ color: text }}>Match your columns</div>
          {FIELDS.map((field) => (
            <label key={field.key} className="text-sm" style={{ color: text }}>
              {field.label}
              <select
                className="field-input mt-1"
                value={choice[field.key] ?? ""}
                onChange={(event) => setChoice((prev) => ({ ...prev, [field.key]: event.target.value }))}
              >
                <option value="">{field.key === "date" ? "Choose a column" : "Skip"}</option>
                {mapping.headers.map((header, index) => (
                  <option key={`${header}-${index}`} value={String(index)}>{header || `Column ${index + 1}`}</option>
                ))}
              </select>
            </label>
          ))}
          <label className="text-sm" style={{ color: text }}>
            Weight unit
            <select className="field-input mt-1" value={weightUnit} onChange={(event) => setWeightUnit(event.target.value as "" | "lb" | "kg")}>
              <option value="">Choose if you mapped weight</option>
              <option value="lb">Pounds</option>
              <option value="kg">Kilograms</option>
            </select>
          </label>
          <label className="text-sm" style={{ color: text }}>
            Glucose unit
            <select className="field-input mt-1" value={glucoseUnit} onChange={(event) => setGlucoseUnit(event.target.value as "" | "mg/dL" | "mmol/L")}>
              <option value="">Choose if you mapped glucose</option>
              <option value="mg/dL">mg/dL</option>
              <option value="mmol/L">mmol/L</option>
            </select>
          </label>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => void saveMapped()}>
            {busy ? "Saving..." : "Save summary"}
          </button>
        </div>
      )}
      {message && (
        <div className={`mt-2 ${ok ? "alert-success" : "alert-error"}`} role="status">{message}</div>
      )}
    </div>
  );
}
