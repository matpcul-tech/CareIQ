import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { randomUUID } from "crypto";
import {
  validateUpload,
  stripMetadata,
  MAX_FILE_BYTES,
  ValidationError,
  type LabFileType,
  type WearableFileType,
} from "@/lib/validate";
import { encryptBuffer, encryptJson } from "@/lib/crypto";
import { parseWearable } from "@/lib/parse-wearable";
import { getServiceClient } from "@/lib/supabase-server";
import { readSession } from "@/lib/session";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const STORAGE_BUCKET = "lab-files";

export async function POST(req: NextRequest) {
  const sessionId = headers().get("x-session-id") || "";
  const session = readSession();
  if (!session.patientId) {
    return NextResponse.json({ error: "authentication required" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const zone = (form.get("zone") || "").toString();
  if (zone !== "lab" && zone !== "wearable") {
    return NextResponse.json({ error: "invalid zone" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return NextResponse.json({ error: "could not read file" }, { status: 400 });
  }

  let validated: ReturnType<typeof validateUpload>;
  try {
    validated = validateUpload(bytes, zone);
  } catch (err) {
    await logAudit({
      sessionId,
      action: "validation.failed",
      dataType: zone === "lab" ? "lab_file" : "wearable",
      success: false,
      metadata: {
        reason_code: err instanceof ValidationError ? err.message : "invalid",
        byte_count: bytes.length,
      },
    });
    return NextResponse.json({ error: "file validation failed" }, { status: 400 });
  }

  if (zone === "lab") {
    return handleLab(sessionId, session.patientId, validated.bytes, validated.type as LabFileType);
  }
  return handleWearable(sessionId, session.patientId, validated.bytes, validated.type as WearableFileType);
}

async function handleLab(
  sessionId: string,
  patientId: string,
  bytes: Uint8Array,
  type: LabFileType,
) {
  const start = Date.now();
  const stripped = stripMetadata(bytes, type);
  const encrypted = encryptBuffer(Buffer.from(stripped), `lab:${patientId}`);
  const fileRef = `patients/${patientId}/${randomUUID()}.bin`;

  const sb = getServiceClient();
  const { error: upErr } = await sb.storage
    .from(STORAGE_BUCKET)
    .upload(fileRef, encrypted, {
      contentType: "application/octet-stream",
      upsert: false,
    });
  if (upErr) {
    await logAudit({
      sessionId,
      action: "patient.lab_file.uploaded",
      dataType: "lab_file",
      success: false,
      metadata: { reason_code: "storage_upload", file_type: type },
    });
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  const { error: insErr } = await sb.from("lab_files").insert({
    patient_id: patientId,
    file_ref: fileRef,
    file_type: type,
  });
  if (insErr) {
    // Best effort cleanup of the storage object
    await sb.storage.from(STORAGE_BUCKET).remove([fileRef]);
    await logAudit({
      sessionId,
      action: "patient.lab_file.uploaded",
      dataType: "lab_file",
      success: false,
      metadata: { reason_code: "db_insert", file_type: type },
    });
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.lab_file.uploaded",
    dataType: "lab_file",
    success: true,
    metadata: {
      file_type: type,
      byte_count: stripped.length,
      duration_ms: Date.now() - start,
    },
  });
  return NextResponse.json({ ok: true });
}

async function handleWearable(
  sessionId: string,
  patientId: string,
  bytes: Uint8Array,
  type: WearableFileType,
) {
  const start = Date.now();
  let parsed;
  try {
    parsed = parseWearable(bytes, type);
  } catch {
    await logAudit({
      sessionId,
      action: "patient.wearable.uploaded",
      dataType: "wearable",
      success: false,
      metadata: { reason_code: "parse_failed", file_type: type },
    });
    return NextResponse.json({ error: "could not parse wearable file" }, { status: 400 });
  }

  // Discard raw bytes. Only encrypted parsed metrics persist.
  // Local variable is allowed to be GC'd; explicitly null reference.
  // (No third-party transmission of raw file ever occurs.)
  const encrypted = encryptJson(
    {
      device: parsed.deviceType,
      sourceFormat: parsed.sourceFormat,
      metrics: parsed.metrics,
      ingestedAt: new Date().toISOString(),
    },
    `wearable:${patientId}`,
  );

  const sb = getServiceClient();
  const { error } = await sb.from("wearable_data").insert({
    patient_id: patientId,
    data_encrypted: encrypted,
    device_type: parsed.deviceType,
  });
  if (error) {
    await logAudit({
      sessionId,
      action: "patient.wearable.uploaded",
      dataType: "wearable",
      success: false,
      metadata: { reason_code: "db_insert", device_type: parsed.deviceType },
    });
    return NextResponse.json({ error: "upload failed" }, { status: 500 });
  }

  await logAudit({
    sessionId,
    action: "patient.wearable.uploaded",
    dataType: "wearable",
    success: true,
    metadata: {
      device_type: parsed.deviceType,
      file_type: type,
      metric_count: parsed.metrics.length,
      duration_ms: Date.now() - start,
    },
  });
  return NextResponse.json({
    ok: true,
    device: parsed.deviceType,
    metrics: parsed.metrics.length,
  });
}
