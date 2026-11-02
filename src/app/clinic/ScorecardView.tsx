import React from "react";

function pct(value: unknown): string {
  if (typeof value !== "number") return "n/a";
  return `${(value * 100).toFixed(1)}%`;
}

export default function ScorecardView({ card }: { card: Record<string, unknown> }) {
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
          <h2 className="font-semibold break-words">{String(measure.name)}</h2>
          <p>Estimated rate {pct(measure.rate)} ({String(measure.numerator)}/{String(measure.denominator)})</p>
          <p className="break-words">Target {pct(measure.target)} ({String(measure.target_source)}). Gap {pct(measure.gap)}. Patients to close it: {String(measure.needed ?? "set a target")}.</p>
          <p className="break-words text-ink-soft">{Array.isArray(measure.patients) && measure.patients.length > 0 ? measure.patients.join(", ") : "No gap patients."}</p>
          <p className="break-words text-ink-soft">{String(measure.note || "")}</p>
        </article>
      ))}
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Estimated MCO P4P dollars</h2>
        <p className="break-words">{String(p4p.label || "")}</p>
        <p className="break-words">$40 {String(combined.p40 ?? 0)}, $80 {String(combined.p80 ?? 0)}, $100 {String(combined.p100 ?? 0)} for CBP plus GSD.</p>
      </article>
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Estimated care management dollars</h2>
        <p className="break-words">{String(care.label || "")}</p>
        <p>RPM estimate ${String(care.rpm_dollars ?? 0)} for {String(care.month || "")}.</p>
        <p className="break-words">{String((care.ccm_apcm as { label?: string } | undefined)?.label || "")}</p>
      </article>
      <article className="rounded-xl border border-slate-200 p-3">
        <h2 className="font-semibold">Patients who would close a gap</h2>
        <ul className="break-words">
          {worklist.map((item) => (
            <li key={String(item.external_id)} className="mt-1">
              {String(item.external_id)}: {Array.isArray(item.measures) ? item.measures.join(", ") : ""}
            </li>
          ))}
        </ul>
        {worklist.length === 0 && <p className="text-ink-soft">No open gaps against the current targets.</p>}
      </article>
    </div>
  );
}
