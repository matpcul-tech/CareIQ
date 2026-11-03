"use client";

import { buildHealthNarrative, type NarrativeInput } from "@/lib/local-health";

export default function InsightButton({
  aiEnabled = false,
  facts,
}: {
  aiEnabled?: boolean;
  facts: NarrativeInput;
}) {
  const text = buildHealthNarrative(facts);
  return (
    <div
      className="mt-3 whitespace-pre-wrap rounded-xl p-4 text-sm leading-relaxed"
      data-ai-enabled={aiEnabled ? "true" : "false"}
      style={{ background: "#111827", color: "#e2e8f0" }}
    >
      {text}
    </div>
  );
}
