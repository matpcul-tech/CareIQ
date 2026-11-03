import assert from "node:assert/strict";
import test from "node:test";
import { glucoseRangeLabel, glucoseRangeSentence, kdigoGStage, kdigoSentence } from "../src/lib/clinical-info";
import {
  activityScore,
  bmiScore,
  bpScore,
  dietScoreFromMepa,
  glucoseScore,
  LE8_DISCLAIMER,
  le8Summary,
  mepaPoints,
  nicotineScore,
  nonHdlScore,
  scoreLe8,
  sleepScore,
  type MepaAnswers,
} from "../src/lib/le8";
import { wordingProblems } from "../src/lib/local-health";

const fullMepa = (overrides: Partial<MepaAnswers> = {}): MepaAnswers => ({
  oliveOilPerDay: 2,
  leafyVegetablesPerWeek: 7,
  otherVegetablesPerDay: 2,
  berriesPerWeek: 2,
  otherFruitPerDay: 1,
  redMeatPerWeek: 3,
  fishPerWeek: 1,
  chickenPerWeek: 5,
  cheesePerWeek: 4,
  butterPerWeek: 5,
  beansPerWeek: 3,
  wholeGrainsPerDay: 3,
  sweetsPerWeek: 4,
  nutsPerWeek: 4,
  fastFoodPerWeek: 1,
  alcoholPerDay: 1,
  ...overrides,
});

test("published adult point tables", () => {
  assert.equal(dietScoreFromMepa(16), 100);
  assert.equal(dietScoreFromMepa(15), 100);
  assert.equal(dietScoreFromMepa(14), 80);
  assert.equal(dietScoreFromMepa(12), 80);
  assert.equal(dietScoreFromMepa(11), 50);
  assert.equal(dietScoreFromMepa(8), 50);
  assert.equal(dietScoreFromMepa(7), 25);
  assert.equal(dietScoreFromMepa(4), 25);
  assert.equal(dietScoreFromMepa(3), 0);

  assert.equal(activityScore(150), 100);
  assert.equal(activityScore(149), 90);
  assert.equal(activityScore(120), 90);
  assert.equal(activityScore(90), 80);
  assert.equal(activityScore(60), 60);
  assert.equal(activityScore(30), 40);
  assert.equal(activityScore(1), 20);
  assert.equal(activityScore(0), 0);

  assert.equal(nicotineScore("never", false), 100);
  assert.equal(nicotineScore("quit_5y_or_more", false), 75);
  assert.equal(nicotineScore("quit_1_to_under_5y", false), 50);
  assert.equal(nicotineScore("quit_under_1y_or_nds", false), 25);
  assert.equal(nicotineScore("current_smoker", false), 0);
  assert.equal(nicotineScore("never", true), 80);
  assert.equal(nicotineScore("current_smoker", true), 0);

  assert.equal(sleepScore(7), 100);
  assert.equal(sleepScore(8.9), 100);
  assert.equal(sleepScore(9), 90);
  assert.equal(sleepScore(6), 70);
  assert.equal(sleepScore(5), 40);
  assert.equal(sleepScore(10), 40);
  assert.equal(sleepScore(4), 20);
  assert.equal(sleepScore(3.9), 0);

  assert.equal(bmiScore(24.9), 100);
  assert.equal(bmiScore(18.5), 100);
  assert.equal(bmiScore(18.4), null);
  assert.equal(bmiScore(25), 70);
  assert.equal(bmiScore(29.9), 70);
  assert.equal(bmiScore(30), 30);
  assert.equal(bmiScore(35), 15);
  assert.equal(bmiScore(39.9), 15);
  assert.equal(bmiScore(40), 0);

  assert.equal(nonHdlScore(129, false), 100);
  assert.equal(nonHdlScore(130, false), 60);
  assert.equal(nonHdlScore(159, false), 60);
  assert.equal(nonHdlScore(160, false), 40);
  assert.equal(nonHdlScore(189, false), 40);
  assert.equal(nonHdlScore(190, false), 20);
  assert.equal(nonHdlScore(219, false), 20);
  assert.equal(nonHdlScore(220, false), 0);
  assert.equal(nonHdlScore(129, true), 80);
  assert.equal(nonHdlScore(220, true), 0);

  assert.equal(glucoseScore({ fastingGlucose: 99, a1c: 5.6 }), 100);
  assert.equal(glucoseScore({ fastingGlucose: 100 }), 60);
  assert.equal(glucoseScore({ a1c: 5.7 }), 60);
  assert.equal(glucoseScore({ a1c: 6.4 }), 60);
  assert.equal(glucoseScore({ a1c: 6.5 }), 40);
  assert.equal(glucoseScore({ a1c: 6.9, diabetesRecorded: true }), 40);
  assert.equal(glucoseScore({ a1c: 7, diabetesRecorded: true }), 30);
  assert.equal(glucoseScore({ a1c: 8, diabetesRecorded: true }), 20);
  assert.equal(glucoseScore({ a1c: 9, diabetesRecorded: true }), 10);
  assert.equal(glucoseScore({ a1c: 10, diabetesRecorded: true }), 0);
  assert.equal(glucoseScore({ fastingGlucose: 130 }), null);

  assert.equal(bpScore(119, 79, false), 100);
  assert.equal(bpScore(120, 79, false), 75);
  assert.equal(bpScore(129, 79, false), 75);
  assert.equal(bpScore(120, 80, false), 50);
  assert.equal(bpScore(130, 70, false), 50);
  assert.equal(bpScore(139, 89, false), 50);
  assert.equal(bpScore(140, 70, false), 25);
  assert.equal(bpScore(118, 90, false), 25);
  assert.equal(bpScore(160, 70, false), 0);
  assert.equal(bpScore(110, 100, false), 0);
  assert.equal(bpScore(119, 79, true), 80);
  assert.equal(bpScore(160, 100, true), 0);
});

test("MEPA inclusive cutoffs and the total average", () => {
  const scored = mepaPoints(fullMepa(), "female");
  assert.equal(scored.complete, true);
  assert.equal(scored.points, 16);
  assert.equal(mepaPoints(fullMepa({ alcoholPerDay: 2 }), "female").points, 15);
  assert.equal(mepaPoints(fullMepa({ alcoholPerDay: 2 }), "male").points, 16);
  assert.equal(mepaPoints(fullMepa({ alcoholPerDay: 0 }), "male").points, 15);

  const result = scoreLe8({
    sex: "female",
    mepa: fullMepa(),
    moderateMinutesPerWeek: 100,
    vigorousMinutesPerWeek: 30,
    nicotine: "never",
    livesWithIndoorSmoker: false,
    sleepHours: 7.5,
    weightLb: 150,
    heightIn: 66,
    totalCholesterol: 180,
    hdl: 60,
    lipidTreated: false,
    a1c: 5.4,
    fastingGlucose: 90,
    diabetesRecorded: false,
    bpSystolic: 118,
    bpDiastolic: 76,
    bpTreated: false,
  });
  assert.equal(result.enteredCount, 8);
  assert.equal(result.total, 100);
  assert.equal(result.band, "high");
  assert.equal(result.missing.length, 0);
});

test("missing components are not imputed and the total stays hidden", () => {
  const result = scoreLe8({
    nicotine: "never",
    livesWithIndoorSmoker: false,
    sleepHours: 8,
  });
  assert.equal(result.enteredCount, 2);
  assert.equal(result.total, null);
  assert.equal(result.band, null);
  assert.ok(result.missing.includes("Diet"));
  assert.ok(result.missing.includes("Body mass index"));
  const text = le8Summary(result);
  assert.match(text, /Score incomplete, 2 of 8 entered/);
  assert.match(text, /Heart Health Score \(AHA Life's Essential 8\)/);
  assert.match(text, /Not a diagnosis/);
  assert.equal(text.includes("non-Native"), false);
  assert.ok(text.endsWith(LE8_DISCLAIMER));
  const stripped = text.split(LE8_DISCLAIMER).join("").split("Not a diagnosis.").join("");
  assert.deepEqual(wordingProblems(stripped), []);
});

test("vigorous minutes count double and bands use 80 and 50", () => {
  const active = scoreLe8({
    moderateMinutesPerWeek: 90,
    vigorousMinutesPerWeek: 30,
    nicotine: "never",
    livesWithIndoorSmoker: false,
  });
  const activity = active.components.find((item) => item.id === "activity");
  assert.equal(activity?.points, 100);

  const partial = scoreLe8({
    sex: "male",
    mepa: fullMepa({ oliveOilPerDay: 0, leafyVegetablesPerWeek: 0, otherVegetablesPerDay: 0, berriesPerWeek: 0, otherFruitPerDay: 0, fishPerWeek: 0, beansPerWeek: 0, wholeGrainsPerDay: 0, nutsPerWeek: 0, alcoholPerDay: 0 }),
    moderateMinutesPerWeek: 0,
    vigorousMinutesPerWeek: 0,
    nicotine: "current_smoker",
    livesWithIndoorSmoker: false,
    sleepHours: 3,
    weightLb: 260,
    heightIn: 66,
    totalCholesterol: 280,
    hdl: 30,
    lipidTreated: false,
    a1c: 10.2,
    diabetesRecorded: true,
    bpSystolic: 170,
    bpDiastolic: 100,
    bpTreated: false,
  });
  assert.equal(partial.enteredCount, 8);
  assert.equal(partial.band, "low");
  assert.ok((partial.total as number) < 50);
});

test("glucose wording and KDIGO stage stay non-diagnostic", () => {
  assert.equal(glucoseRangeLabel({ a1c: 5.6, fastingGlucose: 90 }), "normal");
  assert.equal(glucoseRangeLabel({ a1c: 5.7 }), "prediabetes");
  assert.equal(glucoseRangeLabel({ a1c: 5.4, fastingGlucose: 110 }), "prediabetes");
  assert.equal(glucoseRangeLabel({ a1c: 6.5 }), "diabetes");
  assert.equal(glucoseRangeLabel({}), null);
  const sentence = glucoseRangeSentence("prediabetes");
  assert.match(sentence, /in the prediabetes range/);
  assert.equal(sentence.includes("you have"), false);
  assert.ok(sentence.endsWith(LE8_DISCLAIMER));

  assert.equal(kdigoGStage(90), "G1");
  assert.equal(kdigoGStage(60), "G2");
  assert.equal(kdigoGStage(45), "G3a");
  assert.equal(kdigoGStage(30), "G3b");
  assert.equal(kdigoGStage(15), "G4");
  assert.equal(kdigoGStage(14), "G5");
  const kidney = kdigoSentence("G2", 72);
  assert.match(kidney, /G2/);
  assert.equal(kidney.includes("you have"), false);
});
