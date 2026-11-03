/**
 * USPSTF adult screening and prevention list, grade A and B recommendations only.
 * Driven only by age, sex, and data already on file. No race or ethnicity input exists.
 * General guidance, not a diagnosis. Check with your care team.
 */

export interface UspstfInputs {
  age?: number | null;
  sex?: "female" | "male" | "unknown" | null;
  bmi?: number | null;
  /** never, former, current, or unknown */
  smoking?: "never" | "former" | "current" | "unknown" | null;
}

export interface UspstfItem {
  id: string;
  title: string;
  grade: "A" | "B";
  detail: string;
  /** Extra note when an input that would narrow this is not on file. */
  caveat?: string;
  source: string;
}

const BASE = "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/";

export function uspstfList(input: UspstfInputs): { items: UspstfItem[]; needsAge: boolean } {
  const age = typeof input.age === "number" && Number.isFinite(input.age) && input.age > 0 ? input.age : null;
  if (age == null) return { items: [], needsAge: true };
  const sex = input.sex === "female" || input.sex === "male" ? input.sex : null;
  const sexNote = sex ? undefined : "Sex is not on file, so this is shown in case it applies to you.";
  const smoking = input.smoking ?? "unknown";
  const items: UspstfItem[] = [];
  const add = (cond: boolean, item: UspstfItem) => { if (cond) items.push(item); };

  add(age >= 18, { id: "bp", title: "Blood pressure check", grade: "A", detail: "Adults 18 and older.", source: `${BASE}hypertension-in-adults-screening` });
  add(age >= 35 && age <= 70, {
    id: "diabetes", title: "Prediabetes and type 2 diabetes screening (A1C)", grade: "B",
    detail: "USPSTF: ages 35 to 70 with overweight or obesity. CareIQ prompts all adults 35 and older for an A1C, following the American Diabetes Association.",
    caveat: typeof input.bmi === "number" ? (input.bmi >= 25 ? undefined : "Your BMI on file is under 25; the ADA still advises testing from age 35.") : "BMI is not on file.",
    source: `${BASE}screening-for-prediabetes-and-type-2-diabetes`,
  });
  add(age >= 45 && age <= 75, { id: "colorectal", title: "Colorectal cancer screening", grade: age >= 50 ? "A" : "B", detail: "Ages 45 to 75.", source: `${BASE}colorectal-cancer-screening` });
  add(sex !== "male" && age >= 40 && age <= 74, { id: "breast", title: "Breast cancer screening (mammogram every 2 years)", grade: "B", detail: "Women 40 to 74.", caveat: sexNote, source: `${BASE}breast-cancer-screening` });
  add(sex !== "male" && age >= 21 && age <= 65, { id: "cervical", title: "Cervical cancer screening", grade: "A", detail: "Women 21 to 65.", caveat: sexNote, source: `${BASE}cervical-cancer-screening` });
  add(age >= 40 && age <= 75, {
    id: "statin", title: "Cholesterol check and statin discussion", grade: "B",
    detail: "Ages 40 to 75 with a risk factor (high cholesterol, diabetes, high blood pressure, or smoking) and an estimated 10-year risk of 10% or more. USPSTF used the Pooled Cohort Equations; CareIQ shows PREVENT above.",
    source: `${BASE}statin-use-in-adults-preventive-medication`,
  });
  add(age >= 18, { id: "depression", title: "Depression screening", grade: "B", detail: "All adults.", source: `${BASE}screening-depression-suicide-risk-adults` });
  add(age >= 18, { id: "tobacco", title: "Tobacco use questions and help to quit", grade: "A", detail: "All adults are asked about tobacco; people who smoke are offered help to quit.", source: `${BASE}tobacco-use-in-adults-and-pregnant-women-counseling-and-interventions` });
  add(age >= 18 && age <= 79, { id: "hepc", title: "Hepatitis C screening", grade: "B", detail: "Ages 18 to 79, at least once.", source: `${BASE}hepatitis-c-screening` });
  add(age >= 15 && age <= 65, { id: "hiv", title: "HIV screening", grade: "A", detail: "Ages 15 to 65, at least once.", source: `${BASE}human-immunodeficiency-virus-hiv-infection-screening` });
  add(age >= 50 && age <= 80 && smoking !== "never", {
    id: "lung", title: "Lung cancer screening (low-dose CT)", grade: "B",
    detail: "Ages 50 to 80 with a 20 pack-year smoking history who smoke now or quit within the past 15 years.",
    caveat: smoking === "unknown" ? "Smoking history is not on file." : "CareIQ does not have pack-years or quit date on file; your care team will check.",
    source: `${BASE}lung-cancer-screening`,
  });
  add(sex !== "female" && age >= 65 && age <= 75 && smoking !== "never", {
    id: "aaa", title: "Abdominal aortic aneurysm ultrasound (once)", grade: "B",
    detail: "Men 65 to 75 who have ever smoked.",
    caveat: [sex ? "" : "Sex is not on file.", smoking === "unknown" ? "Smoking history is not on file." : ""].filter(Boolean).join(" ") || undefined,
    source: `${BASE}abdominal-aortic-aneurysm-screening`,
  });
  return { items, needsAge: false };
}

export const USPSTF_SOURCE = { label: "U.S. Preventive Services Task Force, grade A and B recommendations", url: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics" };
