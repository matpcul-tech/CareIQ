/**
 * Guards for local copy. Generated text must not diagnose, must not say
 * "you have", and must not give a dose. The closing sentence is exact.
 */

export const DISCLAIMER = "This is general information, not a diagnosis.";

const YOU_HAVE = /\byou have\b/i;
const DIAGNOS = /diagnos/i;

// A number then a dose unit. Lab concentrations such as "130 mg/dL" and
// "20 ng/mL" are allowed because the unit is not a bare mg, mcg, IU, or unit.
const DOSE =
  /(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:i\.?u\.?|mcg|μg|µg|ug|units?|tablets?|capsules?|drops?)\b|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*mg\b(?!\s*\/)|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*g\b(?!\s*\/)|(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*ml\b(?![/\w])/i;

export function wordingProblems(text: string): string[] {
  const problems: string[] = [];
  if (YOU_HAVE.test(text)) problems.push("you have");
  const withoutDisclaimer = text.split(DISCLAIMER).join("");
  if (DIAGNOS.test(withoutDisclaimer)) problems.push("diagnos");
  if (DOSE.test(text)) problems.push("dose");
  if (text.includes("\u2013") || text.includes("\u2014")) problems.push("dash");
  return problems;
}

export function finishOutput(text: string): string {
  let body = text.trim();
  if (!/care team/i.test(body)) {
    body = `${body}\n\nTalk with your care team about this.`;
  }
  if (!body.endsWith(DISCLAIMER)) {
    body = `${body}\n${DISCLAIMER}`;
  }
  return body;
}
