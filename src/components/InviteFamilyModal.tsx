"use client";

import { useState } from "react";

/**
 * Minimal Care Circle invite modal.
 *
 * One email input, one Send button. POSTs recipient_email to
 * /api/circle/generate-invite. Status shows inline.
 */

interface InviteFamilyModalProps {
  patientName?: string;
}

interface InviteResponse {
  code: string;
  signup_url: string;
  expires_at: string;
  email_sent: boolean;
  email_id?: string;
  email_error?: string;
}

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

export default function InviteFamilyModal(_props: InviteFamilyModalProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setEmail("");
    setError("");
    setResult(null);
    setBusy(false);
    setCopied(false);
  }

  async function send() {
    if (busy) return;
    const trimmed = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/circle/generate-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        credentials: "same-origin",
        body: JSON.stringify({ recipient_email: trimmed }),
      });
      const d = (await r.json().catch(() => ({}))) as Partial<InviteResponse> & {
        error?: string;
      };
      if (!r.ok || typeof d.signup_url !== "string") {
        setError(d.error || "Could not generate invite.");
        return;
      }
      setResult(d as InviteResponse);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.signup_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      const el = document.getElementById("ciq-invite-open-link");
      if (el && typeof window !== "undefined" && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (sel) {
          sel.removeAllRanges();
          sel.addRange(range);
        }
      }
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="btn-primary inline-flex items-center justify-center gap-2 self-start text-sm sm:self-auto"
      >
        + Invite Family Member
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Care Circle invite"
          onClick={() => {
            setOpen(false);
            reset();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(7,16,31,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
            fontFamily: "'Outfit', system-ui, sans-serif",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 420,
              background: "#0d1a30",
              border: "1px solid #1e3a5f",
              borderRadius: 12,
              padding: 14,
              color: "#eef2f8",
              maxHeight: "70vh",
              overflowY: "auto",
            }}
          >
            <h2 style={{ margin: "0 0 14px", fontSize: 18, fontWeight: 600 }}>
              Send Care Circle invite
            </h2>

            {result ? (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <p style={{ margin: "0 0 14px", color: "#00d4b8" }}>
                  {result.email_sent ? "Invite sent." : "Invite created."}
                </p>
                {!result.email_sent && (
                  <p style={{ margin: "0 0 14px", color: "#d4a843" }}>
                    Email could not be sent ({result.email_error || "unknown reason"}).
                    Share this link manually:
                  </p>
                )}

                <a
                  id="ciq-invite-open-link"
                  href={result.signup_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "block",
                    width: "100%",
                    padding: "12px 0",
                    borderRadius: 10,
                    background: "#00d4b8",
                    color: "#07101f",
                    fontSize: 14,
                    fontWeight: 700,
                    textAlign: "center",
                    textDecoration: "none",
                    boxShadow: "0 0 18px rgba(0,212,184,0.3)",
                    boxSizing: "border-box",
                  }}
                >
                  Open Link
                </a>

                <div style={{ textAlign: "center", marginTop: 10 }}>
                  <button
                    type="button"
                    onClick={copyLink}
                    style={{
                      background: "transparent",
                      border: "none",
                      padding: 0,
                      color: copied ? "#00d4b8" : "#7a9bbf",
                      fontSize: 11,
                      fontFamily: "'Outfit', system-ui, sans-serif",
                      textDecoration: "underline",
                      textUnderlineOffset: 3,
                      cursor: "pointer",
                    }}
                  >
                    {copied ? "Copied!" : "Copy Invite Link"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <label
                  htmlFor="ciq-recipient-email"
                  style={{
                    display: "block",
                    fontSize: 12,
                    color: "#a3b5cc",
                    marginBottom: 6,
                  }}
                >
                  Family member&apos;s email
                </label>
                <input
                  id="ciq-recipient-email"
                  name="recipient_email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="daughter@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) {
                      e.preventDefault();
                      send();
                    }
                  }}
                  style={{
                    width: "100%",
                    background: "#11243d",
                    border: "1px solid #1e3a5f",
                    borderRadius: 8,
                    padding: "10px 12px",
                    color: "#eef2f8",
                    fontSize: 13,
                    outline: "none",
                    marginBottom: 12,
                  }}
                />

                {error && (
                  <div
                    style={{
                      padding: 10,
                      background: "rgba(232,82,110,0.1)",
                      border: "1px solid rgba(232,82,110,0.3)",
                      borderRadius: 8,
                      color: "#e8526e",
                      fontSize: 12,
                      marginBottom: 12,
                    }}
                  >
                    {error}
                  </div>
                )}

                <button
                  type="button"
                  onClick={send}
                  disabled={busy}
                  style={{
                    width: "100%",
                    padding: "12px 0",
                    borderRadius: 10,
                    border: "none",
                    background: "#00d4b8",
                    color: "#07101f",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: busy ? "not-allowed" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  {busy ? "Sending..." : "Send Invite"}
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "9px 0",
                borderRadius: 8,
                border: "1px solid #1e3a5f",
                background: "transparent",
                color: "#a3b5cc",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {result ? "Done" : "Cancel"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
