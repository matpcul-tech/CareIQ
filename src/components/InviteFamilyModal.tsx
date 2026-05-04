"use client";

import { useState, useCallback } from "react";

/**
 * InviteFamilyModal
 *
 * Patient-side trigger + modal for the Care Circle invite flow.
 * The patient enters the family member's email and a short note,
 * then clicks Send. The CareIQ /api/circle/generate-invite endpoint
 * creates the invite row and emails the signup link directly to the
 * recipient. The URL is still rendered as a tappable hyperlink with
 * a Copy button as a fallback in case email delivery fails.
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

const RELATIONSHIPS = [
  "Spouse",
  "Daughter",
  "Son",
  "Parent",
  "Sibling",
  "Caregiver",
  "Home Health Aide",
  "Friend",
  "Other",
];

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
  maxWidth: 440,
  background: "#0d1a30",
  border: "1px solid #1e3a5f",
  borderRadius: 16,
  overflow: "hidden",
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  maxHeight: "90vh",
  overflowY: "auto",
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
  marginBottom: 16,
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

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "#11243d",
  border: "1px solid #1e3a5f",
  borderRadius: 8,
  padding: "10px 12px",
  color: "#eef2f8",
  fontFamily: FONT_SANS,
  fontSize: 13,
  outline: "none",
  marginBottom: 12,
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  fontFamily: FONT_SANS,
  resize: "vertical",
  minHeight: 64,
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
};

const sendBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 0",
  borderRadius: 12,
  border: "none",
  cursor: "pointer",
  background: "linear-gradient(135deg,#00d4b8,#00b89e)",
  color: "#07101f",
  fontFamily: FONT_SANS,
  fontSize: 14,
  fontWeight: 700,
  boxShadow: "0 0 20px rgba(0,212,184,.3)",
};

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
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [relationship, setRelationship] = useState(RELATIONSHIPS[0]);
  const [alertLevel, setAlertLevel] = useState<"critical" | "informational">("informational");
  const [note, setNote] = useState("");

  const reset = useCallback(() => {
    setError("");
    setInvite(null);
    setCopied(false);
  }, []);

  const openModal = useCallback(() => {
    reset();
    setOpen(true);
  }, [reset]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  const send = useCallback(async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
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
        body: JSON.stringify({
          recipient_email: email.trim().toLowerCase(),
          recipient_name: recipientName.trim() || undefined,
          patient_name: patientName,
          personal_note: note.trim() || undefined,
          suggested_relationship: relationship,
          suggested_alert_level: alertLevel,
        }),
        credentials: "same-origin",
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || typeof d?.signup_url !== "string") {
        setError(typeof d?.error === "string" ? d.error : "Could not generate invite.");
        return;
      }
      setInvite(d as InviteResponse);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, email, recipientName, patientName, note, relationship, alertLevel]);

  const copy = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.signup_url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
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

  const onEnterSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !busy) {
      e.preventDefault();
      send();
    }
  };

  const sentSuccessfully = invite && invite.email_sent;

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label="Invite a family member to your Care Circle"
        style={triggerStyle}
      >
        + Invite Family Member
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
                  <div style={titleStyle}>
                    {sentSuccessfully ? "Invite sent" : "Invite created"}
                  </div>
                  {sentSuccessfully ? (
                    <div style={descStyle}>
                      We emailed the signup link to <strong style={{ color: "#eef2f8" }}>{email}</strong>.
                      They will receive a message with the link below. The link is single-use and
                      expires{" "}
                      {new Date(invite.expires_at).toLocaleString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                      .
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: 12,
                        background: "rgba(212,168,67,0.1)",
                        border: "1px solid rgba(212,168,67,0.3)",
                        borderRadius: 8,
                        color: "#d4a843",
                        fontSize: 12,
                        marginBottom: 14,
                        lineHeight: 1.55,
                      }}
                    >
                      Email could not be sent ({invite.email_error || "unknown reason"}). The invite
                      is still valid. Share the link below manually.
                    </div>
                  )}

                  <div style={{ ...labelStyle, marginTop: 8 }}>Backup link</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                    <a
                      id="ciq-invite-url"
                      href={invite.signup_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={urlLinkStyle}
                    >
                      {invite.signup_url}
                    </a>
                    <button type="button" onClick={copy} style={copyBtnStyle}>
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <div
                    style={{
                      marginTop: 14,
                      padding: "11px 13px",
                      background: "rgba(17,36,61,0.4)",
                      border: "1px solid rgba(30,58,95,0.6)",
                      borderRadius: 8,
                    }}
                  >
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
                    <div style={{ fontFamily: FONT_MONO, fontSize: 18, color: "#00d4b8", letterSpacing: ".3em" }}>
                      {invite.code}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div style={titleStyle}>Send a Care Circle invite</div>
                  <div style={descStyle}>
                    Enter the family member&apos;s email. We will send them a link to set up their
                    CareCircle account and start receiving alerts about you. No raw PHI is shared.
                  </div>

                  <label htmlFor="ciq-recipient-email" style={labelStyle}>
                    Their email
                  </label>
                  <input
                    id="ciq-recipient-email"
                    name="recipient_email"
                    type="email"
                    autoComplete="off"
                    placeholder="daughter@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={onEnterSubmit}
                    style={inputStyle}
                  />

                  <label htmlFor="ciq-recipient-name" style={labelStyle}>
                    Their name (optional)
                  </label>
                  <input
                    id="ciq-recipient-name"
                    name="recipient_name"
                    type="text"
                    placeholder="Maria"
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    onKeyDown={onEnterSubmit}
                    style={inputStyle}
                  />

                  <label htmlFor="ciq-relationship" style={labelStyle}>
                    Relationship to you
                  </label>
                  <select
                    id="ciq-relationship"
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value)}
                    style={selectStyle}
                  >
                    {RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>

                  <label style={labelStyle}>Alert level</label>
                  <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                    {(["informational", "critical"] as const).map((lvl) => (
                      <button
                        key={lvl}
                        type="button"
                        onClick={() => setAlertLevel(lvl)}
                        style={{
                          flex: 1,
                          padding: "10px 0",
                          borderRadius: 10,
                          border:
                            alertLevel === lvl ? "1px solid #00d4b8" : "1px solid #1e3a5f",
                          background:
                            alertLevel === lvl ? "rgba(0,212,184,0.12)" : "#11243d",
                          color: alertLevel === lvl ? "#00d4b8" : "#7a9bbf",
                          fontFamily: FONT_SANS,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer",
                          textTransform: "uppercase",
                          letterSpacing: ".1em",
                        }}
                      >
                        {lvl === "critical" ? "Critical only" : "All alerts"}
                      </button>
                    ))}
                  </div>

                  <label htmlFor="ciq-personal-note" style={labelStyle}>
                    Personal note (optional)
                  </label>
                  <textarea
                    id="ciq-personal-note"
                    placeholder="Any short message you want to include in the email."
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    style={textareaStyle}
                    rows={3}
                  />

                  {error && (
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
                      {error}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={send}
                    disabled={busy}
                    style={{
                      ...sendBtnStyle,
                      opacity: busy ? 0.6 : 1,
                      cursor: busy ? "not-allowed" : "pointer",
                    }}
                  >
                    {busy ? "Sending..." : "Send Invite"}
                  </button>
                </>
              )}

              <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
                <button type="button" onClick={close} style={closeBtnStyle}>
                  {invite ? "Done" : "Cancel"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
