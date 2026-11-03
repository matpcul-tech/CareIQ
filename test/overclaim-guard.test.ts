import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

// Built with join so this file does not match itself.
const PATTERNS: RegExp[] = [
  new RegExp(["hipaa", "compliant"].join("[-\\s]+"), "i"),
  new RegExp(["100%", "compliant"].join("\\s+"), "i"),
  new RegExp(["zero", "knowledge"].join("[-\\s]?"), "i"),
];

async function walk(dir: string, out: string[]) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
}

test("overclaim patterns match the phrases they guard", () => {
  assert.ok(PATTERNS[0].test(["HIPAA", "Compliant"].join(" ")));
  assert.ok(PATTERNS[1].test(["100%", "COMPLIANT"].join(" ")));
  assert.ok(PATTERNS[2].test(["Zero", "Knowledge"].join("-")));
  assert.ok(!PATTERNS.some((p) => p.test("HIPAA-aligned architecture")));
});

test("src and index.html contain no overclaims", async () => {
  const root = path.resolve(__dirname, "..");
  const files: string[] = [];
  await walk(path.join(root, "src"), files);
  const index = path.join(root, "index.html");
  if (existsSync(index)) files.push(index);
  const hits: string[] = [];
  for (const f of files) {
    const text = await readFile(f, "utf8");
    if (text.includes("\0")) continue;
    text.split(/\r?\n/).forEach((line, i) => {
      if (PATTERNS.some((p) => p.test(line))) hits.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
