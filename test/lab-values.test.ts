import assert from "node:assert/strict";
import test from "node:test";
import { resolveLabs } from "../src/lib/lab-values";

// All values are synthetic.

test("reads biomarkers {value} shape saved by manual-labs route", () => {
  const labs = resolveLabs({
    biomarkers: {
      a1c: { value: 5.4, date_collected: "2026-01-01", source: "lab_pdf" },
      ldl: { value: 101 },
      hdl: { value: 55 },
      fasting_glucose: { value: 92 },
    },
  });
  assert.deepEqual(labs, { a1c: 5.4, ldl: 101, hdl: 55, fastingGlucose: 92 });
});

test("accepts plain numbers under biomarkers", () => {
  assert.deepEqual(resolveLabs({ biomarkers: { a1c: 6.1, ldl: 140 } }), { a1c: 6.1, ldl: 140 });
});

test("falls back to legacy manualLabs", () => {
  const labs = resolveLabs({ manualLabs: { a1c: 5.9, ldl: 120, fastingGlucose: 99, bpSystolic: 118, bpDiastolic: 76 } });
  assert.deepEqual(labs, { a1c: 5.9, ldl: 120, fastingGlucose: 99, bpSystolic: 118, bpDiastolic: 76 });
});

test("biomarkers win over manualLabs, manualLabs fills gaps", () => {
  const labs = resolveLabs({
    biomarkers: { a1c: { value: 5.2 } },
    manualLabs: { a1c: 7.0, ldl: { value: 99 } },
  });
  assert.equal(labs.a1c, 5.2);
  assert.equal(labs.ldl, 99);
});

test("reads tsh and vitamin D from biomarker keys", () => {
  const labs = resolveLabs({
    biomarkers: {
      tsh: { value: 2.2 },
      vitamin_d: { value: 28 },
    },
  });
  assert.equal(labs.tsh, 2.2);
  assert.equal(labs.vitaminD, 28);
});

test("vitamin D falls back to manualLabs vitaminD", () => {
  const labs = resolveLabs({ manualLabs: { vitaminD: 18, tsh: 6.1 } });
  assert.equal(labs.vitaminD, 18);
  assert.equal(labs.tsh, 6.1);
});

test("ignores missing or bad values", () => {
  assert.deepEqual(resolveLabs(null), {});
  assert.deepEqual(resolveLabs({}), {});
  assert.deepEqual(resolveLabs({ biomarkers: { a1c: { value: null }, ldl: "abc" } }), {});
});
