"use client";

import { useState, useCallback } from "react";

/**
 * InviteFamilyModal
 *
 * Patient-side trigger + modal for the Care Circle invite flow.
 * Calls POST /api/circle/generate-invite (cookie session auth) and
 * shows the resulting CareCircle signup URL as a tappable hyperlink
 * with a copy button.
 *
 * Standalone: ships its own inline styles so it can be dropped into
 * any CareIQ patient view without touching that view's stylesheet.
 * Uses the existing Sovereign palette (teal #00d4b8, navy #07101f,
 * card #0d1a30, panel #11243d, border #1e3a5f).
 */

interface InviteFamilyModalProps {
  patientName?: string;
}

interface InviteResponse {
  code: string;
  signup_url: string;
  expires_at: string;
}

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

const FONT_DISPLAY = "'Playfair Display', Georgia, serif";
const FONT_MONO = "'DM Mono', ui-monospace, monospace";
const FONT_SANS = "'Outfit', system-ui, sans-serif";

const triggerStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 14px",
  borderRadius: 10,
  border: "1px solid rgba(0,212,184,0.4)",
  background: "rgba(0,212,184,0.1)",
  color: "#00d4b8",
  fontFamily: FONT_SANS,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
  transition: "all .2s",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 50,
  background: "rgba(7,16,31,0.85)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 420,
  background: "#0d1a30",
  border: "1px solid #1e3a5f",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
};

const edgeStyle: React.CSSProperties = {
  height: 2,
  background:
    "linear-gradient(90deg,transparent,#00d4b8,#8060cc,#00d4b8,transparent)",
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  color: "#00d4b8",
  textTransform: "uppercase",
  letterSpacing: ".22em",
  marginBottom: 10,
  fontWeight: 600,
};

const titleStyle: React.CSSProperties = {
  fontFamily: FONT_DISPLAY,
  fontSize: 22,
  fontWeight: 600,
  color: "#eef2f8",
  marginBottom: 8,
};

const descStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#a3b5cc",
  lineHeight: 1.55,
  marginBottom: 18,
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontFamily: FONT_MONO,
  fontSize: 10,
  color: "#7a9bbf",
  textTransform: "uppercase",
  letterSpacing: ".18em",
  marginBottom: 6,
  fontWeight: 600,
};

// Tappable hyperlink that visually matches the previous read-only input
// (same panel background, border, padding, mono font) but opens the URL
// in a new tab on tap or click.
const urlLinkStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: "#11243d",
  border: "1px solid #1e3a5f",
  borderRadius: 8,
  padding: "9px 12px",
  color: "#00d4b8",
  fontFamily: FONT_MONO,
  fontSize: 11,
  textDecoration: "underline",
  textDecorationColor: "rgba(0,212,184,0.45)",
  textUnderlineOffset: 3,
  wordBreak: "break-all",
  display: "inline-block",
  lineHeight: 1.4,
  cursor: "pointer",
};

const copyBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "9px 14px",
  borderRadius: 8,
  border: "1px solid rgba(0,212,184,0.4)",
  background: "rgba(0,212,184,0.1)",
  color: "#00d4b8",
  fontFamily: FONT_SANS,
  fontSize: 11,
  fontWeight: 600,
  cursor: "pointer",
};

const codeBoxStyle: React.CSSProperties = {
  marginTop: 14,
  padding: "11px 13px",
  background: "rgba(17,36,61,0.4)",
  border: "1px solid rgba(30,58,95,0.6)",
  borderRadius: 8,
};

const codeValStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 18,
  color: "#00d4b8",
  letterSpacing: ".3em",
};

const closeBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid #1e3a5f",
  background: "#11243d",
  color: "#eef2f8",
  fontFamily: FONT_SANS,
  fontSize: 12,
  fontWeight: 600,
  cursor: "pointer",
};

export default function InviteFamilyModal({ patientName }: InviteFamilyModalProps) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    setInvite(null);
    try {
      const r = await fetch("/api/circle/generate-invite", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": getCsrfToken(),
        },
        body: JSON.stringify(patientName ? { patient_name: patientName } : {}),
        credentials: "same-origin",
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || typeof d?.signup_url !== "string") {
        setError(typeof d?.error === "string" ? d.error : "Could not generate invite.");
        setOpen(true);
        return;
      }
      setInvite(d as InviteResponse);
      setOpen(true);
    } catch {
      setError("Network error. Please try again.");
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }, [patientName]);

  const copy = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.signup_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API blocked: select the link's text so the patient can
      // long-press / right-click to copy manually.
      const el = document.getElementById("ciq-invite-url");
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
  }, [invite]);

  const close = useCallback(() => {
    setOpen(false);
    setError("");
    setCopied(false);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        aria-label="Invite a family member to your Care Circle"
        style={{ ...triggerStyle, opacity: busy ? 0.5 : 1, cursor: busy ? "not-allowed" : "pointer" }}
      >
        {busy ? "Generating..." : "+ Invite Family Member"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Care Circle invite"
          style={overlayStyle}
          onClick={close}
        >
          <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
            <div style={edgeStyle} />
            <div style={{ padding: 22 }}>
              <div style={eyebrowStyle}>Care Circle Invite</div>

              {invite ? (
                <>
                  <div style={titleStyle}>Share this link</div>
                  <div style={descStyle}>
                    Send the link below to your family member. When they open it they will set up their CareCircle account and start receiving alerts about you.
                  </div>

                  <div id="ciq-invite-url-label" style={labelStyle}>
                    Signup URL
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <a
                      id="ciq-invite-url"
                      href={invite.signup_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-labelledby="ciq-invite-url-label"
                      aria-label={`Open Care Circle signup link for ${patientName || "patient"} in a new tab`}
                      style={urlLinkStyle}
                    >
                      {invite.signup_url}
                    </a>
                    <button type="button" onClick={copy} style={copyBtnStyle}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div style={codeBoxStyle}>
                    <div
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        color: "#7a9bbf",
                        textTransform: "uppercase",
                        letterSpacing: ".18em",
                        marginBottom: 4,
                        fontWeight: 600,
                      }}
                    >
                      Code
                    </div>
                    <div style={codeValStyle}>{invite.code}</div>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      fontSize: 11,
                      color: "#7a9bbf",
                      lineHeight: 1.5,
                    }}
                  >
                    {invite.expires_at
                      ? `Expires ${new Date(invite.expires_at).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}. One use only.`
                      : "One use only."}
                  </div>
                </>
              ) : (
                <>
                  <div style={titleStyle}>Could not create invite</div>
                  <div
                    style={{
                      padding: 11,
                      background: "rgba(232,82,110,0.1)",
                      border: "1px solid rgba(232,82,110,0.3)",
                      borderRadius: 8,
                      color: "#e8526e",
                      fontSize: 12,
                      marginBottom: 14,
                    }}
                  >
                    {error || "Please try again."}
                  </div>
                </>
              )}

              <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" onClick={close} style={closeBtnStyle}>
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
