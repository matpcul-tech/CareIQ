import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  answerLocally,
  DISCLAIMER,
  LOCAL_TEMPLATE_COUNT,
  localTemplateId,
  SUGGESTED_QUESTIONS,
  wordingProblems,
} from "../src/lib/local-health";

const facts = {
  labs: {
    bpSystolic: 128,
    bpDiastolic: 78,
    a1c: 6.1,
    fastingGlucose: 110,
    ldl: 142,
    hdl: 36,
    triglycerides: 180,
    tsh: 6.2,
    vitaminD: 14,
    egfr: 70,
  },
  sex: "male" as const,
  conditions: ["asthma"],
  steps: 4200,
  heartRate: 72,
  spo2: 97,
  weight: 180,
};

const PROMPTS: Array<[string, string]> = [
  ["What is my vitamin D?", "vitamin_d"],
  ["How is my thyroid?", "tsh"],
  ["Tell me about triglycerides", "triglycerides"],
  ["What is my HDL?", "hdl"],
  ["What is my LDL?", "ldl"],
  ["Explain cholesterol", "cholesterol"],
  ["What is my A1C?", "a1c"],
  ["What is my fasting glucose?", "glucose"],
  ["What is my blood pressure?", "bp"],
  ["What steps are on file?", "steps"],
  ["What movement can I ask about?", "movement"],
  ["What meals can I ask about?", "meals"],
  ["What conditions are on file?", "conditions"],
  ["What is my heart rate?", "heart_rate"],
  ["What is my oxygen?", "oxygen"],
  ["How is my sleep?", "sleep"],
  ["What is my weight?", "weight"],
  ["What about my kidney labs?", "kidney"],
  ["Can you suggest a medicine?", "medicine"],
  ["Is this a diagnosis?", "label"],
  ["What range do you use?", "range"],
  ["Give me a summary", "summary"],
  ["Hello", "hello"],
  ["How do I reach my care team?", "care_team"],
  ["What can I ask?", "help"],
];

test("about 25 templates match distinct questions", () => {
  assert.equal(LOCAL_TEMPLATE_COUNT, 25);
  assert.equal(PROMPTS.length, 25);
  const ids = PROMPTS.map(([q]) => localTemplateId(q));
  assert.equal(new Set(ids).size, 25);
  PROMPTS.forEach(([q, id]) => assert.equal(localTemplateId(q), id));
});

test("answers fill in the value and stay the same for the same input", () => {
  const first = answerLocally("What is my A1C?", facts, 2);
  assert.equal(first.matched, true);
  assert.match(first.text, /6\.1/);
  assert.equal(first.text, answerLocally("What is my A1C?", facts, 2).text);
  assert.ok(first.text.endsWith(DISCLAIMER));
  const bp = answerLocally("What is my blood pressure?", facts, 2);
  assert.match(bp.text, /128\/78/);
  const lowD = answerLocally("vitamin d", facts, 2);
  assert.match(lowD.text, /below 20/);
  for (const [q] of PROMPTS) {
    const answer = answerLocally(q, facts, 1);
    assert.equal(answer.matched, true);
    assert.deepEqual(wordingProblems(answer.text), [], answer.text);
    assert.match(answer.text, /care team/i);
  }
});

test("an unmatched question says so and lists suggestions", () => {
  const answer = answerLocally("tell me the weather on mars", facts, 0);
  assert.equal(answer.matched, false);
  assert.match(answer.text, /No local answer is written for that question/);
  assert.deepEqual(answer.suggestions, [...SUGGESTED_QUESTIONS]);
  for (const q of SUGGESTED_QUESTIONS) {
    assert.match(answer.text, new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.notEqual(localTemplateId(q), null);
  }
  assert.ok(answer.text.endsWith(DISCLAIMER));
  assert.deepEqual(wordingProblems(answer.text), []);
});

test("the chat tab does not call the network, and the unused intel tab is gone", async () => {
  const root = path.resolve(__dirname, "..");
  const ui = await readFile(path.join(root, "src/components/CareIQHealthOS.tsx"), "utf8");
  const start = ui.indexOf("function AIChat");
  const end = ui.indexOf("function Profile");
  const body = ui.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.equal(body.includes("fetch("), false);
  assert.equal(body.includes("/api/shield"), false);
  assert.match(body, /answerLocally/);

  const sections = await readFile(path.join(root, "src/components/careiq/Sections.tsx"), "utf8");
  assert.equal(sections.includes("HealthIntelTab"), false);
  assert.equal(sections.includes("HealthOSTab"), false);
});
