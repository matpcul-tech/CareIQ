/**
 * Plain phrases for each marker and status.
 * No condition labels, no doses, no "you have".
 */

import type { BpReading, LocalMarker, LocalSex, LocalStatus, MarkerValue } from "./types";
import { hdlCut } from "./ranges";

function roundTrim(n: number, digits: number): string {
  const fixed = n.toFixed(digits);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function showNumber(key: LocalMarker, value: MarkerValue): string {
  if (key === "bp" && typeof value === "object") {
    return `${Math.round(value.systolic)}/${Math.round(value.diastolic)}`;
  }
  if (typeof value !== "number") return "";
  if (key === "a1c") return roundTrim(value, 1);
  if (key === "tsh") return roundTrim(value, 2);
  if (key === "vitamin_d") return roundTrim(value, 1);
  return String(Math.round(value));
}

const CARE = "Talk with your care team about this result.";

function bpPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "object") {
    return `No blood pressure result is on file. ${CARE}`;
  }
  const reading = value as BpReading;
  const shown = showNumber("bp", reading);
  if (status === "high") {
    return `Blood pressure on file is ${shown} mmHg, at or above 140/90. ${CARE}`;
  }
  if (status === "borderline") {
    return `Blood pressure on file is ${shown} mmHg, at or above 130/80 and below 140/90. ${CARE}`;
  }
  return `Blood pressure on file is ${shown} mmHg, below 130/80. ${CARE}`;
}

function a1cPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No A1C result is on file. ${CARE}`;
  }
  const shown = showNumber("a1c", value);
  if (status === "high") {
    return `A1C on file is ${shown}%, at or above 6.5. ${CARE}`;
  }
  if (status === "borderline") {
    return `A1C on file is ${shown}%, at or above 5.7 and below 6.5. ${CARE}`;
  }
  return `A1C on file is ${shown}%, below 5.7. ${CARE}`;
}

function glucosePhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No fasting glucose result is on file. ${CARE}`;
  }
  const shown = showNumber("fasting_glucose", value);
  if (status === "high") {
    return `Fasting glucose on file is ${shown} mg/dL, at or above 126. ${CARE}`;
  }
  if (status === "borderline") {
    return `Fasting glucose on file is ${shown} mg/dL, at or above 100 and below 126. ${CARE}`;
  }
  return `Fasting glucose on file is ${shown} mg/dL, below 100. ${CARE}`;
}

function ldlPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No LDL cholesterol result is on file. ${CARE}`;
  }
  const shown = showNumber("ldl", value);
  if (status === "very_high") {
    return `LDL cholesterol on file is ${shown} mg/dL, at or above 190. ${CARE}`;
  }
  if (status === "high") {
    return `LDL cholesterol on file is ${shown} mg/dL, at or above 160 and below 190. ${CARE}`;
  }
  if (status === "borderline") {
    return `LDL cholesterol on file is ${shown} mg/dL, at or above 130 and below 160. ${CARE}`;
  }
  return `LDL cholesterol on file is ${shown} mg/dL, below 130. ${CARE}`;
}

function tgPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No triglyceride result is on file. ${CARE}`;
  }
  const shown = showNumber("triglycerides", value);
  if (status === "very_high") {
    return `Triglycerides on file are ${shown} mg/dL, at or above 500. ${CARE}`;
  }
  if (status === "high") {
    return `Triglycerides on file are ${shown} mg/dL, at or above 200 and below 500. ${CARE}`;
  }
  if (status === "borderline") {
    return `Triglycerides on file are ${shown} mg/dL, at or above 150 and below 200. ${CARE}`;
  }
  return `Triglycerides on file are ${shown} mg/dL, below 150. ${CARE}`;
}

function hdlPhrase(status: LocalStatus, value: MarkerValue, sex: LocalSex): string {
  const cut = hdlCut(sex);
  if (status === "missing" || typeof value !== "number") {
    return `No HDL cholesterol result is on file. ${CARE}`;
  }
  const shown = showNumber("hdl", value);
  if (status === "low") {
    return `HDL cholesterol on file is ${shown} mg/dL, below ${cut}. ${CARE}`;
  }
  return `HDL cholesterol on file is ${shown} mg/dL, not below ${cut}. ${CARE}`;
}

function tshPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No TSH result is on file. ${CARE}`;
  }
  const shown = showNumber("tsh", value);
  if (status === "outside") {
    return `TSH on file is ${shown} mIU/L, outside the typical lab range. ${CARE}`;
  }
  return `TSH on file is ${shown} mIU/L, inside 0.4 to 4.5. ${CARE}`;
}

function vitaminDPhrase(status: LocalStatus, value: MarkerValue): string {
  if (status === "missing" || typeof value !== "number") {
    return `No vitamin D result is on file. ${CARE}`;
  }
  const shown = showNumber("vitamin_d", value);
  if (status === "low") {
    return `Vitamin D on file is ${shown} ng/mL, below 20 ng/mL. ${CARE}`;
  }
  return `Vitamin D on file is ${shown} ng/mL, not below 20 ng/mL. ${CARE}`;
}

export function phraseFor(
  key: LocalMarker,
  status: LocalStatus,
  value?: MarkerValue | null,
  sex: LocalSex = "unknown",
): string {
  const reading = value ?? null;
  switch (key) {
    case "bp":
      return bpPhrase(status, reading ?? { systolic: Number.NaN, diastolic: Number.NaN });
    case "a1c":
      return a1cPhrase(status, reading ?? Number.NaN);
    case "fasting_glucose":
      return glucosePhrase(status, reading ?? Number.NaN);
    case "ldl":
      return ldlPhrase(status, reading ?? Number.NaN);
    case "triglycerides":
      return tgPhrase(status, reading ?? Number.NaN);
    case "hdl":
      return hdlPhrase(status, reading ?? Number.NaN, sex);
    case "tsh":
      return tshPhrase(status, reading ?? Number.NaN);
    case "vitamin_d":
      return vitaminDPhrase(status, reading ?? Number.NaN);
    default:
      return `No result is on file. ${CARE}`;
  }
}
