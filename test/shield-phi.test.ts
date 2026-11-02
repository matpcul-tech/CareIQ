import assert from "node:assert/strict";
import test from "node:test";
import { handleShieldPost, type ShieldModelRequest } from "../src/lib/shield-handler";
import {
  buildShieldUserContent,
  redactIdentifiers,
  replaceKnownNames,
} from "../src/lib/shield-redact";

const IDENTIFIERS = [
  "Jane Doe",
  "Jane",
  "Doe",
  "123 Main Street",
  "Main Street",
  "74820",
  "123-45-6789",
  "405-555-0142",
  "555-123-4567",
  "03/14/1961",
  "1961-03-14",
  "AB1234567",
  "jane.doe@example.com",
  "Dr. Smith",
  "CDIB CN-123-45678",
];

function assertNoIdentifiers(payload: string) {
  for (const needle of IDENTIFIERS) {
    assert.equal(
      payload.includes(needle),
      false,
      `outgoing model payload still contains ${JSON.stringify(needle)}`,
    );
  }
}

test("redaction keeps clinical phrases and replaces synthetic identifiers", () => {
  assert.equal(redactIdentifiers("Dr. visit on Main"), "Dr. visit on Main");
  assert.equal(redactIdentifiers("LDL 130"), "LDL 130");
  assert.equal(redactIdentifiers("A1C of 8.2"), "A1C of 8.2");

  const raw = [
    "Patient Jane Doe, DOB: 03/14/1961, MRN AB1234567, SSN 123-45-6789,",
    "phone 405-555-0142, lives at 123 Main Street, Ada OK 74820.",
    "Mrs. Jane Doe has email jane.doe@example.com and CDIB CN-123-45678.",
  ].join(" ");
  const out = redactIdentifiers(raw);
  for (const needle of [
    "Jane Doe",
    "123 Main Street",
    "74820",
    "123-45-6789",
    "405-555-0142",
    "03/14/1961",
    "AB1234567",
    "jane.doe@example.com",
    "CDIB CN-123-45678",
  ]) {
    assert.equal(out.includes(needle), false, `redactor left ${JSON.stringify(needle)}`);
  }
  assert.match(out, /\[SSN\]/);
  assert.match(out, /\[PHONE\]/);
  assert.match(out, /\[ADDRESS\]/);
  assert.match(out, /\[ZIP\]/);
  assert.match(out, /\[MRN\]/);
  assert.match(out, /\[DATE\]/);
  assert.match(out, /\[EMAIL\]/);
  assert.match(out, /\[NAME\]/);
  assert.match(out, /\[ID\]/);
});

test("stored patient name is replaced even when it has no title", () => {
  const out = replaceKnownNames(
    "Grandma saw Jane Doe today. Jane called. Doe confirmed.",
    ["Jane Doe", "Jane", "Doe"],
  );
  assert.equal(out.includes("Jane"), false);
  assert.equal(out.includes("Doe"), false);
  assert.match(out, /\[NAME\]/);
});

test("shield user content drops free text and keeps allow-listed clinical values", () => {
  const content = buildShieldUserContent({
    profile: {
      firstName: "Jane",
      lastName: "Doe",
      dateOfBirth: "1961-03-14",
      communityAffiliation: "123 Main Street, Ada OK 74820",
    },
    history: {
      chronicConditions: [
        "diabetes",
        "Jane Doe lives at 123 Main Street, Ada OK 74820",
      ],
      medications: "metformin 500 mg",
      allergies: "penicillin",
      familyHistory: "Mother Jane Doe had hypertension",
    },
    wearable: {
      device: "Jane Doe Fitbit",
      metrics: [{ date: "2026-07-24", heartRate: 72, steps: 10234 }],
    },
    clientCtx: {
      patientAge: 65,
      communityAffiliation: "Ada OK 74820",
      conditions: ["Jane Doe lives at 123 Main Street", "hypertension", "not a real condition 405-555-0142"],
      vitals: [
        { name: "Glycemic", val: "8.2", unit: "A1C %", status: "warn" },
        { name: "LDL Chol.", val: "130", unit: "mg/dL", status: "alert" },
        { name: "Steps", val: "10,234", unit: "today", status: "ok" },
        { name: "Jane Doe", val: "123-45-6789", unit: "mmHg", status: "ok" },
        { name: "Blood Pressure", val: "Jane Doe", unit: "mmHg", status: "ok" },
      ],
      domains: [
        { name: "Metabolic", score: 58 },
        { name: "74820 Ada", score: 10 },
      ],
    },
    mode: "insight",
  });

  assertNoIdentifiers(content);
  assert.match(content, /COMMUNITY_PATIENT/);
  assert.match(content, /COMMUNITY_LOCATION/);
  assert.match(content, /Type 2 diabetes/);
  assert.match(content, /Hypertension/);
  assert.match(content, /A1C: 8\.2/);
  assert.match(content, /LDL cholesterol: 130/);
  assert.match(content, /Steps: 10,234/);
  assert.match(content, /hr=72/);
  assert.match(content, /steps=10234/);
  assert.match(content, /Metabolic: 58\/100/);
  assert.equal(content.includes("metformin"), false);
  assert.equal(content.includes("penicillin"), false);
  assert.equal(content.includes("What should we do"), false);
});

test("synthetic PHI through the Shield does not reach the model payload", async () => {
  const calls: ShieldModelRequest[] = [];
  const prompt = "Call Dr. Smith at 555-123-4567 about Jane Doe at 123 Main Street. What should we do about her A1C of 8.2?";
  const response = await handleShieldPost(
    new Request("http://localhost/api/shield", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt,
        mode: "insight",
        context: {
          conditions: ["Jane Doe lives at 123 Main Street, Ada OK 74820"],
          vitals: [
            { name: "Glycemic", val: "8.2", unit: "%", status: "warn" },
            { name: "LDL Chol.", val: "130", unit: "mg/dL", status: "alert" },
          ],
          domains: [{ name: "Cardiovascular", score: 62 }],
        },
      }),
    }),
    {
      sessionId: "synthetic-session",
      readSession: () => ({ patientId: "synthetic-patient" }),
      loadPatient: async () => ({
        profile: {
          firstName: "Jane",
          lastName: "Doe",
          dateOfBirth: "1961-03-14",
          communityAffiliation: "Ada clinic",
        },
        history: {
          chronicConditions: ["diabetes", "Jane Doe lives at 123 Main Street"],
          medications: "yes listed",
          allergies: "",
          familyHistory: "",
        },
        wearable: { device: "Upload", metrics: [{ date: "2026-07-24", heartRate: 72 }] },
      }),
      logAudit: async () => {},
      getApiKey: () => "sk-ant-synthetic",
      createMessage: async (body) => {
        calls.push(body);
        return {
          content: [{ type: "text", text: "A calm note for COMMUNITY_PATIENT with A1C context." }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 10,
            output_tokens: 10,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  );

  assert.equal(calls.length, 1);
  const payload = JSON.stringify(calls[0]);
  assertNoIdentifiers(payload);
  assert.match(payload, /A1C: 8\.2/);
  assert.match(payload, /LDL cholesterol: 130/);
  assert.match(payload, /Type 2 diabetes/);
  assert.match(payload, /hr=72/);
  assert.equal(payload.includes("What should we do"), false);
  assert.equal(payload.includes(prompt), false);

  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.meta.blocked, undefined);
  assert.equal(body.action, "anonymize");
});

test("CRITICAL synthetic SSN blocks the model call", async () => {
  const calls: ShieldModelRequest[] = [];
  const response = await handleShieldPost(
    new Request("http://localhost/api/shield", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Patient Jane Doe, DOB: 03/14/1961, MRN AB1234567, SSN 123-45-6789, phone 405-555-0142, lives at 123 Main Street, Ada OK 74820.",
      }),
    }),
    {
      sessionId: "synthetic-session",
      readSession: () => ({ patientId: "synthetic-patient" }),
      loadPatient: async () => {
        throw new Error("decrypt should not run after a critical block");
      },
      logAudit: async () => {},
      getApiKey: () => "sk-ant-synthetic",
      createMessage: async (body) => {
        calls.push(body);
        return {
          content: [{ type: "text", text: "should not be called" }],
          stop_reason: "end_turn",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        };
      },
    },
  );

  assert.equal(calls.length, 0);
  const body = await response.json();
  assert.equal(body.meta.blocked, true);
  assert.equal(body.riskLevel, "CRITICAL");
  assert.equal(body.action, "block");
  assert.equal(JSON.stringify(body).includes("123-45-6789"), false);
  assert.equal(JSON.stringify(body).includes("Jane Doe"), false);
});
