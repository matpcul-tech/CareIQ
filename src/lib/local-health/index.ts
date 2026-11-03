export type {
  BpReading,
  LocalMarker,
  LocalSex,
  LocalStatus,
  MarkerValue,
} from "./types";

export {
  A1C_LOWER,
  A1C_UPPER,
  BP_STAGE_1,
  BP_STAGE_2,
  GLUCOSE_LOWER,
  GLUCOSE_UPPER,
  HDL_FEMALE,
  HDL_MALE_OR_UNKNOWN,
  LDL_BORDERLINE,
  LDL_HIGH,
  LDL_VERY_HIGH,
  TG_BORDERLINE,
  TG_HIGH,
  TG_VERY_HIGH,
  TSH_HIGH,
  TSH_LOW,
  VITAMIN_D_LOW,
  hdlCut,
  statusOf,
} from "./ranges";

export { phraseFor } from "./phrases";
export { buildHealthNarrative, type NarrativeInput, type NarrativeLabs } from "./narrative";
export { DISCLAIMER, finishOutput, wordingProblems } from "./wording";
