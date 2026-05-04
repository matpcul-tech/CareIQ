"use client";

import { useState } from "react";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

interface InviteResponse {
  code: string;
  signup_url: string;
  expires_at: string;
}

export default function InviteFamilyButton() {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  async function generate() {
    setBusy(true);
    setError("");
    setInvite(null);
    try {
      const res = await fetch("/api/circle/generate-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify({}),
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.signup_url !== "string") {
        setError(
          typeof data?.error === "string"
            ? data.error
            : "Could not generate invite.",
        );
        setOpen(true);
        return;
      }
      setInvite(data as InviteResponse);
      setOpen(true);
    } catch {
      setError("Network error. Please try again.");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.signup_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be blocked; fall back to selecting the text.
      const input = document.getElementById(
        "cc-invite-url",
      ) as HTMLInputElement | null;
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  function close() {
    setOpen(false);
    setError("");
    setInvite(null);
    setCopied(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-sov-teal/40 bg-sov-teal/10 px-4 py-2 text-sm font-semibold text-sov-teal transition hover:bg-sov-teal/20 hover:border-sov-teal disabled:opacity-50 disabled:cursor-not-allowed self-start sm:self-auto"
      >
        {busy ? "Generating..." : "Invite Family Member"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Care Circle invite"
          className="fixed inset-0 z-50 flex items-center justify-center bg-sov-bg/85 backdrop-blur-sm p-4"
          onClick={close}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-xl2 border border-sov-border bg-sov-card shadow-cardLg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Glowing top edge to match Sovereign aesthetic */}
            <div
              className="h-0.5"
              style={{
                background:
                  "linear-gradient(90deg,transparent,#00d4b8,#8060cc,#00d4b8,transparent)",
              }}
            />

            <div className="p-6">
              <div className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-sov-teal">
                Care Circle Invite
              </div>

              {invite ? (
                <>
                  <h2 className="mb-2 font-display text-2xl font-semibold text-ink">
                    Share this link
                  </h2>
                  <p className="mb-5 text-sm leading-relaxed text-ink-soft">
                    Send the link below to your family member. When they open it they will set up their CareCircle account and start receiving alerts about you.
                  </p>

                  <label
                    htmlFor="cc-invite-url"
                    className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute"
                  >
                    Signup URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="cc-invite-url"
                      readOnly
                      value={invite.signup_url}
                      onFocus={(e) => e.currentTarget.select()}
                      className="min-w-0 flex-1 rounded-lg border border-sov-border bg-sov-panel px-3 py-2 font-mono text-xs text-ink focus:border-sov-teal focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={copyLink}
                      className="shrink-0 rounded-lg border border-sov-teal/40 bg-sov-teal/10 px-3 py-2 text-xs font-semibold text-sov-teal hover:bg-sov-teal/20 hover:border-sov-teal"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div className="mt-4 rounded-lg border border-sov-border/60 bg-sov-panel/40 px-3 py-2.5">
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-mute">
                      Code
                    </div>
                    <div className="font-mono text-base tracking-[0.3em] text-sov-teal">
                      {invite.code}
                    </div>
                  </div>

                  <p className="mt-4 text-xs leading-relaxed text-ink-mute">
                    Expires{" "}
                    {new Date(invite.expires_at).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    . One use only.
                  </p>
                </>
              ) : (
                <>
                  <h2 className="mb-2 font-display text-2xl font-semibold text-ink">
                    Could not create invite
                  </h2>
                  <p className="text-sm leading-relaxed text-ink-soft">
                    {error || "Please try again."}
                  </p>
                </>
              )}

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg border border-sov-border bg-sov-panel px-4 py-2 text-sm font-semibold text-ink hover:border-ink-mute"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
