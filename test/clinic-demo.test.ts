import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DemoClinic from "../src/app/demo/DemoClinic";
import { trackingSummary } from "../src/lib/clinic/logic";
import {
  DEMO_BANNER,
  DEMO_DISABLED_MESSAGE,
  buildDemoSnapshot,
  demoReadingSpanDays,
  handleDemoHttp,
} from "../src/lib/clinic/demo";
import { P4P_LABEL, RPM_DOLLAR_LABEL, SCORECARD_LABEL } from "../src/lib/clinic/scorecard";

const REQUIRED = ["cms165", "cms122", "cms2", "cms159", "cms130", "cms125", "cms124", "cms139"];

test("demo data loads, measures compute, and the banner renders", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    throw new Error("demo tried to use the network");
  }) as typeof fetch;
  try {
    const snapshot = await buildDemoSnapshot();
    assert.equal(calls, 0);
    assert.equal(snapshot.banner, DEMO_BANNER);
    assert.equal(snapshot.clinic_name, "Demo Rural Health Center (Sample Data)");
    assert.ok(snapshot.patient_count >= 40 && snapshot.patient_count <= 60);
    assert.equal(snapshot.patients.length, snapshot.patient_count);
    for (const patient of snapshot.patients) {
      assert.match(patient.external_id, /^SYN-\d+$/);
      assert.match(patient.name, /^Fictional /);
      assert.match(patient.phone, /^555-010-\d{4}$/);
      if (patient.family_phone) assert.match(patient.family_phone, /^555-010-\d{4}$/);
    }
    const ages = snapshot.patients.map((patient) => patient.age ?? 0);
    assert.ok(Math.min(...ages) < 18);
    assert.ok(Math.max(...ages) > 75);
    assert.ok(snapshot.patients.some((patient) => patient.has_hypertension));
    assert.ok(snapshot.patients.some((patient) => patient.has_diabetes));
    assert.ok(snapshot.patients.some((patient) => patient.missed_medication));
    assert.ok(snapshot.patients.some((patient) => patient.missed_appointment));
    assert.ok(snapshot.patients.some((patient) => patient.lives_alone));
    const span = demoReadingSpanDays(snapshot);
    assert.ok(span >= 30 && span <= 60, `span ${span}`);

    assert.equal(snapshot.scorecard.label, SCORECARD_LABEL);
    assert.equal(snapshot.scorecard.p4p.label, P4P_LABEL);
    assert.equal(snapshot.scorecard.care_management.label, RPM_DOLLAR_LABEL);
    for (const id of REQUIRED) {
      const measure = snapshot.scorecard.measures.find((item) => item.id === id);
      assert.ok(measure, id);
      assert.ok(measure.denominator > 0, id);
      const expected = Math.round((measure.numerator / measure.denominator) * 1000) / 1000;
      assert.equal(measure.rate, expected, id);
      assert.match(measure.note, /Estimate only/);
    }
    const cms165 = snapshot.scorecard.measures.find((item) => item.id === "cms165");
    const cms122 = snapshot.scorecard.measures.find((item) => item.id === "cms122");
    assert.ok(cms165?.rate != null && cms165.rate > 0 && cms165.rate < 1);
    assert.ok(cms122?.rate != null && cms122.rate > 0 && cms122.rate < 1);

    const short = snapshot.scorecard.care_management.rpm.find((line) => line.code === "99470");
    const device = snapshot.scorecard.care_management.rpm.find((line) => line.code === "99454");
    assert.ok(short && short.units > 0);
    assert.match(short.rule, /unconfirmed/);
    assert.match(short.rule, /example/i);
    assert.ok(device && device.units > 0);
    assert.ok(snapshot.patients.some((patient) => patient.tracking.reading_days >= 16));
    assert.ok(snapshot.patients.some((patient) => patient.tracking.minutes >= 20));
    assert.ok(snapshot.patients.some((patient) => patient.tracking.minutes >= 10 && patient.tracking.minutes < 20));

    const ada = snapshot.patients.find((patient) => patient.external_id === "SYN-1001");
    assert.ok(ada?.missed_medication);
    assert.ok(ada?.cancer.some((event) => event.result === "abnormal" && event.state === "open"));
    const bo = snapshot.patients.find((patient) => patient.external_id === "SYN-1002");
    assert.match(bo?.wellness_label || "", /Family was notified, then the care team/);
    assert.ok(bo?.wellness_family_notified_at && bo.wellness_team_notified_at);
    const boRow = snapshot.scorecard.worklist.find((item) => item.external_id === "SYN-1002");
    assert.ok(boRow?.measures.includes("wellness_care_team"));
    const cam = snapshot.patients.find((patient) => patient.external_id === "SYN-1003");
    assert.equal(cam?.cognitive_due, true);
    assert.ok((cam?.strain_score || 0) >= 7);
    const camRow = snapshot.scorecard.worklist.find((item) => item.external_id === "SYN-1003");
    assert.ok(camRow?.measures.includes("caregiver_strain"));
    assert.ok(camRow?.measures.includes("cognitive_due"));
    const dee = snapshot.patients.find((patient) => patient.external_id === "SYN-1004");
    assert.ok(dee?.cancer.some((event) => event.state === "overdue"));
    const deeRow = snapshot.scorecard.worklist.find((item) => item.external_id === "SYN-1004");
    assert.ok(deeRow?.measures.includes("cancer_followup_overdue"));

    const gale = snapshot.patients.find((patient) => patient.external_id === "SYN-1007");
    assert.ok(gale);
    const again = trackingSummary(gale.readings.map((reading) => reading.recorded_on), gale.minutes, snapshot.month);
    assert.equal(gale.tracking.reading_days, again.reading_days);
    assert.ok(gale.tracking.reading_days >= 16);

    const html = renderToStaticMarkup(createElement(DemoClinic, { snapshot }));
    assert.ok(html.includes(DEMO_BANNER));
    assert.ok(html.includes("id=\"demo-banner\""));
    assert.ok(html.includes("CMS165"));
    assert.ok(html.includes("99470"));
    assert.ok(html.includes("unconfirmed"));
    assert.ok(html.includes(DEMO_DISABLED_MESSAGE));
    assert.ok(html.includes("SYN-1001"));
    assert.ok(html.includes("Fictional Ada North"));
    assert.equal(html.includes("\u2014"), false);
    assert.equal(html.includes("\u2013"), false);
    assert.equal(html.toLowerCase().includes(["hipaa", "compliant"].join("-")), false);
  } finally {
    globalThis.fetch = original;
  }
});

test("demo mode does not write or send SMS", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    throw new Error("network");
  }) as typeof fetch;
  const before = await handleDemoHttp(new Request("http://demo.local/api/demo"), fetchImpl);
  assert.equal(before.status, 200);
  const first = await before.json() as { patient_count: number; scorecard: { measures: unknown } };
  for (const action of ["sms", "wellness_tick", "insight", "email", "outreach", "reading"]) {
    const response = await handleDemoHttp(new Request("http://demo.local/api/demo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, clinicPatientId: "SYN-1001" }),
    }), fetchImpl);
    assert.equal(response.status, 403);
    const body = await response.json() as { error: string; disabled: boolean };
    assert.equal(body.disabled, true);
    assert.match(body.error, /disabled in demo/i);
  }
  const after = await handleDemoHttp(new Request("http://demo.local/api/demo?action=sms"), fetchImpl);
  const second = await after.json() as { patient_count: number; scorecard: { measures: unknown }; banner: string };
  assert.equal(second.banner, DEMO_BANNER);
  assert.equal(second.patient_count, first.patient_count);
  assert.deepEqual(second.scorecard.measures, first.scorecard.measures);
  assert.equal(calls, 0);
});

test("demo sources do not reference the live clinic store or SMS", async () => {
  const files = [
    "src/lib/clinic/demo.ts",
    "src/app/api/demo/route.ts",
    "src/app/demo/page.tsx",
    "src/app/demo/DemoClinic.tsx",
  ];
  for (const file of files) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.equal(/supabase/i.test(text), false, file);
    assert.equal(/deliverSms/.test(text), false, file);
    assert.equal(/twilio/i.test(text), false, file);
    assert.equal(/resend/i.test(text), false, file);
    assert.equal(/notifySms|tickWellness|handleClinicHttp/.test(text), false, file);
    assert.equal(/\bfetch\s*\(/.test(text), false, file);
    assert.equal(text.includes("\u2014"), false, file);
    assert.equal(text.includes("\u2013"), false, file);
  }
});
