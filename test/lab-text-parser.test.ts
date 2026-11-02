import assert from "node:assert/strict";
import test from "node:test";
import {
  extractBiomarkersFromText,
  parsePdfBiomarkers,
  type LabModelClient,
} from "../src/lib/lab-pdf-parser";
import { buildPdf } from "./helpers/build-pdf";

// All fixtures are synthetic. Names, dates, and values are fake.

function values(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of extractBiomarkersFromText(text)) out[b.key] = b.value;
  return out;
}

function units(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of extractBiomarkersFromText(text)) out[b.key] = b.unit;
  return out;
}

const SIMPLE_COLUMNS = [
  "SYNTHETIC TEST LAB REPORT, NOT REAL PATIENT DATA",
  "Patient: SYN Test Patient   MRN: SYN000",
  "Test                      Result   Units    Reference",
  "Glucose, Fasting          92       mg/dL    70-99",
  "Hemoglobin A1c            5.4      %        4.0-5.6",
  "LDL Cholesterol           98       mg/dL    0-99",
  "HDL Cholesterol           55       mg/dL    >39",
  "Cholesterol, Total        172      mg/dL    100-199",
  "Triglycerides             110      mg/dL    0-149",
  "Creatinine                0.91     mg/dL    0.57-1.00",
  "eGFR                      88       mL/min/1.73m2  >59",
  "TSH                       2.1      uIU/mL   0.45-4.5",
  "Vitamin D, 25-Hydroxy     35       ng/mL    30-100",
].join("\n");

test("reads standard name, value, unit, range columns", () => {
  const v = values(SIMPLE_COLUMNS);
  assert.equal(v.fasting_glucose, 92);
  assert.equal(v.a1c, 5.4);
  assert.equal(v.ldl, 98);
  assert.equal(v.hdl, 55);
  assert.equal(v.total_cholesterol, 172);
  assert.equal(v.triglycerides, 110);
  assert.equal(v.creatinine, 0.91);
  assert.equal(v.egfr, 88);
  assert.equal(v.tsh, 2.1);
  assert.equal(v.vitamin_d, 35, "25-Hydroxy in the name must not be read as the value");
  const u = units(SIMPLE_COLUMNS);
  assert.equal(u.fasting_glucose, "mg/dL");
  assert.equal(u.a1c, "%");
});

test("reads H and L flags between value and unit", () => {
  const text = [
    "Glucose, Fasting 112 H mg/dL 70-99",
    "LDL Cholesterol 141 H mg/dL 0-99",
    "HDL Cholesterol 34 L mg/dL >39",
    "Triglycerides 210 (H) mg/dL 0-149",
    "Hemoglobin A1c 6.1H % 4.8-5.6",
    "Creatinine 1.42 High mg/dL 0.57-1.00",
    "eGFR 52 Low mL/min/1.73m2 >59",
  ].join("\n");
  const v = values(text);
  assert.deepEqual(
    { g: v.fasting_glucose, l: v.ldl, h: v.hdl, t: v.triglycerides, a: v.a1c, c: v.creatinine, e: v.egfr },
    { g: 112, l: 141, h: 34, t: 210, a: 6.1, c: 1.42, e: 52 },
  );
  const u = units(text);
  assert.equal(u.ldl, "mg/dL");
  assert.equal(u.a1c, "%");
});

test("reads value, flag, range, then unit (range before unit layout)", () => {
  const text = [
    "GLUCOSE 102 H 65-99 mg/dL",
    "CHOLESTEROL, TOTAL 205 H <200 mg/dL",
    "HDL CHOLESTEROL 61 > OR = 40 mg/dL",
    "TRIGLYCERIDES 88 <150 mg/dL",
    "LDL-CHOLESTEROL 121 H mg/dL (calc)",
    "CREATININE 0.84 0.60-1.35 mg/dL",
    "EGFR 104 > OR = 60 mL/min/1.73m2",
  ].join("\n");
  const v = values(text);
  assert.equal(v.fasting_glucose, 102);
  assert.equal(v.total_cholesterol, 205);
  assert.equal(v.hdl, 61);
  assert.equal(v.triglycerides, 88);
  assert.equal(v.ldl, 121);
  assert.equal(v.creatinine, 0.84);
  assert.equal(v.egfr, 104);
  assert.equal(units(text).creatinine, "mg/dL");
});

test("skips zero padded test codes and tab separated columns", () => {
  const text = [
    "Glucose 01 89 mg/dL 65-99",
    "Hemoglobin A1c\t5.2\t%\t4.8-5.6",
    "Creatinine\t\t0.77\tmg/dL\t0.57-1.00",
    "eGFR\t>90\tmL/min/1.73\t>59",
  ].join("\n");
  const v = values(text);
  assert.equal(v.fasting_glucose, 89);
  assert.equal(v.a1c, 5.2);
  assert.equal(v.creatinine, 0.77);
  assert.equal(v.egfr, 90);
});

test("range written with spaces is not read as the value", () => {
  const v = values("Triglycerides 95 mg/dL 0 - 149\nLDL Cholesterol 77 mg/dL 0 - 99");
  assert.equal(v.triglycerides, 95);
  assert.equal(v.ldl, 77);
});

test("ignores headers, ratio lines, and prose with no lab rows", () => {
  const text = [
    "Test Result Flag Units Reference Interval",
    "Cholesterol/HDL Ratio 3.1 ratio 0.0-5.0",
    "Reviewed with SYN Test Patient on 11/02/2026.",
    "Reference range 70-99 applies to fasting samples.",
  ].join("\n");
  assert.deepEqual(values(text), {});
});

function failingClient(): { calls: number; client: LabModelClient } {
  const state = { calls: 0, client: undefined as unknown as LabModelClient };
  state.client = {
    async createMessage() {
      state.calls += 1;
      throw new Error("model must not be called");
    },
  };
  return state;
}

test("synthetic PDF with columns parses on the server with no model call", async () => {
  const pdf = buildPdf(SIMPLE_COLUMNS.split("\n"));
  const spy = failingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true" },
    modelClient: spy.client,
  });
  assert.equal(spy.calls, 0);
  assert.equal(result.extraction_mode, "text");
  assert.equal(result.biomarkers.fasting_glucose, 92);
  assert.equal(result.biomarkers.ldl, 98);
  assert.equal(result.biomarkers.egfr, 88);
  assert.equal(result.biomarkers.creatinine, 0.91);
});

test("synthetic PDF with flags parses with the fallback flag unset", async () => {
  const pdf = buildPdf([
    "SYNTHETIC TEST LAB REPORT, NOT REAL PATIENT DATA, PATIENT SYN TEST",
    "GLUCOSE 102 H 65-99 mg/dL",
    "HEMOGLOBIN A1C 5.9 H 4.8-5.6 %",
    "HDL CHOLESTEROL 38 L > OR = 40 mg/dL",
    "TRIGLYCERIDES 160 H <150 mg/dL",
  ]);
  const spy = failingClient();
  const result = await parsePdfBiomarkers(pdf, { env: {}, modelClient: spy.client });
  assert.equal(spy.calls, 0);
  assert.equal(result.extraction_mode, "text");
  assert.equal(result.biomarkers.fasting_glucose, 102);
  assert.equal(result.biomarkers.a1c, 5.9);
  assert.equal(result.biomarkers.hdl, 38);
  assert.equal(result.biomarkers.triglycerides, 160);
});

test("synthetic PDF with no lab rows goes to manual entry when the flag is unset", async () => {
  const pdf = buildPdf([
    "SYNTHETIC TEST VISIT NOTE, NOT REAL PATIENT DATA",
    "SYN Test Patient came in for a routine visit and has no lab results on this page.",
    "Follow up in six months. No values are listed here for the parser to read.",
  ]);
  const spy = failingClient();
  const result = await parsePdfBiomarkers(pdf, { env: {}, modelClient: spy.client });
  assert.equal(spy.calls, 0);
  assert.equal(result.extraction_mode, "none");
});
