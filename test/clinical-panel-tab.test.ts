import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const os = readFileSync("src/components/CareIQHealthOS.tsx", "utf8");
const panel = readFileSync("src/app/clinic/uds/UdsPanel.tsx", "utf8");

test("clinical bottom bar has Panel in place of Impact, other tabs unchanged", () => {
  const nav = os.match(/const CNAV=\[(.*?)\];/)?.[1] || "";
  const labels = [...nav.matchAll(/label:"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(labels, ["Blood", "Telehealth", "Sovereign", "Panel", "Shield"]);
  assert.equal(/Impact figures|does not calculate cost per member|label:"Impact"|icon:"\$"/.test(os), false);
  assert.match(os, /case"panel":return<PatientPanelTab\/>/);
  assert.match(os, /import UdsPanel from "@\/app\/clinic\/uds\/UdsPanel"/);
});

test("panel shows a clinic staff sign-in line to non-staff viewers", () => {
  assert.match(panel, /NOT_STAFF_MESSAGE = "The patient panel is for clinic staff\./);
  assert.match(panel, /res\.status === 401 \|\| res\.status === 403/);
  assert.equal(/[\u2013\u2014]/.test(panel), false);
});

test("/clinic/uds route still renders the panel", () => {
  assert.match(readFileSync("src/app/clinic/uds/page.tsx", "utf8"), /<UdsPanel \/>/);
});
