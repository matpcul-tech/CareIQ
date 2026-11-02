import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const FORBIDDEN = /hipaa[-\s]+compliant/i;

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  "node_modules",
  "out",
  "coverage",
]);

async function walk(dir: string, out: string[]) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    out.push(full);
  }
}

test("forbidden compliance phrase is detected by the guard", () => {
  const sample = ["HIPAA", "compliant"].join("-");
  assert.match(sample, FORBIDDEN);
  const spaced = ["HIPAA", "compliant"].join(" ");
  assert.match(spaced, FORBIDDEN);
  assert.doesNotMatch("HIPAA-aligned architecture", FORBIDDEN);
  assert.doesNotMatch("HIPAA identifier", FORBIDDEN);
});

test("source and docs do not use the forbidden compliance phrase", async () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  await walk(root, files);
  const hits: string[] = [];
  for (const file of files) {
    let text = "";
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (FORBIDDEN.test(line)) {
        hits.push(`${path.relative(root, file)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(hits, []);
});
