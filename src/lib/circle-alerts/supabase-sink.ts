import "server-only";

import { getServiceClient } from "@/lib/supabase-server";
import type { CircleAlertRow, CircleAlertSink } from "./notify";

/**
 * Writes in-app alerts to public.care_circle_alerts with the service role.
 * Readers are limited by RLS (cca_family_select) and by the CareCircle
 * server route, which checks care_circle membership.
 */
export class SupabaseCircleAlertSink implements CircleAlertSink {
  async insert(row: CircleAlertRow): Promise<void> {
    const { error } = await getServiceClient().from("care_circle_alerts").insert(row);
    if (error) throw new Error("care_circle_alerts insert failed");
  }
}
