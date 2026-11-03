/**
 * Local workout and meal ideas.
 * A bucket is chosen from recorded conditions, lab status, and steps.
 * The day of week picks one written option so the text stays the same all day.
 * Nothing here is an intensity order, a dose, or a supplement.
 */

import type { NarrativeLabs } from "./narrative";
import { statusOf } from "./ranges";
import type { LocalSex } from "./types";
import { finishOutput, wordingProblems } from "./wording";

export interface PlanInput {
  labs?: NarrativeLabs | null;
  sex?: LocalSex;
  conditions?: string[];
  steps?: number;
}

type Bucket = "cautious" | "pressure" | "glucose" | "lipids" | "general";

const STEP_NOTE_UNDER = 5000;

const CAUTIOUS_WORDS = ["heart", "hypert", "pressure", "chest", "pregnan", "dizzy", "faint"];

const WORKOUTS: Record<Bucket, string[]> = {
  cautious: [
    "An easy walk is one option to ask about.",
    "Seated stretching is one option to ask about.",
    "A slow stroll is one option to ask about.",
    "Light housework, such as tidying a room, is one option to ask about.",
    "Standing up from a chair a few times is one option to ask about.",
    "A short walk with someone else is one option to ask about.",
    "Gentle range of motion for the shoulders and hips is one option to ask about.",
  ],
  pressure: [
    "A comfortable walk is one option to ask about.",
    "Easy cycling on a flat path is one option to ask about.",
    "Stretching while seated is one option to ask about.",
    "A calm walk after breakfast is one option to ask about.",
    "Water walking, if a pool is available, is one option to ask about.",
    "A familiar neighborhood loop is one option to ask about.",
    "Breathing room between chores is one option to ask about.",
  ],
  glucose: [
    "A walk after a meal is one option to ask about.",
    "A short stroll between meals is one option to ask about.",
    "Standing and moving during the day is one option to ask about.",
    "A walk with a friend after lunch is one option to ask about.",
    "Easy movement in the evening is one option to ask about.",
    "A familiar walk near home is one option to ask about.",
    "Breaking up long sitting time is one option to ask about.",
  ],
  lipids: [
    "Regular walking through the week is one option to ask about.",
    "A bike ride at an easy pace is one option to ask about.",
    "Dancing at home is one option to ask about.",
    "A walk on most days is one option to ask about.",
    "Climbing stairs slowly, if that already feels familiar, is one option to ask about.",
    "A park walk is one option to ask about.",
    "Moving during phone calls is one option to ask about.",
  ],
  general: [
    "Keep any movement that already feels comfortable, and ask before adding more.",
    "A walk you already enjoy is one option to ask about.",
    "Stretching after sitting is one option to ask about.",
    "A relaxed bike ride is one option to ask about.",
    "Time outside for a walk is one option to ask about.",
    "A familiar routine is one option to ask about.",
    "Light movement with the day you already have is one option to ask about.",
  ],
};

const MEALS: Record<Bucket, string[]> = {
  cautious: [
    "Oatmeal, beans, and fruit are simple foods to ask about.",
    "Rice, lentils, and cooked vegetables are simple foods to ask about.",
    "Eggs, greens, and potatoes are simple foods to ask about.",
    "Bean soup and bread are simple foods to ask about.",
    "Baked fish, rice, and vegetables are simple foods to ask about.",
    "Yogurt and berries, if they sit well, are simple foods to ask about.",
    "A vegetable stew with beans is a simple meal to ask about.",
  ],
  pressure: [
    "Meals cooked with less added salt, such as oats, beans, and vegetables, are options to ask about.",
    "Fresh fruit, rice, and beans, seasoned with herbs instead of a salty mix, are options to ask about.",
    "A lentil bowl with tomatoes and greens is an option to ask about.",
    "Baked chicken, potatoes, and a salad are options to ask about.",
    "Vegetable soup made at home is an option to ask about.",
    "Eggs with vegetables and fruit are options to ask about.",
    "Chickpeas, rice, and cucumber are options to ask about.",
  ],
  glucose: [
    "Beans, vegetables, and eggs are foods to ask about.",
    "Lentils with greens and a piece of fruit are foods to ask about.",
    "Unsweetened oatmeal with berries is a food to ask about.",
    "A chicken and vegetable plate is a meal to ask about.",
    "Tofu or beans with roasted vegetables is a meal to ask about.",
    "Soup with beans and a side of fruit is a meal to ask about.",
    "Eggs, salad, and a plain potato are foods to ask about.",
  ],
  lipids: [
    "Oats, beans, and vegetables are foods to ask about.",
    "Fish with greens and rice is a meal to ask about.",
    "Lentil stew and fruit are foods to ask about.",
    "A bean and vegetable bowl is a meal to ask about.",
    "Baked fish with potatoes and salad is a meal to ask about.",
    "Chickpeas, tomatoes, and greens are foods to ask about.",
    "Oatmeal and fruit in the morning is a food to ask about.",
  ],
  general: [
    "A home meal of beans, vegetables, and rice is one option to ask about.",
    "Eggs, fruit, and toast are foods to ask about.",
    "Soup and a salad are foods to ask about.",
    "Chicken, potatoes, and greens are foods to ask about.",
    "Lentils and roasted vegetables are foods to ask about.",
    "Yogurt, fruit, and oats are foods to ask about.",
    "A familiar home plate is something to ask about.",
  ],
};

const BUCKET_REASON: Record<Bucket, string> = {
  cautious: "This note follows a recorded condition on file, so it stays gentle.",
  pressure: "This note follows the blood pressure result on file.",
  glucose: "This note follows the A1C or fasting glucose result on file.",
  lipids: "This note follows the cholesterol results on file.",
  general: "The results on file are inside the cut points used here, so this is a general idea.",
};

function dayIndex(dayOfWeek: number): number {
  const day = Math.trunc(dayOfWeek);
  return ((day % 7) + 7) % 7;
}

function outOfRange(status: string): boolean {
  return status !== "in_range" && status !== "missing";
}

function cautiousCondition(conditions: string[] | undefined): boolean {
  for (const raw of conditions ?? []) {
    const text = raw.trim().toLowerCase();
    if (!text || wordingProblems(raw).length > 0) continue;
    if (CAUTIOUS_WORDS.some((word) => text.includes(word))) return true;
  }
  return false;
}

export function planBucket(input: PlanInput): Bucket {
  const sex = input.sex ?? "unknown";
  const labs = input.labs ?? {};
  if (cautiousCondition(input.conditions)) return "cautious";
  if (
    typeof labs.bpSystolic === "number" &&
    typeof labs.bpDiastolic === "number" &&
    outOfRange(statusOf("bp", { systolic: labs.bpSystolic, diastolic: labs.bpDiastolic }, sex))
  ) {
    return "pressure";
  }
  const glucoseFlags = [
    typeof labs.a1c === "number" && outOfRange(statusOf("a1c", labs.a1c, sex)),
    typeof labs.fastingGlucose === "number" && outOfRange(statusOf("fasting_glucose", labs.fastingGlucose, sex)),
  ];
  if (glucoseFlags.some(Boolean)) return "glucose";
  const lipidFlags = [
    typeof labs.ldl === "number" && outOfRange(statusOf("ldl", labs.ldl, sex)),
    typeof labs.triglycerides === "number" && outOfRange(statusOf("triglycerides", labs.triglycerides, sex)),
    typeof labs.hdl === "number" && outOfRange(statusOf("hdl", labs.hdl, sex)),
  ];
  if (lipidFlags.some(Boolean)) return "lipids";
  return "general";
}

const LOW_STEP_NOTES = [
  "The latest step count is under 5000, so a shorter walk is one extra option to ask about.",
  "The latest step count is under 5000, so a few minutes of easy standing is one extra option to ask about.",
  "The latest step count is under 5000, so a stroll after one meal is one extra option to ask about.",
  "The latest step count is under 5000, so moving during a phone call is one extra option to ask about.",
  "The latest step count is under 5000, so a walk with someone else is one extra option to ask about.",
  "The latest step count is under 5000, so stretching while seated is one extra option to ask about.",
  "The latest step count is under 5000, so a familiar loop close to home is one extra option to ask about.",
];

function stepLine(steps: number | undefined, dayOfWeek: number): string | null {
  if (typeof steps !== "number" || !Number.isFinite(steps) || steps <= 0) return null;
  const shown = String(Math.round(steps));
  if (steps < STEP_NOTE_UNDER) {
    return `Steps on the latest reading: ${shown}. ${LOW_STEP_NOTES[dayIndex(dayOfWeek)]}`;
  }
  return `Steps on the latest reading: ${shown}.`;
}

function compose(kind: "workout" | "meal", input: PlanInput, dayOfWeek: number): string {
  const bucket = planBucket(input);
  const bank = kind === "workout" ? WORKOUTS[bucket] : MEALS[bucket];
  const option = bank[dayIndex(dayOfWeek)];
  const blocks = [
    "Check with your care team before starting.",
    option,
    BUCKET_REASON[bucket],
  ];
  const steps = stepLine(input.steps, dayOfWeek);
  if (steps) blocks.push(steps);
  blocks.push("Talk with your care team about what is on file.");
  return finishOutput(blocks.join("\n\n"));
}

export function buildWorkoutPlan(input: PlanInput, dayOfWeek: number): string {
  return compose("workout", input, dayOfWeek);
}

export function buildMealPlan(input: PlanInput, dayOfWeek: number): string {
  return compose("meal", input, dayOfWeek);
}
