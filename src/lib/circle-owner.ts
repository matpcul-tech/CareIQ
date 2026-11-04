import "server-only";

/**
 * Make sure the patient themselves has a care_circle row (care_role admin,
 * member_user_id = their Supabase auth user id) so they can sign in to
 * CareCircle and see their own circle. CareCircle finds a circle only by
 * care_circle.member_user_id, and CareIQ's patient_id is a patients.id that
 * never equals the auth user id, so without this row the owner sees "no
 * Care Circle is linked to this email".
 *
 * The sov_auth cookie is not signed, so the auth user id it carries is not
 * trusted on its own: the auth user's email must hash to the same
 * email_hash stored on the patients row for this patient_id. Idempotent and
 * best-effort; it never throws.
 */

type Result = { ok: true; action: "exists" | "linked" | "inserted" } | { ok: false; reason: string };

// Minimal shape of the supabase-js service client used here (eases testing).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

export async function ensureOwnerCircleRow(
  sb: Sb,
  args: { patientId: string; authUserId: string | null; hashEmail: (e: string) => string },
): Promise<Result> {
  try {
    const { patientId, authUserId } = args;
    if (!patientId || !authUserId) return { ok: false, reason: "missing_auth_user" };

    const { data: userData, error: userErr } = await sb.auth.admin.getUserById(authUserId);
    const email: string | undefined = userData?.user?.email?.toLowerCase();
    if (userErr || !email) return { ok: false, reason: "auth_user_not_found" };

    const { data: pat } = await sb.from("patients").select("email_hash").eq("id", patientId).maybeSingle();
    if (!pat?.email_hash || pat.email_hash !== args.hashEmail(email)) {
      return { ok: false, reason: "owner_mismatch" };
    }

    const { data: mine } = await sb
      .from("care_circle")
      .select("id")
      .eq("patient_id", patientId)
      .eq("member_user_id", authUserId)
      .limit(1);
    if (Array.isArray(mine) && mine.length > 0) return { ok: true, action: "exists" };

    // A row may already exist for the same email (unique on patient_id,
    // lower(member_email)) without a user id. Link it instead of inserting.
    const { data: byEmail } = await sb
      .from("care_circle")
      .select("id")
      .eq("patient_id", patientId)
      .ilike("member_email", email)
      .limit(1);
    if (Array.isArray(byEmail) && byEmail.length > 0) {
      const { error } = await sb
        .from("care_circle")
        .update({ member_user_id: authUserId, care_role: "admin" })
        .eq("id", byEmail[0].id);
      return error ? { ok: false, reason: "update_failed" } : { ok: true, action: "linked" };
    }

    const meta = (userData.user.user_metadata || {}) as Record<string, unknown>;
    const name =
      (typeof meta.full_name === "string" && meta.full_name.trim()) || email.split("@")[0];
    const { error: insErr } = await sb.from("care_circle").insert({
      patient_id: patientId,
      member_user_id: authUserId,
      member_email: email,
      member_name: name,
      relationship: "Self",
      alert_level: "informational",
      care_role: "admin",
    });
    if (insErr) return { ok: false, reason: "insert_failed" };
    return { ok: true, action: "inserted" };
  } catch {
    return { ok: false, reason: "exception" };
  }
}
