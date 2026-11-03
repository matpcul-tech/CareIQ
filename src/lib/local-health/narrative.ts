/**
 * Today's health note, built only from labs and recorded conditions.
 * Domain scores are not an input, so they cannot become condition labels.
 * The same input always returns the same text.
 */

import { phraseFor } from "./phrases";
import { statusOf } from "./ranges";
import type { LocalMarker, LocalSex, MarkerValue } from "./types";
import { finishOutput, wordingProblems } from "./wording";

export interface NarrativeLabs {
  a1c?: number;
  ldl?: number;
  hdl?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  tsh?: number;
  vitaminD?: number;
}

export interface NarrativeInput {
  labs?: NarrativeLabs | null;
  sex?: LocalSex;
  conditions?: string[];
}

const MAX_ITEMS = 3;

function finite(n: number | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function flagged(key: LocalMarker, value: MarkerValue | null | undefined, sex: LocalSex): string | null {
  const status = statusOf(key, value, sex);
  if (status === "missing" || status === "in_range") return null;
  return phraseFor(key, status, value, sex);
}

function hasRelevantLab(labs: NarrativeLabs): boolean {
  if (finite(labs.bpSystolic) && finite(labs.bpDiastolic)) return true;
  return [
    labs.a1c,
    labs.fastingGlucose,
    labs.ldl,
    labs.triglycerides,
    labs.hdl,
    labs.tsh,
    labs.vitaminD,
  ].some(finite);
}

function glucoseItem(labs: NarrativeLabs, sex: LocalSex): string | null {
  const parts = [
    flagged("a1c", labs.a1c, sex),
    flagged("fasting_glucose", labs.fastingGlucose, sex),
  ].filter((part): part is string => Boolean(part));
  if (parts.length === 0) return null;
  return parts.join(" ");
}

function labItems(labs: NarrativeLabs, sex: LocalSex): string[] {
  const reading =
    finite(labs.bpSystolic) && finite(labs.bpDiastolic)
      ? { systolic: labs.bpSystolic, diastolic: labs.bpDiastolic }
      : null;
  const ordered = [
    flagged("bp", reading, sex),
    glucoseItem(labs, sex),
    flagged("ldl", labs.ldl, sex),
    flagged("triglycerides", labs.triglycerides, sex),
    flagged("hdl", labs.hdl, sex),
    flagged("tsh", labs.tsh, sex),
    flagged("vitamin_d", labs.vitaminD, sex),
  ];
  const items: string[] = [];
  for (const item of ordered) {
    if (!item) continue;
    items.push(item);
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

function recordedConditions(conditions: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of conditions ?? []) {
    const text = raw.trim();
    if (!text) continue;
    if (wordingProblems(text).length > 0) continue;
    out.push(text);
  }
  return out;
}

export function buildHealthNarrative(input: NarrativeInput): string {
  const sex = input.sex ?? "unknown";
  const labs = input.labs ?? {};
  const conditions = recordedConditions(input.conditions);
  const labsOnFile = hasRelevantLab(labs);
  const blocks: string[] = [];

  if (!labsOnFile && conditions.length === 0) {
    blocks.push("No lab results or recorded conditions are on file.");
  } else if (!labsOnFile) {
    blocks.push("No lab results are on file.");
    blocks.push(`Recorded conditions on file: ${conditions.join(", ")}.`);
  } else {
    const items = labItems(labs, sex);
    if (items.length === 0) {
      blocks.push("The lab results on file are inside the cut points used here.");
    } else {
      blocks.push(...items);
    }
    if (conditions.length > 0) {
      blocks.push(`Recorded conditions on file: ${conditions.join(", ")}.`);
    }
  }

  blocks.push("Talk with your care team about what is on file.");
  return finishOutput(blocks.join("\n\n"));
}
