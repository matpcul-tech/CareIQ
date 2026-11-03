/**
 * Local weekly activity plan. No AI, no network. Same data in, same plan out.
 *
 * Sources used for the rules below:
 * - U.S. Department of Health and Human Services, Physical Activity
 *   Guidelines for Americans, 2nd edition (2018). Adults: 150 minutes a week
 *   of moderate aerobic activity, or 75 minutes vigorous, muscle
 *   strengthening on 2 or more days, balance training for older adults, and
 *   for inactive people start low and build up gradually.
 * - American Heart Association, Recommendations for Physical Activity in
 *   Adults and Kids. Same weekly targets, and the talk test for intensity.
 * - 2017 ACC/AHA High Blood Pressure Guideline categories: normal under
 *   120/80, elevated 120 to 129 with diastolic under 80, stage 1 130 to 139
 *   or 80 to 89, stage 2 at or above 140 or 90. A reading at or above 180 or
 *   120 is treated here as a reason to contact the care team now, with no plan.
 *
 * Every number shown comes from data on file or from the guideline targets.
 * When a value is missing the plan says so and never fills one in.
 */

import { DISCLAIMER } from "./wording";

export type BpCategory = "normal" | "elevated" | "stage1" | "stage2" | "very_high" | "missing";
export type Intensity = "rest" | "light" | "moderate" | "vigorous";

export interface WeeklyPlanInput {
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  /** Moderate minutes per week from the Life's Essential 8 questionnaire. */
  moderateMinutesPerWeek?: number | null;
  /** Vigorous minutes per week from the Life's Essential 8 questionnaire. */
  vigorousMinutesPerWeek?: number | null;
  ageYears?: number | null;
  bmi?: number | null;
  /** Daily step totals from an uploaded wearable summary. */
  dailySteps?: number[] | null;
  /** Daily heart rate values from an uploaded wearable summary. */
  dailyHeartRate?: number[] | null;
}

export interface PlanDay {
  day: string;
  activity: string;
  minutes: number;
  intensity: Intensity;
  intensityNote: string;
  /** Minutes that count toward the weekly aerobic target. Vigorous counts double. */
  aerobicCredit: number;
}

export interface WeeklyPlan {
  status: "plan" | "contact_care_team";
  bpCategory: BpCategory;
  urgentMessage: string | null;
  days: PlanDay[];
  weeklyMinutes: number;
  weeklyTarget: number;
  stepUp: string;
  stepGoal: number | null;
  averageSteps: number | null;
  safety: string[];
  basedOn: string[];
  missing: string[];
  text: string;
}

export const WEEKLY_TARGET_MINUTES = 150;
/** Careful starting week when activity on file is low or missing. */
export const START_LOW_MINUTES = 60;
/** Weekly build step. HHS advises small, gradual increases. */
export const WEEKLY_INCREASE = 20;
/** Upper bound for a step goal so the step up stays sensible. */
export const STEP_GOAL_CAP = 12000;
export const STEP_GOAL_ADD = 1000;
export const OLDER_ADULT_AGE = 65;

export const URGENT_MESSAGE =
  "Your blood pressure on file is 180/120 or higher. Please contact your care team now before doing any exercise. If you also notice chest pain, shortness of breath, back pain, numbness, weakness, trouble speaking, or a change in vision, call 911.";

const TALK = {
  light: "Light: easy breathing, you can sing. About 2 to 3 on a 0 to 10 effort scale.",
  moderate: "Moderate: you can talk, but not sing. About 5 to 6 on a 0 to 10 effort scale.",
  vigorous: "Vigorous: you can say only a few words before a breath. About 7 to 8 on a 0 to 10 effort scale.",
  strength: "Moderate effort: the last 2 reps feel hard, and you keep breathing the whole time.",
  rest: "Rest or easy movement around the house.",
};

const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function bpCategory(sys?: number | null, dia?: number | null): BpCategory {
  if (!finite(sys) || !finite(dia) || sys <= 0 || dia <= 0) return "missing";
  if (sys >= 180 || dia >= 120) return "very_high";
  if (sys >= 140 || dia >= 90) return "stage2";
  if (sys >= 130 || dia >= 80) return "stage1";
  if (sys >= 120) return "elevated";
  return "normal";
}

const BP_LABEL: Record<BpCategory, string> = {
  normal: "normal range",
  elevated: "elevated range",
  stage1: "stage 1 high range (130 to 139 over 80 to 89)",
  stage2: "stage 2 high range (140 or more over 90 or more)",
  very_high: "very high range (180 or more over 120 or more)",
  missing: "not on file",
};

function average(values: number[] | null | undefined, min: number, max: number): number | null {
  const ok = (values ?? []).filter((v) => finite(v) && v >= min && v <= max);
  if (ok.length === 0) return null;
  return Math.round(ok.reduce((a, b) => a + b, 0) / ok.length);
}

export function stepGoalFrom(avg: number | null): number | null {
  if (avg === null) return null;
  if (avg >= STEP_GOAL_CAP) return Math.round(avg / 100) * 100;
  return Math.min(STEP_GOAL_CAP, Math.round((avg + STEP_GOAL_ADD) / 100) * 100);
}

const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

function urgentPlan(sys: number, dia: number): WeeklyPlan {
  const text = [
    "Contact your care team now.",
    `Blood pressure on file: ${sys}/${dia}.`,
    URGENT_MESSAGE,
    "No exercise plan is shown until your care team says it is safe.",
    DISCLAIMER,
  ].join("\n\n");
  return {
    status: "contact_care_team",
    bpCategory: "very_high",
    urgentMessage: URGENT_MESSAGE,
    days: [],
    weeklyMinutes: 0,
    weeklyTarget: WEEKLY_TARGET_MINUTES,
    stepUp: "",
    stepGoal: null,
    averageSteps: null,
    safety: [],
    basedOn: [`Blood pressure ${sys}/${dia}`],
    missing: [],
    text,
  };
}

export function buildWeeklyPlan(input: WeeklyPlanInput): WeeklyPlan {
  const bp = bpCategory(input.bpSystolic, input.bpDiastolic);
  if (bp === "very_high") return urgentPlan(input.bpSystolic as number, input.bpDiastolic as number);

  const missing: string[] = [];
  const basedOn: string[] = [];
  const safety: string[] = [];

  if (bp === "missing") missing.push("Blood pressure");
  else basedOn.push(`Blood pressure ${input.bpSystolic}/${input.bpDiastolic}, ${BP_LABEL[bp]}`);

  const hasMod = finite(input.moderateMinutesPerWeek) && input.moderateMinutesPerWeek >= 0;
  const hasVig = finite(input.vigorousMinutesPerWeek) && input.vigorousMinutesPerWeek >= 0;
  // Life's Essential 8 counts each vigorous minute as 2 moderate minutes.
  const current = hasMod || hasVig
    ? Math.round((hasMod ? (input.moderateMinutesPerWeek as number) : 0) + 2 * (hasVig ? (input.vigorousMinutesPerWeek as number) : 0))
    : null;
  if (current === null) missing.push("Weekly activity minutes (Life's Essential 8 questionnaire)");
  else basedOn.push(`About ${current} activity minutes a week on the questionnaire`);

  const age = finite(input.ageYears) && input.ageYears > 0 && input.ageYears < 120 ? Math.floor(input.ageYears) : null;
  if (age === null) missing.push("Age");
  else basedOn.push(`Age ${age}`);
  const older = age !== null && age >= OLDER_ADULT_AGE;

  const bmi = finite(input.bmi) && input.bmi > 10 && input.bmi < 80 ? Math.round(input.bmi * 10) / 10 : null;
  if (bmi === null) missing.push("Height and weight (for BMI)");
  else basedOn.push(`BMI ${bmi.toFixed(1)}`);
  const lowImpact = bmi !== null && bmi >= 30;

  const avgSteps = average(input.dailySteps, 1, 100000);
  const avgHr = average(input.dailyHeartRate, 25, 250);
  const stepGoal = stepGoalFrom(avgSteps);
  if (avgSteps === null) missing.push("Wearable steps");
  else basedOn.push(`About ${avgSteps} steps a day on the wearable summary`);
  if (avgHr !== null) basedOn.push(`Average heart rate ${avgHr} on the wearable summary`);

  // Weekly aerobic minutes for this week. HHS: inactive people start low and
  // build gradually. Stage 2 or missing blood pressure stays at a gentle cap
  // until the care team weighs in.
  let target: number;
  if (current === null) target = START_LOW_MINUTES;
  else if (current >= WEEKLY_TARGET_MINUTES) target = WEEKLY_TARGET_MINUTES;
  else target = Math.min(WEEKLY_TARGET_MINUTES, Math.max(START_LOW_MINUTES, current + WEEKLY_INCREASE));
  const capped = bp === "stage2" || bp === "missing";
  if (capped) target = Math.min(target, 90);

  const allowVigorous = (bp === "normal" || bp === "elevated") && current !== null
    && current >= WEEKLY_TARGET_MINUTES && !older;

  const cardio = lowImpact ? "Brisk walk, cycling, or water walking" : "Brisk walk";
  const strengthName = older
    ? "strength: chair stands, wall push ups, step ups, plus balance practice"
    : "strength: chair stands or squats, wall push ups, rows with a band, carries";
  const balance = "Balance: heel to toe walk, standing on one foot near a counter";

  // Five aerobic days with rest on Wednesday and Sunday. Strength on Tuesday
  // and Friday meets the 2 day guideline.
  const aerobicDays = 5;
  const vigorousDay = allowVigorous ? "Sat" : null;
  // Spread the target in 5 minute blocks so the week adds up to the target.
  const baseDay = Math.max(5, Math.floor(target / aerobicDays / 5) * 5);
  let extraBlocks = Math.max(0, Math.round((target - baseDay * aerobicDays) / 5));
  const perDay = baseDay;
  const minutesFor = () => {
    if (extraBlocks > 0) { extraBlocks -= 1; return baseDay + 5; }
    return baseDay;
  };
  const days: PlanDay[] = [];
  const add = (day: string, activity: string, minutes: number, intensity: Intensity, note: string, credit: number) =>
    days.push({ day, activity, minutes, intensity, intensityNote: note, aerobicCredit: credit });

  const order = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const day of order) {
    if (day === "Wed" || day === "Sun") {
      if (older) add(day, `${balance}, then gentle stretching`, 10, "light", TALK.light, 0);
      // Rest days show no minutes and add nothing to the weekly total.
      else add(day, "Rest day. Gentle stretching is optional.", 0, "rest", TALK.light, 0);
      continue;
    }
    if (day === vigorousDay) {
      const mins = round5(minutesFor() / 2);
      add(day, "Faster walk, jog, or hill walk", mins, "vigorous", TALK.vigorous, mins * 2);
      continue;
    }
    const strength = day === "Tue" || day === "Fri";
    const mins = minutesFor();
    if (strength) {
      add(day, `${cardio} for ${mins} min, then ${strengthName} for 15 min`, mins + 15, "moderate", `${TALK.moderate} ${TALK.strength}`, mins);
    } else {
      add(day, cardio, mins, "moderate", TALK.moderate, mins);
    }
  }
  const weeklyMinutes = days.reduce((s, d) => s + d.aerobicCredit, 0);

  // Step up note for this week.
  let stepUp: string;
  if (current === null) {
    stepUp = `This week's step up: start with about ${perDay} to ${perDay + 5} minutes on 5 days. If that feels comfortable, add 5 minutes to each walk next week. Fill in the activity questions so the plan can match what you already do.`;
  } else if (current >= WEEKLY_TARGET_MINUTES) {
    stepUp = "This week's step up: you are at the 150 minute target. Keep it steady and make strength days a habit. Adding a little more weight or one more set is one option to ask about.";
  } else {
    stepUp = `This week's step up: go from about ${current} to ${weeklyMinutes} minutes this week. Add about ${WEEKLY_INCREASE} minutes each week until you reach 150.`;
  }
  if (capped) stepUp += " Ask your care team before going past 90 minutes a week.";
  if (stepGoal !== null && avgSteps !== null) {
    stepUp += avgSteps >= STEP_GOAL_CAP
      ? ` Daily step goal: keep about ${stepGoal} steps.`
      : ` Daily step goal: ${stepGoal} steps, about ${stepGoal - avgSteps} more than your recent average of ${avgSteps}.`;
  }

  // Safety notes.
  safety.push("Check with your care team before starting, especially if you take heart or blood pressure medicine.");
  safety.push("Warm up for 5 minutes and cool down for 5 minutes each time.");
  safety.push("Stop and call 911 if you feel chest pain or pressure, fainting, or sudden shortness of breath.");
  if (bp === "stage2") safety.push("Your blood pressure on file is in the stage 2 range. Ask your care team to clear you before starting. Keep to moderate effort and skip heavy lifting.");
  if (bp === "stage1") safety.push("Your blood pressure on file is in the stage 1 range. Keep breathing during strength moves and do not hold your breath.");
  if (bp === "missing") safety.push("No blood pressure is on file. Ask your care team to check it before you go past an easy pace.");
  if (older) safety.push("Balance work is included because the guidelines add it for adults 65 and older. Keep a counter or sturdy chair close by.");
  if (lowImpact) safety.push("Low impact choices such as walking, cycling, or water walking are easier on the knees and hips.");
  if (bmi !== null && bmi < 18.5) safety.push("BMI on file is under 18.5. Ask your care team about food and energy needs before adding much activity.");
  if (avgHr !== null && avgHr > 100) safety.push(`Average heart rate on the wearable summary is ${avgHr}, above 100. Ask your care team about this before starting.`);
  safety.push("Drink water and stop if something hurts, not just feels like effort.");

  const lines: string[] = [];
  lines.push("This Week's Activity Plan");
  lines.push("Check with your care team before starting.");
  for (const d of days) {
    lines.push(d.minutes === 0 ? `${d.day}: ${d.activity} ${d.intensityNote}` : `${d.day}: ${d.activity}, ${d.minutes} min total. ${d.intensityNote}`);
  }
  lines.push(`Weekly aerobic total: ${weeklyMinutes} of ${WEEKLY_TARGET_MINUTES} minutes (vigorous minutes count double). Strength days: 2.`);
  lines.push(stepUp);
  lines.push(`Safety notes:\n${safety.map((s) => `* ${s}`).join("\n")}`);
  if (basedOn.length) lines.push(`Based on: ${basedOn.join("; ")}.`);
  if (missing.length) lines.push(`Not on file: ${missing.join("; ")}. Adding these lets the plan fit you better.`);
  lines.push(`Guideline sources: HHS Physical Activity Guidelines for Americans, American Heart Association.\n${DISCLAIMER}`);

  return {
    status: "plan",
    bpCategory: bp,
    urgentMessage: null,
    days,
    weeklyMinutes,
    weeklyTarget: WEEKLY_TARGET_MINUTES,
    stepUp,
    stepGoal,
    averageSteps: avgSteps,
    safety,
    basedOn,
    missing,
    text: lines.join("\n\n"),
  };
}
