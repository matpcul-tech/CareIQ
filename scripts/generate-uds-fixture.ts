/**
 * Writes fixtures/uds-panel-sample.csv: 50 synthetic patients for demos.
 * Fully fictional. Deterministic seed. Run: npx tsx scripts/generate-uds-fixture.ts
 */
import { writeFileSync } from "node:fs";
import { csvCell, TEMPLATE_HEADERS } from "../src/lib/clinic/uds/csv";

let seed = 20261102;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const pad = (n: number) => String(n).padStart(2, "0");
const date = (y: number) => `${y}-${pad(int(1, 12))}-${pad(int(1, 28))}`;

const lines = [TEMPLATE_HEADERS.join(",")];
for (let i = 1; i <= 50; i++) {
  const birthYear = int(1938, 2010);
  const htn = rand() < 0.6;
  const dm = rand() < 0.45;
  const codes = [htn ? "I10" : "", dm ? pick(["E11.9", "E11.65", "E10.9"]) : "", rand() < 0.2 ? "E78.5" : ""].filter(Boolean);
  const bps = Array.from({ length: int(0, 3) }, () => `${date(2026)} ${int(112, 168)}/${int(66, 98)}`);
  if (rand() < 0.3) bps.push(`${date(2025)} ${int(120, 160)}/${int(70, 95)}`);
  const a1cs = dm ? Array.from({ length: int(0, 2) }, () => `${date(2026)} ${(5.6 + rand() * 6).toFixed(1)}`) : [];
  const sex = pick(["female", "male"]);
  const yn = (p: number) => (rand() < p ? "yes" : "no");
  const row = [
    `SYN-${String(i).padStart(4, "0")}`,
    `${birthYear}-${pad(int(1, 12))}-${pad(int(1, 28))}`,
    sex,
    codes.join(";"),
    "", "", "",
    bps.join(";"),
    a1cs.join(";"),
    [date(2026)].join(";"),
    yn(0.04), yn(0.04), yn(0.1), yn(0.08), yn(0.03), yn(0.03), "no", "no", sex === "female" && birthYear > 1980 ? yn(0.1) : "no",
  ];
  lines.push(row.map(csvCell).join(","));
}
writeFileSync("fixtures/uds-panel-sample.csv", `${lines.join("\n")}\n`);
console.log("wrote fixtures/uds-panel-sample.csv");
