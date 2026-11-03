import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const DASH = /[\u2013\u2014]/;

const ROOTS = [
  "src/lib/ai-flag.ts",
  "src/lib/shield-anthropic.ts",
  "src/lib/local-health",
  "test/ai-flag.test.ts",
  "test/local-health.test.ts",
  "test/local-narrative.test.ts",
  "test/local-plans.test.ts",
  "test/local-copy.test.ts",
];

async function filesIn(rel: string, out: string[]) {
  const full = path.resolve(__dirname, "..", rel);
  const stat = await readdir(full, { withFileTypes: true }).catch(async () => {
    out.push(full);
    return null;
  });
  if (!stat) return;
  for (const entry of stat) {
    const next = path.join(full, entry.name);
    if (entry.isDirectory()) {
      await filesIn(path.relative(path.resolve(__dirname, ".."), next), out);
    } else if (entry.isFile()) {
      out.push(next);
    }
  }
}

test("new local files do not use en dashes or em dashes", async () => {
  const files: string[] = [];
  for (const root of ROOTS) await filesIn(root, files);
  const hits: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (DASH.test(line)) hits.push(`${path.relative(path.resolve(__dirname, ".."), file)}:${index + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
