"use client";

import { useState } from "react";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

export default function InsightButton() {
  const [busy, setBusy] = useState(false);
  const [insight, setInsight] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function generate() {
    setBusy(true);
    setError("");
    setInsight("");
    try {
      const res = await fetch("/api/shield", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({}),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (typeof data?.insight === "string") {
        setInsight(data.insight);
      } else {
        setError("Unable to generate insight right now.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <button type="button" onClick={generate} disabled={busy} className="btn-primary">
        {busy ? "Generating..." : "Generate AI Health Insight"}
      </button>
      {insight && (
        <div
          className="mt-3 whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed"
          style={{ background: "#111827", color: "#e2e8f0" }}
        >
          {insight}
        </div>
      )}
      {error && <div className="alert-error mt-3">{error}</div>}
    </div>
  );
}
