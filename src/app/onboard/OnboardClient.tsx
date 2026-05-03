"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const CONDITIONS = [
  { value: "diabetes", label: "Diabetes" },
  { value: "hypertension", label: "Hypertension" },
  { value: "heart_disease", label: "Heart disease" },
  { value: "obesity", label: "Obesity" },
  { value: "asthma", label: "Asthma" },
  { value: "kidney_disease", label: "Kidney disease" },
  { value: "cancer", label: "Cancer" },
  { value: "other", label: "Other" },
] as const;

const DEVICES = [
  { name: "Fitbit", summary: "Account, then Settings, then Data Export, then request archive (JSON)." },
  { name: "Apple Watch", summary: "Health app, profile, then Export All Health Data (export.xml inside zip)." },
  { name: "Garmin", summary: "Garmin Connect, Account Management, then Export Your Data (CSV)." },
  { name: "Samsung Health", summary: "Samsung Health app, Settings, then Download personal data (CSV)." },
  { name: "Google Fit", summary: "Google Takeout, select Fit, then Export (JSON)." },
];

const MAGIC_COOLDOWN_SECONDS = 60;
const MAGIC_COOLDOWN_STORAGE_KEY = "sov_magic_last_send_at";

function getCsrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)sov_csrf=([^;]+)/);
  if (!m) return "";
  return decodeURIComponent(m[1]).split(".")[0];
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": getCsrfToken(),
    },
    body: JSON.stringify(body),
    credentials: "same-origin",
  });
}

async function postForm(path: string, form: FormData): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { "x-csrf-token": getCsrfToken() },
    body: form,
    credentials: "same-origin",
  });
}

export default function OnboardClient(props: {
  initialStep: number;
  authenticated: boolean;
  expired: boolean;
  linkError: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<number>(props.initialStep);
  const [banner, setBanner] = useState<string>(() => {
    if (props.expired) return "Your session timed out. Please sign in again.";
    if (props.linkError) return "That sign-in link is invalid or expired.";
    return "";
  });

  return (
    <main className="px-4 py-8 sm:py-12">
      <header className="mx-auto mb-6 flex max-w-2xl items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl text-base"
            style={{ background: "linear-gradient(135deg, #00d4b8, #8060cc)" }}
          >
            +
          </span>
          <div className="flex flex-col leading-tight text-left">
            <span className="font-display text-base font-bold text-ink">CareIQ</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-sov-teal">
              Encrypted Patient Onboarding
            </span>
          </div>
        </div>
        <div className="zk-shield-pill" aria-label="Zero-knowledge shield active">
          <span className="zk-shield-dot" aria-hidden /> ZK SHIELD ON
        </div>
      </header>

      <Stepper step={step} />

      {banner && (
        <div className="alert-warn mx-auto mt-4 max-w-2xl">{banner}</div>
      )}

      <section className="mx-auto mt-6 max-w-2xl card sm:p-7">
        {step === 1 && <Step1Email />}
        {step === 2 && (
          <Step2Profile authenticated={props.authenticated} onDone={() => setStep(3)} />
        )}
        {step === 3 && (
          <Step3History authenticated={props.authenticated} onDone={() => setStep(4)} />
        )}
        {step === 4 && (
          <Step4Upload
            authenticated={props.authenticated}
            onDone={() => router.push("/dashboard")}
          />
        )}
      </section>

      <footer className="mx-auto mt-6 max-w-2xl text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.18em] text-ink-mute">
        <div>AES-256-GCM encrypted &middot; Sovereign infrastructure</div>
      </footer>
    </main>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["Email", "Profile", "Health history", "Data upload"];
  const total = labels.length;
  const pct = Math.max(0, Math.min(100, ((step - 1) / (total - 1)) * 100));
  return (
    <div className="mx-auto max-w-2xl">
      <ol className="flex items-start justify-between gap-2 px-2">
        {labels.map((label, i) => {
          const idx = i + 1;
          const active = idx === step;
          const done = idx < step;
          const pillClasses = [
            "step-pill",
            active ? "step-pill-on" : done ? "step-pill-done" : "",
          ].filter(Boolean).join(" ");
          const labelClasses = [
            "mt-1.5 text-center text-[10px] font-mono uppercase tracking-[0.14em]",
            active ? "text-sov-gold" : done ? "text-ink-soft" : "text-ink-mute",
          ].join(" ");
          return (
            <li key={label} className="flex flex-1 flex-col items-center">
              <span className={pillClasses} aria-current={active ? "step" : undefined}>
                {idx}
              </span>
              <span className={labelClasses}>{label}</span>
            </li>
          );
        })}
      </ol>
      <div className="mt-4 px-2">
        <div className="progress-track" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] uppercase tracking-[0.18em] text-ink-mute">
          <span>Step {step} of {total}</span>
          <span>{Math.round(pct)}%</span>
        </div>
      </div>
    </div>
  );
}

function formatCooldown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

function readStoredCooldown(): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = window.localStorage.getItem(MAGIC_COOLDOWN_STORAGE_KEY);
    const last = Number(raw || "");
    if (!Number.isFinite(last) || last <= 0) return 0;
    const elapsed = Math.floor((Date.now() - last) / 1000);
    const remaining = MAGIC_COOLDOWN_SECONDS - elapsed;
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function writeCooldownStart() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MAGIC_COOLDOWN_STORAGE_KEY, String(Date.now()));
  } catch {
    // ignore quota / privacy mode errors; UI cooldown still applies in-memory
  }
}

function Step1Email() {
  const [email, setEmail] = useState("");
  const [sentEmail, setSentEmail] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    const remaining = readStoredCooldown();
    if (remaining > 0) {
      setCooldown(remaining);
      setSentEmail((prev) => prev || "your email");
    }
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setInterval(() => {
      setCooldown((c) => {
        const next = c - 1;
        if (next <= 0) {
          window.clearInterval(id);
          return 0;
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [cooldown]);

  async function send(targetEmail: string) {
    if (busy) return;
    if (cooldown > 0) return;
    setBusy(true);
    setError("");
    try {
      const res = await postJson("/api/auth/magic-link", { email: targetEmail });
      if (!res.ok) {
        setError("Unable to send link. Please wait a moment and try again.");
      } else {
        setSentEmail(targetEmail);
        writeCooldownStart();
        setCooldown(MAGIC_COOLDOWN_SECONDS);
      }
    } catch {
      setError("Unable to send link. Please wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email) return;
    send(email);
  }

  function onResend() {
    const target = email || sentEmail;
    if (!target || target === "your email") {
      setError("Please re-enter your email to resend.");
      return;
    }
    send(target);
  }

  const inCooldown = cooldown > 0;
  const sendDisabled = busy || !email || inCooldown;

  if (!sentEmail && !inCooldown) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
        <h1 className="text-2xl font-bold">Welcome</h1>
        <p className="text-ink-soft">
          Enter your email to receive a one-time sign-in link. We never store passwords.
        </p>
        <label htmlFor="email" className="field-label">Email</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field-input"
          placeholder="you@example.com"
        />
        <button type="submit" disabled={sendDisabled} className="btn-primary mt-2">
          {busy ? "Sending..." : "Send sign-in link"}
        </button>
        {error && <div className="alert-error">{error}</div>}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Check your email</h1>
      <p className="text-ink-soft">
        We sent a sign-in link to{" "}
        <span className="font-semibold text-ink">{sentEmail}</span>.
      </p>
      <div className="alert-success">
        Check your email. If you don&rsquo;t see it, check your spam folder. Please
        wait 60 seconds before requesting another link.
      </div>

      {inCooldown ? (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-ink-soft"
          aria-live="polite"
        >
          Resend available in <span className="font-mono font-semibold text-ink">{formatCooldown(cooldown)}</span>
        </div>
      ) : (
        <button type="button" onClick={onResend} disabled={busy} className="btn-secondary">
          {busy ? "Sending..." : "Resend link"}
        </button>
      )}

      <details className="mt-1 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-semibold text-ink">
          Use a different email
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <label className="field-label" htmlFor="email-alt">Email</label>
          <input
            id="email-alt"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="field-input"
            placeholder="you@example.com"
          />
          <button
            type="button"
            onClick={() => send(email)}
            disabled={!email || busy || inCooldown}
            className="btn-primary"
          >
            {busy ? "Sending..." : "Send to this email"}
          </button>
        </div>
      </details>

      {error && <div className="alert-error">{error}</div>}
    </div>
  );
}

function Step2Profile({
  authenticated,
  onDone,
}: {
  authenticated: boolean;
  onDone: () => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dob, setDob] = useState("");
  const [community, setCommunity] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!authenticated) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-ink-soft">Please complete the email step to continue.</p>
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await postJson("/api/onboard/profile", {
        firstName,
        lastName,
        dateOfBirth: dob,
        communityAffiliation: community || undefined,
      });
      if (!res.ok) {
        setErr("Could not save your profile. Please review your entries.");
      } else {
        onDone();
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Your profile</h1>
      <p className="text-ink-soft">
        Encrypted on the server before storage. Community affiliation is optional and never required.
      </p>
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[180px]">
          <label className="field-label">First name</label>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={80}
            className="field-input"
          />
        </div>
        <div className="flex-1 min-w-[180px]">
          <label className="field-label">Last name</label>
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
            maxLength={80}
            className="field-input"
          />
        </div>
      </div>
      <label className="field-label">Date of birth</label>
      <input
        type="date"
        value={dob}
        onChange={(e) => setDob(e.target.value)}
        required
        className="field-input"
      />
      <label className="field-label">Community affiliation (optional)</label>
      <input
        value={community}
        onChange={(e) => setCommunity(e.target.value)}
        maxLength={120}
        className="field-input"
        placeholder="Health center, neighborhood, or community group (optional)"
      />
      <button type="submit" disabled={busy} className="btn-primary mt-2">
        {busy ? "Saving..." : "Continue"}
      </button>
      {err && <div className="alert-error">{err}</div>}
    </form>
  );
}

function Step3History({
  authenticated,
  onDone,
}: {
  authenticated: boolean;
  onDone: () => void;
}) {
  const [conditions, setConditions] = useState<Set<string>>(new Set());
  const [meds, setMeds] = useState("");
  const [allergies, setAllergies] = useState("");
  const [family, setFamily] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!authenticated) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-ink-soft">Please complete the email step to continue.</p>
      </div>
    );
  }

  function toggle(value: string) {
    setConditions((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await postJson("/api/onboard/health-history", {
        chronicConditions: Array.from(conditions),
        medications: meds,
        allergies,
        familyHistory: family,
      });
      if (!res.ok) {
        setErr("Could not save your health history. Please try again.");
      } else {
        onDone();
      }
    } catch {
      setErr("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Health history</h1>
      <p className="text-ink-soft">This stays encrypted at rest. You can edit or delete anytime.</p>

      <fieldset className="rounded-xl border border-slate-200 p-4">
        <legend className="px-1 text-xs font-semibold text-ink-soft">Chronic conditions</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {CONDITIONS.map((c) => (
            <label key={c.value} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={conditions.has(c.value)}
                onChange={() => toggle(c.value)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-500"
              />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="field-label">Current medications</label>
      <textarea
        value={meds}
        onChange={(e) => setMeds(e.target.value)}
        maxLength={2000}
        rows={3}
        className="field-textarea"
      />

      <label className="field-label">Allergies</label>
      <textarea
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
        maxLength={2000}
        rows={2}
        className="field-textarea"
      />

      <label className="field-label">Family history</label>
      <textarea
        value={family}
        onChange={(e) => setFamily(e.target.value)}
        maxLength={2000}
        rows={3}
        className="field-textarea"
      />

      <button type="submit" disabled={busy} className="btn-primary mt-2">
        {busy ? "Saving..." : "Continue"}
      </button>
      {err && <div className="alert-error">{err}</div>}
    </form>
  );
}

function Step4Upload({
  authenticated,
  onDone,
}: {
  authenticated: boolean;
  onDone: () => void;
}) {
  const [labStatus, setLabStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [wearableStatus, setWearableStatus] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState<"lab" | "wearable" | null>(null);

  if (!authenticated) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Sign in required</h1>
        <p className="mt-2 text-ink-soft">Please complete the email step to continue.</p>
      </div>
    );
  }

  async function upload(zone: "lab" | "wearable", file: File) {
    if (file.size > 10 * 1024 * 1024) {
      const msg = "File exceeds 10MB limit.";
      if (zone === "lab") setLabStatus({ ok: false, message: msg });
      else setWearableStatus({ ok: false, message: msg });
      return;
    }
    setBusy(zone);
    const fd = new FormData();
    fd.set("zone", zone);
    fd.set("file", file);
    try {
      const res = await postForm("/api/onboard/upload", fd);
      if (!res.ok) {
        const message = "Upload was rejected. Please confirm the file format.";
        if (zone === "lab") setLabStatus({ ok: false, message });
        else setWearableStatus({ ok: false, message });
      } else {
        const data = await res.json().catch(() => ({}));
        if (zone === "lab") {
          setLabStatus({ ok: true, message: "Lab file uploaded and encrypted." });
        } else {
          const detail =
            typeof data?.metrics === "number" ? ` ${data.metrics} day(s) parsed.` : "";
          setWearableStatus({ ok: true, message: `Wearable export ingested.${detail}` });
        }
      }
    } catch {
      const message = "Network error during upload.";
      if (zone === "lab") setLabStatus({ ok: false, message });
      else setWearableStatus({ ok: false, message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Upload your data (optional)</h1>
      <p className="text-ink-soft">
        Files are scanned, stripped of metadata, encrypted, and stored on sovereign infrastructure.
        You can skip this step now and upload later from the dashboard.
      </p>

      <div className="rounded-xl border border-dashed border-slate-400 bg-slate-50 p-4">
        <div className="font-bold">Zone A: Lab results (optional)</div>
        <div className="mb-2 text-sm text-ink-soft">PDF, PNG, JPG, or HEIC. 10MB max.</div>
        <input
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.heic"
          disabled={busy === "lab"}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-sov-gold file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sov-bg hover:file:bg-sov-goldDark"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload("lab", f);
          }}
        />
        {labStatus && (
          <div className={`mt-2 ${labStatus.ok ? "alert-success" : "alert-error"}`}>
            {labStatus.message}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-dashed border-slate-400 bg-slate-50 p-4">
        <div className="font-bold">Zone B: Wearable export (optional)</div>
        <div className="mb-2 text-sm text-ink-soft">
          CSV, JSON, or XML from any device. The raw file is parsed and discarded; only key
          metrics are encrypted and stored.
        </div>
        <input
          type="file"
          accept=".csv,.json,.xml"
          disabled={busy === "wearable"}
          className="block w-full text-sm text-ink file:mr-3 file:rounded-lg file:border-0 file:bg-sov-gold file:px-3 file:py-2 file:text-sm file:font-semibold file:text-sov-bg hover:file:bg-sov-goldDark"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload("wearable", f);
          }}
        />
        {wearableStatus && (
          <div className={`mt-2 ${wearableStatus.ok ? "alert-success" : "alert-error"}`}>
            {wearableStatus.message}
          </div>
        )}
      </div>

      <details className="mt-1 rounded-xl border border-slate-200 bg-white p-3 open:p-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink">
          Supported devices and how to export
        </summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink">
          {DEVICES.map((d) => (
            <li key={d.name}>
              <strong>{d.name}:</strong> {d.summary}
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <a href="/connect-device" className="text-sov-link">
            Full export instructions
          </a>
        </div>
      </details>

      <button
        type="button"
        onClick={onDone}
        disabled={busy !== null}
        className="btn-primary mt-2"
      >
        {busy ? "Uploading..." : "Continue to dashboard"}
      </button>
    </div>
  );
}
