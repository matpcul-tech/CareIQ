import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STORAGE_BUCKET = "lab-files";

interface DeleteBody {
  file_id?: string;
}

/**
 * POST /api/lab-files/delete
 *
 * Deletes a lab file row + its associated storage object. Scoped to the
 * authenticated patient: a row whose patient_id does not match the
 * caller's session is treated as not found.
 *
 * Order of operations:
 *   1. Look up the row, scoped to (id, patient_id). 404 if missing.
 *   2. Remove the storage object. If storage delete fails, we log and
 *      continue: an orphan row would leave the file accessible by id
 *      forever, while an orphan storage object is just wasted bytes.
 *   3. Delete the row.
 */
export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  let body: DeleteBody;
  try {
    body = (await req.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const fileId = (body.file_id || "").trim();
  if (!fileId) {
    return NextResponse.json({ error: "file_id required" }, { status: 400 });
  }
  // Reject obviously local-only ids (e.g. "local-1716...") to avoid wasting a query.
  if (fileId.startsWith("local-")) {
    return NextResponse.json({ error: "file_id is not a server-issued id" }, { status: 400 });
  }

  const sb = getServiceClient();

  const { data: row, error: selErr } = await sb
    .from("lab_files")
    .select("id, patient_id, file_ref, file_type")
    .eq("id", fileId)
    .eq("patient_id", session.patientId)
    .maybeSingle();

  if (selErr) {
    // eslint-disable-next-line no-console
    console.error("[lab-files/delete] select failed:", selErr.code || selErr.message);
    await logAudit({
      sessionId,
      action: "patient.lab_file.deleted",
      dataType: "lab_file",
      success: false,
      metadata: { reason_code: "db_select" },
    });
    return NextResponse.json({ error: "could not read file record" }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const fileRef = (row as { file_ref: string }).file_ref;
  const fileType = (row as { file_type: string }).file_type;

  const { error: storageErr } = await sb.storage.from(STORAGE_BUCKET).remove([fileRef]);
  if (storageErr) {
    // eslint-disable-next-line no-console
    console.error("[lab-files/delete] storage delete failed:", storageErr.message);
    // Continue: we still want the DB row gone so the file is no longer listed.
  }

  const { error: delErr } = await sb
    .from("lab_files")
    .delete()
    .eq("id", fileId)
    .eq("patient_id", session.patientId);

  if (delErr) {
    // eslint-disable-next-line no-console
    console.error("[lab-files/delete] db delete failed:", delErr.code || delErr.message);
    await logAudit({
      sessionId,
      action: "patient.lab_file.deleted",
      dataType: "lab_file",
      success: false,
      metadata: { reason_code: "db_delete", file_type: fileType },
    });
    return NextResponse.json({ error: "could not delete record" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.lab_file.deleted",
    dataType: "lab_file",
    success: true,
    metadata: {
      file_type: fileType,
      ...(storageErr ? { reason_code: "storage_orphaned" } : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    deleted_id: fileId,
    storage_orphaned: !!storageErr,
  });
}
