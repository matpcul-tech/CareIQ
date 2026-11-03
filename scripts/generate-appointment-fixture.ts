/**
 * Writes fixtures/appointments-sample.csv: synthetic appointments for SYN-0001 to SYN-0050.
 * Phone numbers use the reserved fictional 555-0100 to 555-0199 range. Deterministic seed.
 * Run: npx tsx scripts/generate-appointment-fixture.ts
 */
import { writeFileSync } from "node:fs";
import { APPT_TEMPLATE_HEADERS } from "../src/lib/clinic/reminders/csv";
import { csvCell } from "../src/lib/clinic/uds/csv";

let seed = 20261103;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
const pad = (n: number) => String(n).padStart(2, "0");

const lines = [APPT_TEMPLATE_HEADERS.join(",")];
let n = 1;
for (let i = 1; i <= 50; i++) {
  const visits = rand() < 0.3 ? 2 : 1;
  for (let v = 0; v < visits; v++) {
    const day = 3 + Math.floor(rand() * 40); // Nov 6 2026 onward
    const d = new Date(Date.UTC(2026, 10, day));
    const pref = rand() < 0.75 ? "text" : rand() < 0.6 ? "voice" : "none";
    const phone = rand() < 0.1 ? "" : `312-555-01${pad(Math.floor(rand() * 100))}`;
    lines.push([
      `APT-${String(1000 + n++)}`,
      `SYN-${String(i).padStart(4, "0")}`,
      d.toISOString().slice(0, 10),
      `${pad(8 + Math.floor(rand() * 9))}:${pick(["00", "15", "30", "45"])}`,
      pick(["Dr Rivera", "Dr Chen", "NP Okafor", "Dr Patel"]),
      pick(["Main Street Clinic", "Eastside Health Center", "Mobile Unit"]),
      pick(["checkup", "follow up", "diabetes visit", "well woman"]),
      phone,
      pick(["en", "en", "en", "es", "es", "vi"]),
      pref,
      rand() < 0.6 ? "yes" : "no",
    ].map(csvCell).join(","));
  }
}
writeFileSync("fixtures/appointments-sample.csv", `${lines.join("\n")}\n`);
console.log(`wrote fixtures/appointments-sample.csv (${lines.length - 1} appointments)`);
