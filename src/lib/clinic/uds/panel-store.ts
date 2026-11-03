import type { PanelPatient } from "./measures";

/**
 * Storage for imported UDS panel rows. Each row is one patient, scoped to one clinic.
 * The Supabase implementation encrypts the patient payload with src/lib/crypto.ts.
 */
export interface UdsPanelStore {
  replacePanel(clinicId: string, patients: PanelPatient[]): Promise<number>;
  listPanel(clinicId: string): Promise<PanelPatient[]>;
}

export class MemoryUdsPanelStore implements UdsPanelStore {
  rows = new Map<string, PanelPatient[]>();
  async replacePanel(clinicId: string, patients: PanelPatient[]): Promise<number> {
    this.rows.set(clinicId, patients.map((p) => structuredClone(p)));
    return patients.length;
  }
  async listPanel(clinicId: string): Promise<PanelPatient[]> {
    return (this.rows.get(clinicId) || []).map((p) => structuredClone(p));
  }
}
