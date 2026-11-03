import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  LAB_PDF_MANUAL_ENTRY_MESSAGE,
  labPdfModelFallbackEnabled,
  parsePdfBiomarkers,
  redactLabTextForModel,
  type LabModelClient,
  type LabModelTextRequest,
} from "../src/lib/lab-pdf-parser";
import { assertTextOnlyModelPayload, findDisallowedModelMedia } from "../src/lib/model-outbound";

const NAME = "Jane Doe";
const ADDRESS = "123 Main Street";
const DOB = "03/14/1961";
const MRN = "AB1234567";
const ZIP = "74820";
const KNOWN_NAMES = [NAME, "Jane", "Doe"];

const IDENTIFIERS = [NAME, "Jane", "Doe", ADDRESS, "Main Street", DOB, MRN, ZIP];

function buildPdf(lines: string[]): Uint8Array {
  const escaped = lines.map((line) =>
    line.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)"),
  );
  const commands = ["BT", "/F1 12 Tf", "72 720 Td"];
  escaped.forEach((line, index) => {
    if (index > 0) commands.push("0 -16 Td");
    commands.push(`(${line}) Tj`);
  });
  commands.push("ET");
  const stream = commands.join("\n");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }
  const xref = pdf.length;
  let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    table += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += table;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf, "latin1"));
}

const LONG_REPORT = [
  "Patient Jane Doe",
  "Reviewed with Jane Doe today.",
  "DOB: 03/14/1961",
  "MRN: AB1234567",
  "Address: 123 Main Street",
  "Ada OK 74820",
  "Synthetic panel used only by the parser test.",
  "No standard analyte row is present in this fixture.",
];

const LAB_ROW_REPORT = [
  "LDL Cholesterol 130 mg/dL",
  ...LONG_REPORT,
];

function assertNoIdentifiers(payload: string) {
  for (const needle of IDENTIFIERS) {
    assert.equal(
      payload.includes(needle),
      false,
      `model payload still contains ${JSON.stringify(needle)}`,
    );
  }
}

function assertNoRawPdf(payload: string, pdf: Uint8Array) {
  assert.equal(payload.includes("%PDF-"), false);
  assert.equal(payload.includes(Buffer.from(pdf).toString("base64")), false);
  assert.doesNotMatch(payload, /application\/pdf/i);
  assert.doesNotMatch(payload, /"type"\s*:\s*"document"/);
  assert.doesNotMatch(payload, /"type"\s*:\s*"image"/);
  assert.doesNotMatch(payload, /image\/(?:png|jpeg|jpg|webp|gif)/i);
  assert.doesNotMatch(payload, /data:application\/pdf/i);
  assert.doesNotMatch(payload, /data:image\//i);
}

function recordingClient(responseText = "{\"fasting_glucose\": 99}"): {
  calls: LabModelTextRequest[];
  client: LabModelClient;
} {
  const calls: LabModelTextRequest[] = [];
  return {
    calls,
    client: {
      async createMessage(body) {
        assert.equal(body.messages.length, 1);
        assert.equal(typeof body.messages[0].content, "string");
        assertTextOnlyModelPayload(body);
        calls.push(body);
        return { content: [{ type: "text", text: responseText }] };
      },
    },
  };
}

test("fallback flag is on only for the exact string true", () => {
  assert.equal(labPdfModelFallbackEnabled({}), false);
  assert.equal(labPdfModelFallbackEnabled({ LAB_PDF_MODEL_FALLBACK_ENABLED: undefined }), false);
  for (const value of ["", "false", "FALSE", "TRUE", "True", "1", "yes", "on", " true", "true "]) {
    assert.equal(
      labPdfModelFallbackEnabled({ LAB_PDF_MODEL_FALLBACK_ENABLED: value }),
      false,
      `expected ${JSON.stringify(value)} to fail closed`,
    );
  }
  assert.equal(labPdfModelFallbackEnabled({ LAB_PDF_MODEL_FALLBACK_ENABLED: "true" }), true);
});

test("shield redaction removes synthetic name, address, DOB, and MRN", () => {
  const raw = LONG_REPORT.join("\n");
  const redacted = redactLabTextForModel(raw, KNOWN_NAMES);
  assertNoIdentifiers(redacted);
  assert.match(redacted, /\[NAME\]/);
  assert.match(redacted, /\[ADDRESS\]/);
  assert.match(redacted, /\[DATE\]/);
  assert.match(redacted, /\[MRN\]/);
  assert.match(redacted, /\[ZIP\]/);
});

test("synthetic PDF sends redacted text and never raw PDF bytes", async () => {
  const pdf = buildPdf(LONG_REPORT);
  const { calls, client } = recordingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true", CAREIQ_AI_ENABLED: "true" },
    knownNames: KNOWN_NAMES,
    modelClient: client,
  });

  assert.ok(result.text_chars >= 100, `expected extractable text, got ${result.text_chars}`);
  assert.equal(pdf[0], 0x25, "caller PDF bytes were detached");
  assert.equal(calls.length, 1);
  assert.equal(result.extraction_mode, "redacted_text");
  assert.equal(result.biomarkers.fasting_glucose, 99);

  const payload = JSON.stringify(calls[0]);
  assertNoRawPdf(payload, pdf);
  assertNoIdentifiers(payload);
  assert.match(calls[0].messages[0].content, /\[NAME\]/);
  assert.match(calls[0].messages[0].content, /\[MRN\]/);
  assert.match(calls[0].messages[0].content, /\[ADDRESS\]/);
  assert.match(calls[0].messages[0].content, /\[DATE\]/);
});

test("local lab row does not call the model even when the flag is on", async () => {
  const pdf = buildPdf(LAB_ROW_REPORT);
  const { calls, client } = recordingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true" },
    knownNames: KNOWN_NAMES,
    modelClient: client,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.extraction_mode, "text");
  assert.equal(result.biomarkers.ldl, 130);
  assert.equal(result.user_message, undefined);
  assert.equal(pdf[0], 0x25);
});

test("flag fails closed for unset, invalid, and false values", async () => {
  const pdf = buildPdf(LONG_REPORT);
  const values: Array<string | undefined> = [
    undefined,
    "",
    "false",
    "TRUE",
    "1",
    "yes",
    " true",
    "true ",
  ];
  for (const value of values) {
    const { calls, client } = recordingClient();
    const env: Record<string, string | undefined> = {};
    if (value !== undefined) env.LAB_PDF_MODEL_FALLBACK_ENABLED = value;
    const result = await parsePdfBiomarkers(pdf, {
      env,
      knownNames: KNOWN_NAMES,
      modelClient: client,
    });
    assert.equal(calls.length, 0, `model was called for flag ${JSON.stringify(value)}`);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "model_fallback_disabled");
    assert.equal(result.user_message, LAB_PDF_MANUAL_ENTRY_MESSAGE);
    assert.match(result.user_message, /manually/);
  }
});

test("model fallback stays off when CAREIQ_AI_ENABLED is not true", async () => {
  const pdf = buildPdf(LONG_REPORT);
  const { calls, client } = recordingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true" },
    knownNames: KNOWN_NAMES,
    modelClient: client,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.reason, "ai_disabled");
  assert.equal(result.extraction_mode, "none");
  assert.equal(result.user_message, LAB_PDF_MANUAL_ENTRY_MESSAGE);
});

test("image-only PDF never reaches the model, even when the flag is on", async () => {
  const pdf = buildPdf([
    "Jane Doe",
    "MRN: AB1234567",
    "DOB: 03/14/1961",
    "123 Main Street",
  ]);
  const { calls, client } = recordingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true" },
    knownNames: KNOWN_NAMES,
    modelClient: client,
  });
  assert.ok(result.text_chars < 100, `expected a short scan, got ${result.text_chars}`);
  assert.equal(calls.length, 0);
  assert.equal(result.reason, "image_only_manual_entry");
  assert.equal(result.user_message, LAB_PDF_MANUAL_ENTRY_MESSAGE);
  assert.equal(result.extraction_mode, "none");
});

test("critical identifier left after redaction blocks the model call", async () => {
  const pdf = buildPdf([
    ...LONG_REPORT,
    "Loose number 123456789 sits outside a labeled field.",
  ]);
  const { calls, client } = recordingClient();
  const result = await parsePdfBiomarkers(pdf, {
    env: { LAB_PDF_MODEL_FALLBACK_ENABLED: "true" },
    knownNames: KNOWN_NAMES,
    modelClient: client,
  });
  assert.equal(calls.length, 0);
  assert.equal(result.reason, "redaction_incomplete");
  assert.equal(result.user_message, LAB_PDF_MANUAL_ENTRY_MESSAGE);
});

test("document and image blocks are refused before a model call", () => {
  const pdfBlock = {
    messages: [{
      role: "user",
      content: [{
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: "JVBERi0" },
      }],
    }],
  };
  assert.equal(findDisallowedModelMedia(pdfBlock), "document");
  assert.throws(() => assertTextOnlyModelPayload(pdfBlock));

  const imageBlock = {
    messages: [{
      role: "user",
      content: [{
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "aaaa" },
      }],
    }],
  };
  assert.equal(findDisallowedModelMedia(imageBlock), "image");
  assert.throws(() => assertTextOnlyModelPayload(imageBlock));
  assert.equal(findDisallowedModelMedia({ messages: [{ role: "user", content: "LDL 130" }] }), null);
});

test("lab parser source does not build a PDF or image model block", async () => {
  const src = await readFile(path.resolve("src/lib/lab-pdf-parser.ts"), "utf8");
  assert.doesNotMatch(src, /media_type:\s*["']application\/pdf["']/);
  assert.doesNotMatch(src, /type:\s*["']document["']/);
  assert.doesNotMatch(src, /type:\s*["']image["']/);
  assert.doesNotMatch(src, /renderPageAsImage|extractImages/);
});
