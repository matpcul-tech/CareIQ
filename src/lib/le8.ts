/**
 * AHA Life's Essential 8 adult scoring.
 *
 * Source: Lloyd-Jones et al., Circulation. 2022;146:e18-e43.
 * doi:10.1161/CIR.0000000000001078. Table 1, adults age 20 and older,
 * and the implementation notes under that table.
 *
 * Each component is 0 to 100. The total is the unweighted average.
 * Overall bands from the same paper: high 80 to 100, moderate 50 to 79,
 * low 0 to 49.
 *
 * Life's Essential 8 was validated mostly in non-Native populations.
 * That note stays in this comment and the pull request. It is not
 * shown in the app.
 *
 * Adult tables used here, written with words instead of dashes:
 *
 * Diet, individual MEPA points (0 to 16):
 *   100 for 15 to 16, 80 for 12 to 14, 50 for 8 to 11,
 *   25 for 4 to 7, 0 for 0 to 3.
 * Physical activity, minutes per week of moderate or greater activity:
 *   100 at 150 or more, 90 for 120 to 149, 80 for 90 to 119,
 *   60 for 60 to 89, 40 for 30 to 59, 20 for 1 to 29, 0 for 0.
 *   The note says each vigorous minute counts as 2 moderate minutes.
 * Nicotine:
 *   100 never smoker, 75 former and quit 5 years or more,
 *   50 former and quit 1 year up to less than 5 years,
 *   25 former and quit less than 1 year, or current inhaled
 *   nicotine-delivery system, 0 current smoker.
 *   Subtract 20 for living with an active indoor smoker, unless the
 *   score is already 0.
 * Sleep, average hours per night:
 *   100 for 7 up to less than 9, 90 for 9 up to less than 10,
 *   70 for 6 up to less than 7, 40 for 5 up to less than 6 or 10 or more,
 *   20 for 4 up to less than 5, 0 for less than 4.
 * BMI, kg/m2:
 *   100 below 25, 70 for 25.0 to 29.9, 30 for 30.0 to 34.9,
 *   15 for 35.0 to 39.9, 0 at 40.0 or more.
 * Non-HDL cholesterol, mg/dL (total minus HDL):
 *   100 below 130, 60 for 130 to 159, 40 for 160 to 189,
 *   20 for 190 to 219, 0 at 220 or more.
 *   If drug-treated, subtract 20.
 * Blood glucose:
 *   100 no diabetes and fasting glucose below 100 or A1C below 5.7,
 *   60 no diabetes and fasting glucose 100 to 125 or A1C 5.7 to 6.4,
 *   40 diabetes with A1C below 7.0,
 *   30 diabetes with A1C 7.0 to 7.9,
 *   20 diabetes with A1C 8.0 to 8.9,
 *   10 diabetes with A1C 9.0 to 9.9,
 *   0 diabetes with A1C 10.0 or more.
 * Blood pressure, mmHg:
 *   100 below 120 and below 80,
 *   75 systolic 120 to 129 and diastolic below 80,
 *   50 systolic 130 to 139 or diastolic 80 to 89,
 *   25 systolic 140 to 159 or diastolic 90 to 99,
 *   0 systolic 160 or more or diastolic 100 or more.
 *   If treated, subtract 20.
 *
 * Choices the paper leaves open are listed on Le8Result.flags and in
 * the pull request. This file does not invent a point for those cases.
 */

export type Le8ComponentId =
  | "diet"
  | "activity"
  | "nicotine"
  | "sleep"
  | "bmi"
  | "nonHdl"
  | "glucose"
  | "bp";

export type NicotineStatus =
  | "never"
  | "quit_5y_or_more"
  | "quit_1_to_under_5y"
  | "quit_under_1y_or_nds"
  | "current_smoker";

export interface MepaAnswers {
  oliveOilPerDay?: number;
  leafyVegetablesPerWeek?: number;
  otherVegetablesPerDay?: number;
  berriesPerWeek?: number;
  otherFruitPerDay?: number;
  redMeatPerWeek?: number;
  fishPerWeek?: number;
  chickenPerWeek?: number;
  cheesePerWeek?: number;
  butterPerWeek?: number;
  beansPerWeek?: number;
  wholeGrainsPerDay?: number;
  sweetsPerWeek?: number;
  nutsPerWeek?: number;
  fastFoodPerWeek?: number;
  alcoholPerDay?: number;
}

export interface Le8Input {
  sex?: "male" | "female" | "unknown";
  mepa?: MepaAnswers | null;
  moderateMinutesPerWeek?: number;
  vigorousMinutesPerWeek?: number;
  nicotine?: NicotineStatus;
  livesWithIndoorSmoker?: boolean;
  sleepHours?: number;
  weightLb?: number;
  heightIn?: number;
  totalCholesterol?: number;
  hdl?: number;
  lipidTreated?: boolean;
  a1c?: number;
  fastingGlucose?: number;
  diabetesRecorded?: boolean;
  bpSystolic?: number;
  bpDiastolic?: number;
  bpTreated?: boolean;
}

export interface Le8Component {
  id: Le8ComponentId;
  label: string;
  entered: boolean;
  points: number | null;
  detail: string;
}

export interface Le8Result {
  components: Le8Component[];
  enteredCount: number;
  missing: string[];
  total: number | null;
  band: "high" | "moderate" | "low" | null;
  flags: string[];
}

const COMPONENT_LABEL: Record<Le8ComponentId, string> = {
  diet: "Diet",
  activity: "Physical activity",
  nicotine: "Nicotine exposure",
  sleep: "Sleep",
  bmi: "Body mass index",
  nonHdl: "Non-HDL cholesterol",
  glucose: "Blood glucose",
  bp: "Blood pressure",
};

const MEPA_KEYS: (keyof MepaAnswers)[] = [
  "oliveOilPerDay",
  "leafyVegetablesPerWeek",
  "otherVegetablesPerDay",
  "berriesPerWeek",
  "otherFruitPerDay",
  "redMeatPerWeek",
  "fishPerWeek",
  "chickenPerWeek",
  "cheesePerWeek",
  "butterPerWeek",
  "beansPerWeek",
  "wholeGrainsPerDay",
  "sweetsPerWeek",
  "nutsPerWeek",
  "fastFoodPerWeek",
  "alcoholPerDay",
];

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function floor0(n: number): number {
  return n < 0 ? 0 : n;
}

function component(id: Le8ComponentId, entered: boolean, points: number | null, detail: string): Le8Component {
  return { id, label: COMPONENT_LABEL[id], entered, points, detail };
}

/**
 * MEPA item points from Cerwinske et al., J Hum Nutr Diet. 2017.
 * One point when the reported frequency meets the published cutoff.
 * The AHA supplement reprints a similar 16-item list. Some secondary
 * copies use a strict "greater than" where Cerwinske uses "at least".
 * This code follows Cerwinske's inclusive cutoffs and records that
 * difference in flags.
 *
 * Alcohol is sex-specific: more than 0 and at most 2 per day for men,
 * more than 0 and at most 1 per day for women. Zero drinks does not
 * earn the point. Unknown sex uses the stricter limit of at most 1.
 */
export function mepaPoints(answers: MepaAnswers, sex: Le8Input["sex"]): { points: number; complete: boolean } {
  if (!MEPA_KEYS.every((key) => finite(answers[key]))) {
    return { points: 0, complete: false };
  }
  const a = answers;
  let points = 0;
  if ((a.oliveOilPerDay as number) >= 2) points += 1;
  if ((a.leafyVegetablesPerWeek as number) >= 7) points += 1;
  if ((a.otherVegetablesPerDay as number) >= 2) points += 1;
  if ((a.berriesPerWeek as number) >= 2) points += 1;
  if ((a.otherFruitPerDay as number) >= 1) points += 1;
  if ((a.redMeatPerWeek as number) <= 3) points += 1;
  if ((a.fishPerWeek as number) >= 1) points += 1;
  if ((a.chickenPerWeek as number) <= 5) points += 1;
  if ((a.cheesePerWeek as number) <= 4) points += 1;
  if ((a.butterPerWeek as number) <= 5) points += 1;
  if ((a.beansPerWeek as number) >= 3) points += 1;
  if ((a.wholeGrainsPerDay as number) >= 3) points += 1;
  if ((a.sweetsPerWeek as number) <= 4) points += 1;
  if ((a.nutsPerWeek as number) >= 4) points += 1;
  if ((a.fastFoodPerWeek as number) <= 1) points += 1;
  const alcohol = a.alcoholPerDay as number;
  const cap = sex === "male" ? 2 : 1;
  if (alcohol > 0 && alcohol <= cap) points += 1;
  return { points, complete: true };
}

export function dietScoreFromMepa(mepaPointsValue: number): number {
  if (mepaPointsValue >= 15) return 100;
  if (mepaPointsValue >= 12) return 80;
  if (mepaPointsValue >= 8) return 50;
  if (mepaPointsValue >= 4) return 25;
  return 0;
}

export function activityMinutes(moderate?: number, vigorous?: number): number | null {
  if (!finite(moderate) || !finite(vigorous)) return null;
  return moderate + 2 * vigorous;
}

export function activityScore(minutes: number): number {
  if (minutes >= 150) return 100;
  if (minutes >= 120) return 90;
  if (minutes >= 90) return 80;
  if (minutes >= 60) return 60;
  if (minutes >= 30) return 40;
  if (minutes >= 1) return 20;
  return 0;
}

export function nicotineScore(status: NicotineStatus, indoor: boolean): number {
  const base =
    status === "never" ? 100
    : status === "quit_5y_or_more" ? 75
    : status === "quit_1_to_under_5y" ? 50
    : status === "quit_under_1y_or_nds" ? 25
    : 0;
  if (indoor && base > 0) return base - 20;
  return base;
}

export function sleepScore(hours: number): number {
  if (hours < 4) return 0;
  if (hours < 5) return 20;
  if (hours < 6 || hours >= 10) return 40;
  if (hours < 7) return 70;
  if (hours < 9) return 100;
  return 90;
}

export function bmiFromUs(weightLb: number, heightIn: number): number | null {
  if (weightLb <= 0 || heightIn <= 0) return null;
  return (weightLb * 703) / (heightIn * heightIn);
}

export function bmiScore(bmi: number): number | null {
  if (bmi < 18.5) return null;
  if (bmi < 25) return 100;
  if (bmi < 30) return 70;
  if (bmi < 35) return 30;
  if (bmi < 40) return 15;
  return 0;
}

export function nonHdl(total?: number, hdl?: number): number | null {
  if (!finite(total) || !finite(hdl)) return null;
  const value = total - hdl;
  if (value < 0) return null;
  return value;
}

export function nonHdlScore(value: number, treated: boolean): number {
  let points = 0;
  if (value < 130) points = 100;
  else if (value <= 159) points = 60;
  else if (value <= 189) points = 40;
  else if (value <= 219) points = 20;
  if (treated) points = floor0(points - 20);
  return points;
}

export function glucoseScore(input: {
  a1c?: number;
  fastingGlucose?: number;
  diabetesRecorded?: boolean;
}): number | null {
  const a1c = finite(input.a1c) ? input.a1c : undefined;
  const fg = finite(input.fastingGlucose) ? input.fastingGlucose : undefined;
  const labDiabetes = (a1c !== undefined && a1c >= 6.5) || (fg !== undefined && fg >= 126);
  const diabetes = input.diabetesRecorded === true || labDiabetes;
  if (diabetes) {
    if (a1c === undefined) return null;
    if (a1c < 7) return 40;
    if (a1c <= 7.9) return 30;
    if (a1c <= 8.9) return 20;
    if (a1c <= 9.9) return 10;
    return 0;
  }
  if (a1c === undefined && fg === undefined) return null;
  const prediabetes =
    (a1c !== undefined && a1c >= 5.7) ||
    (fg !== undefined && fg >= 100);
  return prediabetes ? 60 : 100;
}

export function bpScore(systolic: number, diastolic: number, treated: boolean): number {
  let points = 100;
  if (systolic >= 160 || diastolic >= 100) points = 0;
  else if (systolic >= 140 || diastolic >= 90) points = 25;
  else if (systolic >= 130 || diastolic >= 80) points = 50;
  else if (systolic >= 120) points = 75;
  if (treated) points = floor0(points - 20);
  return points;
}

export function le8Band(total: number): "high" | "moderate" | "low" {
  if (total >= 80) return "high";
  if (total >= 50) return "moderate";
  return "low";
}

export function scoreLe8(input: Le8Input): Le8Result {
  const flags: string[] = [];
  const sex = input.sex ?? "unknown";
  if (sex !== "male") {
    flags.push("Alcohol MEPA point uses at most 1 drink per day when sex is not recorded as male.");
  }
  flags.push("BMI below 18.5 is not scored. The paper leaves that point value to clinician judgment.");
  flags.push("The separate BMI table for Asian or Pacific ancestry is not applied.");
  flags.push("Metformin in prediabetes is not given a 20 point subtraction. The paper leaves that to clinician judgment.");
  flags.push("A treated lipid or blood pressure score is not allowed to fall below 0. The nicotine row says this explicitly. The lipid and blood pressure rows do not.");

  const mepa = mepaPoints(input.mepa ?? {}, sex);
  const diet = mepa.complete
    ? component("diet", true, dietScoreFromMepa(mepa.points), `MEPA ${mepa.points} of 16.`)
    : component("diet", false, null, "Diet screener is incomplete.");

  const minutes = activityMinutes(input.moderateMinutesPerWeek, input.vigorousMinutesPerWeek);
  const activity = minutes === null
    ? component("activity", false, null, "Activity minutes are missing.")
    : component("activity", true, activityScore(minutes), `${minutes} moderate-equivalent minutes in a week.`);

  const nicotine = input.nicotine === undefined || input.livesWithIndoorSmoker === undefined
    ? component("nicotine", false, null, "Nicotine answers are missing.")
    : component("nicotine", true, nicotineScore(input.nicotine, input.livesWithIndoorSmoker), "From the nicotine answers on file.");

  const sleep = !finite(input.sleepHours)
    ? component("sleep", false, null, "Sleep hours are missing.")
    : component("sleep", true, sleepScore(input.sleepHours), `${input.sleepHours} hours a night on the questionnaire.`);

  let bmi = component("bmi", false, null, "Weight or height is missing.");
  if (finite(input.weightLb) && finite(input.heightIn)) {
    const value = bmiFromUs(input.weightLb, input.heightIn);
    if (value === null) {
      bmi = component("bmi", false, null, "Weight or height is missing.");
    } else if (bmiScore(value) === null) {
      bmi = component("bmi", false, null, "BMI is below 18.5. A point value is not assigned.");
    } else {
      bmi = component("bmi", true, bmiScore(value), `BMI ${value.toFixed(1)}.`);
    }
  }

  let lipids = component("nonHdl", false, null, "Total cholesterol, HDL, or treatment answer is missing.");
  if (finite(input.totalCholesterol) && finite(input.hdl) && input.lipidTreated !== undefined) {
    const value = nonHdl(input.totalCholesterol, input.hdl);
    lipids = value === null
      ? component("nonHdl", false, null, "Non-HDL could not be calculated from the numbers on file.")
      : component("nonHdl", true, nonHdlScore(value, input.lipidTreated), `Non-HDL ${Math.round(value)} mg/dL.`);
  }

  const glucosePoints = glucoseScore(input);
  const glucoseKnown = finite(input.a1c) || finite(input.fastingGlucose) || input.diabetesRecorded === true;
  const glucose = !glucoseKnown || glucosePoints === null
    ? component("glucose", false, null, "A1C is needed when a diabetes-range value or a recorded diabetes answer is on file. Otherwise fasting glucose or A1C is needed.")
    : component("glucose", true, glucosePoints, "From A1C or fasting glucose on file.");

  const bp = !finite(input.bpSystolic) || !finite(input.bpDiastolic) || input.bpTreated === undefined
    ? component("bp", false, null, "Blood pressure or the treatment answer is missing.")
    : component(
      "bp",
      true,
      bpScore(input.bpSystolic, input.bpDiastolic, input.bpTreated),
      `Blood pressure ${Math.round(input.bpSystolic)}/${Math.round(input.bpDiastolic)}.`,
    );

  const components = [diet, activity, nicotine, sleep, bmi, lipids, glucose, bp];
  const entered = components.filter((item) => item.entered);
  const missing = components.filter((item) => !item.entered).map((item) => item.label);
  const total = entered.length === 8
    ? entered.reduce((sum, item) => sum + (item.points as number), 0) / 8
    : null;
  return {
    components,
    enteredCount: entered.length,
    missing,
    total,
    band: total === null ? null : le8Band(total),
    flags,
  };
}

export const LE8_TITLE = "Heart Health Score (AHA Life's Essential 8)";
export const LE8_NOT_DIAGNOSIS = "Not a diagnosis.";
export const LE8_DISCLAIMER = "This is general information, not a diagnosis.";

export function le8Summary(result: Le8Result): string {
  const lines = [
    LE8_TITLE,
    LE8_NOT_DIAGNOSIS,
  ];
  if (result.total === null) {
    lines.push(`Score incomplete, ${result.enteredCount} of 8 entered.`);
    if (result.missing.length > 0) {
      lines.push(`Still needed: ${result.missing.join(", ")}.`);
    }
  } else {
    const band = result.band === "high" ? "High" : result.band === "moderate" ? "Moderate" : "Low";
    lines.push(`Score ${Math.round(result.total)} of 100, in the ${band} band (80 to 100 high, 50 to 79 moderate, 0 to 49 low).`);
  }
  lines.push("Talk with your care team about this score.");
  lines.push(LE8_DISCLAIMER);
  return lines.join("\n");
}
