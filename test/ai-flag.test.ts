import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { isAiEnabled } from "../src/lib/ai-flag";
import { AI_OFF_INSIGHT, handleShieldPost, type ShieldModelRequest } from "../src/lib/shield-handler";
import { POST } from "../src/app/api/shield/route";
import { shieldAnthropic } from "../src/lib/shield-anthropic";

test("CAREIQ_AI_ENABLED is on only for the exact string true", () => {
  assert.equal(isAiEnabled({}), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: undefined }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: "" }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: "false" }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: "1" }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: "TRUE" }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: " true" }), false);
  assert.equal(isAiEnabled({ CAREIQ_AI_ENABLED: "true" }), true);
});

function deps(createMessage: (body: ShieldModelRequest) => Promise<{
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number | null;
    cache_creation_input_tokens: number | null;
  };
}>) {
  return {
    sessionId: "synthetic-session",
    readSession: () => ({ patientId: "synthetic-patient" }),
    loadPatient: async () => {
      throw new Error("patient load must not run when AI is off");
    },
    logAudit: async () => {
      throw new Error("audit must not run when AI is off");
    },
    getApiKey: () => {
      throw new Error("api key must not be read when AI is off");
    },
    createMessage,
  };
}

test("shield handler does not call the model when AI is off", async () => {
  let calls = 0;
  const response = await handleShieldPost(
    new Request("http://localhost/api/shield", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "What does an A1C of 6.1 mean?", mode: "narrative" }),
    }),
    {
      ...deps(async () => {
        calls += 1;
        throw new Error("model must not be called");
      }),
      isAiEnabled: () => false,
    },
  );

  assert.equal(calls, 0);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.aiEnabled, false);
  assert.equal(body.insight, AI_OFF_INSIGHT);
  assert.equal(body.meta.reason, "ai_off");
});

test("shield handler stays off when the env flag is missing", async () => {
  const previous = process.env.CAREIQ_AI_ENABLED;
  delete process.env.CAREIQ_AI_ENABLED;
  let calls = 0;
  try {
    const response = await handleShieldPost(
      new Request("http://localhost/api/shield", { method: "POST", body: "{}" }),
      deps(async () => {
        calls += 1;
        throw new Error("model must not be called");
      }),
    );
    assert.equal(calls, 0);
    const body = await response.json();
    assert.equal(body.insight, "AI is off.");
  } finally {
    if (previous === undefined) delete process.env.CAREIQ_AI_ENABLED;
    else process.env.CAREIQ_AI_ENABLED = previous;
  }
});

test("POST returns AI is off and does not construct Anthropic", async () => {
  const previous = process.env.CAREIQ_AI_ENABLED;
  process.env.CAREIQ_AI_ENABLED = "false";
  const original = shieldAnthropic.create;
  let constructed = 0;
  shieldAnthropic.create = () => {
    constructed += 1;
    throw new Error("Anthropic constructed");
  };
  try {
    const res = await POST(
      new NextRequest("http://localhost/api/shield", {
        method: "POST",
        body: JSON.stringify({ prompt: "synthetic question" }),
      }),
    );
    const body = await res.json();
    assert.equal(constructed, 0);
    assert.equal(body.insight, "AI is off.");
    assert.equal(body.ok, false);
    assert.equal(body.aiEnabled, false);
  } finally {
    shieldAnthropic.create = original;
    if (previous === undefined) delete process.env.CAREIQ_AI_ENABLED;
    else process.env.CAREIQ_AI_ENABLED = previous;
  }
});
