import "server-only";

import { getServiceClient } from "@/lib/supabase-server";
import type { InviteLink, OnboardingStore } from "./logic";

const INVITE_COLS = "id,clinic_id,role,is_admin,created_by,expires_at,used_at,revoked_at,created_at";

export class SupabaseOnboardingStore implements OnboardingStore {
  private sb() { return getServiceClient(); }

  async consumeSetupToken(tokenHash: string, nowIso: string): Promise<boolean> {
    // One UPDATE with all conditions in the WHERE clause, so two requests cannot both win.
    const { data, error } = await this.sb().from("clinic_setup_tokens")
      .update({ used_at: nowIso })
      .eq("token_hash", tokenHash).is("used_at", null).gt("expires_at", nowIso)
      .select("id");
    if (error) throw new Error(error.message);
    return (data || []).length === 1;
  }

  async releaseSetupToken(tokenHash: string): Promise<void> {
    await this.sb().from("clinic_setup_tokens").update({ used_at: null }).eq("token_hash", tokenHash);
  }

  async createInvite(row: Omit<InviteLink, "id" | "used_at" | "revoked_at" | "created_at"> & { token_hash: string; created_at: string }): Promise<InviteLink> {
    const { data, error } = await this.sb().from("clinic_invite_links").insert(row).select(INVITE_COLS).single();
    if (error || !data) throw new Error(error?.message || "invite insert failed");
    return data as InviteLink;
  }

  async consumeInvite(tokenHash: string, nowIso: string): Promise<InviteLink | null> {
    const { data, error } = await this.sb().from("clinic_invite_links")
      .update({ used_at: nowIso })
      .eq("token_hash", tokenHash).is("used_at", null).is("revoked_at", null).gt("expires_at", nowIso)
      .select(INVITE_COLS);
    if (error) throw new Error(error.message);
    return data && data.length === 1 ? (data[0] as InviteLink) : null;
  }

  async releaseInvite(tokenHash: string): Promise<void> {
    await this.sb().from("clinic_invite_links").update({ used_at: null }).eq("token_hash", tokenHash);
  }

  async listInvites(clinicId: string): Promise<InviteLink[]> {
    const { data, error } = await this.sb().from("clinic_invite_links").select(INVITE_COLS)
      .eq("clinic_id", clinicId).order("created_at", { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    return (data || []) as InviteLink[];
  }

  async revokeInvite(clinicId: string, id: string, nowIso: string): Promise<boolean> {
    const { data, error } = await this.sb().from("clinic_invite_links").update({ revoked_at: nowIso })
      .eq("id", id).eq("clinic_id", clinicId).is("used_at", null).is("revoked_at", null).select("id");
    if (error) throw new Error(error.message);
    return (data || []).length === 1;
  }
}
