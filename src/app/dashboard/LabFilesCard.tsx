"use client";

import { useRef, useState } from "react";

interface LabFile {
  id: string;
  file_type: string;
  uploaded_at: string;
}

const ACCEPT = "application/pdf,image/png,image/jpeg,image/heic";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

export default function LabFilesCard({ files }: { files: LabFile[] }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");
  const [uploaded, setUploaded] = useState<LabFile[]>([]);
  const [deletedIds, setDeletedIds] = useState<Record<string, true>>({});
  const [deletingId, setDeletingId] = useState<string>("");

  const all = [...uploaded, ...files].filter((f) => !deletedIds[f.id]);

  function openPicker() {
    setError("");
    inputRef.current?.click();
  }

  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.set("zone", "lab");
      fd.set("file", file);
      const res = await fetch("/api/onboard/upload", {
        method: "POST",
        headers: { "x-csrf-token": getCsrfToken() },
        body: fd,
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        file_type?: string;
        uploaded_at?: string;
        error?: string;
      };
      if (!res.ok || !data?.ok) {
        setError(typeof data?.error === "string" ? data.error : "Upload failed.");
        return;
      }
      setUploaded((prev) => [
        {
          id: data.id || `local-${Date.now()}`,
          file_type: data.file_type || inferType(file.name, file.type),
          uploaded_at: data.uploaded_at || new Date().toISOString(),
        },
        ...prev,
      ]);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (deletingId) return;
    if (id.startsWith("local-")) {
      // No server record yet (defensive; shouldn't happen with the new
      // upload response shape). Just hide locally.
      setDeletedIds((prev) => ({ ...prev, [id]: true }));
      return;
    }
    if (!window.confirm("Delete this lab file? This cannot be undone.")) return;
    setDeletingId(id);
    setError("");
    try {
      const res = await fetch("/api/lab-files/delete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        credentials: "same-origin",
        body: JSON.stringify({ file_id: id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data?.ok) {
        setError(typeof data?.error === "string" ? data.error : "Delete failed.");
        return;
      }
      setDeletedIds((prev) => ({ ...prev, [id]: true }));
      setUploaded((prev) => prev.filter((f) => f.id !== id));
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setDeletingId("");
    }
  }

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-base font-bold">Lab files</h2>
        <button
          type="button"
          onClick={openPicker}
          disabled={busy}
          className="btn-primary px-3 py-1.5 text-xs"
        >
          {busy ? "Uploading..." : "Upload file"}
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onChange}
        className="hidden"
        aria-hidden="true"
      />

      {all.length === 0 ? (
        <p className="text-sm text-ink-mute">No lab files uploaded yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {all.map((f) => (
            <li
              key={f.id}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 rounded-lg bg-slate-100 px-3 py-2 text-xs"
            >
              <code className="font-mono text-ink">{shortId(f.id)}</code>
              <span className="rounded-md bg-white px-2 py-0.5 text-[11px] font-semibold text-ink">
                {f.file_type.toUpperCase()}
              </span>
              <span className="text-ink-mute">{formatDate(f.uploaded_at)}</span>
              <button
                type="button"
                onClick={() => onDelete(f.id)}
                disabled={deletingId === f.id}
                aria-label={`Delete ${f.file_type} file`}
                className="rounded-md px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
              >
                {deletingId === f.id ? "..." : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className="alert-error mt-3">{error}</div>}

      <p className="mt-3 text-[11px] text-ink-mute">
        Files are AES-256-GCM encrypted before upload. PDF, PNG, JPG, or HEIC.
      </p>
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) + "..." : id;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function inferType(name: string, mime: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (lower.endsWith(".png") || mime === "image/png") return "png";
  if (lower.endsWith(".heic") || mime === "image/heic") return "heic";
  return "jpg";
}
