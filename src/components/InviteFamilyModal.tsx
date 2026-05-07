"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Minimal Care Circle invite modal.
 *
 * One email input, one Send button. POSTs recipient_email plus the
 * patient's display name (so the family-side cc-session can show the
 * patient's name instead of falling back to "Your loved one") to
 * /api/circle/generate-invite. Status shows inline.
 *
 * Renders the modal through a document.body portal so it escapes any
 * ancestor with `transform`, `filter`, `backdrop-filter`, etc., which
 * would otherwise turn `position:fixed` into a containing-block trap
 * (the dashboard header uses backdrop-filter: blur and was pinning the
 * modal to the top of the screen instead of the viewport).
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

export default function InviteFamilyModal(props: InviteFamilyModalProps) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portal mount happens client-side only.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while modal is open so the page underneath does not
  // scroll independently of the sheet.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
      // Pass the patient's display name through so the generate-invite
      // route writes care_circle_invites.patient_name correctly. The
      // redeem route on care-os uses that value verbatim and falls back
      // to auth.users metadata only when this field is missing; sending
      // it here removes that fallback path on the happy flow.
      const patientName = (props.patientName || "").trim();
      const payload: Record<string, unknown> = { recipient_email: trimmed };
      if (patientName) payload.patient_name = patientName;

      const r = await fetch("/api/circle/generate-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        credentials: "same-origin",
        body: JSON.stringify(payload),
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

  const sheet = open ? (
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
        zIndex: 2147483647,
        background: "rgba(7,16,31,0.85)",
        display: "flex",
        flexDirection: "column",
        justifyContent: "flex-end",
        padding: 0,
        fontFamily: "'Outfit', system-ui, sans-serif",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "#0d1a30",
          borderTop: "1px solid #1e3a5f",
          borderRadius: "16px 16px 0 0",
          padding: "16px 18px calc(20px + env(safe-area-inset-bottom,0px))",
          color: "#eef2f8",
          boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 4,
            borderRadius: 2,
            background: "rgba(255,255,255,0.18)",
            margin: "0 auto 14px",
          }}
        />
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
            marginTop: 10,
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
  ) : null;

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
      {mounted && sheet ? createPortal(sheet, document.body) : null}
    </>
  );
}
