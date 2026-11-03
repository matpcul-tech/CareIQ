/**
 * Local answers for the health tab.
 * A question is matched to one written template. Nothing is sent anywhere.
 */

import { buildHealthNarrative, type NarrativeLabs } from "./narrative";
import { buildMealPlan, buildWorkoutPlan, type PlanInput } from "./plans";
import { phraseFor } from "./phrases";
import { statusOf } from "./ranges";
import type { LocalMarker, LocalSex, MarkerValue } from "./types";
import { finishOutput, wordingProblems } from "./wording";

export interface ChatContext extends PlanInput {
  heartRate?: number;
  spo2?: number;
  weight?: number;
  egfr?: number;
}

export const SUGGESTED_QUESTIONS = [
  "What is my blood pressure?",
  "What is my A1C?",
  "What is my fasting glucose?",
  "What is my LDL?",
  "What are my triglycerides?",
  "What is my HDL?",
  "What is my TSH?",
  "What is my vitamin D?",
  "What steps are on file?",
  "What movement can I ask about?",
  "What meals can I ask about?",
  "What conditions are on file?",
  "Give me a summary",
];

export interface LocalAnswer {
  id: string | null;
  matched: boolean;
  text: string;
  suggestions: string[];
}

interface Template {
  id: string;
  test: (q: string) => boolean;
  answer: (ctx: ChatContext, day: number) => string;
}

function norm(question: string): string {
  return question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function has(q: string, phrase: string): boolean {
  return q.includes(phrase);
}

function word(q: string, token: string): boolean {
  return new RegExp(`(?:^|\\s)${token}(?:\\s|$)`).test(q);
}

function markerLine(key: LocalMarker, value: MarkerValue | null | undefined, sex: LocalSex): string {
  const status = statusOf(key, value, sex);
  return phraseFor(key, status, value ?? null, sex);
}

function numberOr(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function shown(n: number | undefined): string | null {
  if (n === undefined) return null;
  return String(Math.round(n));
}

const TEMPLATES: Template[] = [
  {
    id: "vitamin_d",
    test: (q) => has(q, "vitamin d"),
    answer: (ctx) => markerLine("vitamin_d", ctx.labs?.vitaminD, ctx.sex ?? "unknown"),
  },
  {
    id: "tsh",
    test: (q) => has(q, "tsh") || has(q, "thyroid"),
    answer: (ctx) => markerLine("tsh", ctx.labs?.tsh, ctx.sex ?? "unknown"),
  },
  {
    id: "triglycerides",
    test: (q) => has(q, "triglyceride"),
    answer: (ctx) => markerLine("triglycerides", ctx.labs?.triglycerides, ctx.sex ?? "unknown"),
  },
  {
    id: "hdl",
    test: (q) => word(q, "hdl"),
    answer: (ctx) => markerLine("hdl", ctx.labs?.hdl, ctx.sex ?? "unknown"),
  },
  {
    id: "ldl",
    test: (q) => word(q, "ldl"),
    answer: (ctx) => markerLine("ldl", ctx.labs?.ldl, ctx.sex ?? "unknown"),
  },
  {
    id: "cholesterol",
    test: (q) => has(q, "cholesterol"),
    answer: (ctx) => {
      const sex = ctx.sex ?? "unknown";
      return [
        markerLine("ldl", ctx.labs?.ldl, sex),
        markerLine("hdl", ctx.labs?.hdl, sex),
        markerLine("triglycerides", ctx.labs?.triglycerides, sex),
      ].join(" ");
    },
  },
  {
    id: "a1c",
    test: (q) => has(q, "a1c") || has(q, "a 1 c"),
    answer: (ctx) => markerLine("a1c", ctx.labs?.a1c, ctx.sex ?? "unknown"),
  },
  {
    id: "glucose",
    test: (q) => has(q, "glucose") || has(q, "blood sugar") || word(q, "sugar"),
    answer: (ctx) => markerLine("fasting_glucose", ctx.labs?.fastingGlucose, ctx.sex ?? "unknown"),
  },
  {
    id: "bp",
    test: (q) => has(q, "blood pressure") || word(q, "bp"),
    answer: (ctx) => {
      const labs = ctx.labs ?? {};
      const reading =
        numberOr(labs.bpSystolic) !== undefined && numberOr(labs.bpDiastolic) !== undefined
          ? { systolic: labs.bpSystolic as number, diastolic: labs.bpDiastolic as number }
          : null;
      return markerLine("bp", reading, ctx.sex ?? "unknown");
    },
  },
  {
    id: "steps",
    test: (q) => has(q, "step"),
    answer: (ctx) => {
      const n = shown(numberOr(ctx.steps));
      if (!n) return "No step count is on file. Talk with your care team about movement that fits.";
      return `Steps on the latest reading: ${n}. Talk with your care team about what that means for movement.`;
    },
  },
  {
    id: "movement",
    test: (q) => has(q, "workout") || has(q, "exercise") || has(q, "movement") || has(q, "activity") || has(q, "walk"),
    answer: (ctx, day) => buildWorkoutPlan(ctx, day),
  },
  {
    id: "meals",
    test: (q) =>
      word(q, "meal") || word(q, "meals") || word(q, "food") || word(q, "eat") || word(q, "eating") ||
      has(q, "breakfast") || has(q, "lunch") || has(q, "dinner") || word(q, "diet") || has(q, "nutrition"),
    answer: (ctx, day) => buildMealPlan(ctx, day),
  },
  {
    id: "conditions",
    test: (q) => has(q, "condition") || has(q, "history"),
    answer: (ctx) => {
      const list = (ctx.conditions ?? [])
        .map((c) => c.trim())
        .filter((c) => c && wordingProblems(c).length === 0);
      if (list.length === 0) return "No recorded conditions are on file. Talk with your care team about history.";
      return `Recorded conditions on file: ${list.join(", ")}. Talk with your care team about them.`;
    },
  },
  {
    id: "heart_rate",
    test: (q) => has(q, "heart rate") || has(q, "pulse"),
    answer: (ctx) => {
      const n = shown(numberOr(ctx.heartRate));
      if (!n) return "No heart rate is on file for this note. Talk with your care team about a reading from a visit or a file.";
      return `Heart rate on file is ${n} bpm. This note does not label it. Talk with your care team about this result.`;
    },
  },
  {
    id: "oxygen",
    test: (q) => has(q, "oxygen") || has(q, "spo2") || word(q, "o2"),
    answer: (ctx) => {
      const n = shown(numberOr(ctx.spo2));
      if (!n) return "No oxygen saturation is on file for this note. Talk with your care team about a reading.";
      return `Oxygen saturation on file is ${n} percent. This note does not label it. Talk with your care team about this result.`;
    },
  },
  {
    id: "sleep",
    test: (q) => has(q, "sleep"),
    answer: () => "No sleep hours are on this local note. Talk with your care team about sleep.",
  },
  {
    id: "weight",
    test: (q) => has(q, "weight"),
    answer: (ctx) => {
      const n = shown(numberOr(ctx.weight));
      if (!n) return "No weight is on file for this note. Talk with your care team about weight.";
      return `Weight on file is ${n}. This note does not label it. Talk with your care team about this result.`;
    },
  },
  {
    id: "kidney",
    test: (q) => has(q, "kidney") || has(q, "egfr"),
    answer: (ctx) => {
      const n = shown(numberOr(ctx.egfr));
      if (!n) return "No eGFR is on file for this note. Talk with your care team about kidney labs.";
      return `eGFR on file is ${n}. This note does not label kidney function. Talk with your care team about this result.`;
    },
  },
  {
    id: "medicine",
    test: (q) => has(q, "medication") || has(q, "medicine") || has(q, "dose") || has(q, "supplement") || has(q, "pill"),
    answer: () => "This note does not suggest a medicine or an amount. Talk with your care team about medicines on the record.",
  },
  {
    id: "label",
    test: (q) => has(q, "diagnos"),
    answer: () => "This note does not put a name on a condition. Talk with your care team about the results on file.",
  },
  {
    id: "range",
    test: (q) => has(q, "normal") || has(q, "range") || has(q, "target"),
    answer: () => "The cut points used here are the published ones for blood pressure, A1C, fasting glucose, LDL, triglycerides, HDL, TSH, and vitamin D. Talk with your care team about which ones apply.",
  },
  {
    id: "summary",
    test: (q) => has(q, "summary") || has(q, "overview") || has(q, "how am i") || has(q, "narrative"),
    answer: (ctx) => buildHealthNarrative({ labs: ctx.labs as NarrativeLabs | undefined, sex: ctx.sex, conditions: ctx.conditions }),
  },
  {
    id: "hello",
    test: (q) => word(q, "hello") || word(q, "hi") || word(q, "hey"),
    answer: () => "Hello. Ask about a result on file, movement, or meals. Talk with your care team about anything urgent.",
  },
  {
    id: "care_team",
    test: (q) => has(q, "care team") || has(q, "doctor") || has(q, "clinic") || has(q, "fqhc"),
    answer: () => "Talk with your care team about results, movement, and meals. This note cannot contact them.",
  },
  {
    id: "help",
    test: (q) => has(q, "help") || has(q, "what can you") || has(q, "what can i ask"),
    answer: () => `Questions with a local answer include: ${SUGGESTED_QUESTIONS.join(" ")} Talk with your care team about anything else.`,
  },
];

export const LOCAL_TEMPLATE_COUNT = TEMPLATES.length;

export function localTemplateId(question: string): string | null {
  const q = norm(question);
  if (!q) return null;
  const found = TEMPLATES.find((template) => template.test(q));
  return found ? found.id : null;
}

function miss(): LocalAnswer {
  const list = SUGGESTED_QUESTIONS.map((q) => `- ${q}`).join("\n");
  return {
    id: null,
    matched: false,
    suggestions: [...SUGGESTED_QUESTIONS],
    text: finishOutput(`No local answer is written for that question.\n\nHere are questions you can ask:\n${list}`),
  };
}

export function answerLocally(question: string, ctx: ChatContext = {}, dayOfWeek = new Date().getDay()): LocalAnswer {
  const q = norm(question);
  const template = TEMPLATES.find((item) => item.test(q));
  if (!template) return miss();
  const body = template.answer(ctx, dayOfWeek);
  const text = body.trim().endsWith("This is general information, not a diagnosis.")
    ? body.trim()
    : finishOutput(body);
  return { id: template.id, matched: true, text, suggestions: [] };
}
