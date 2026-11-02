import Link from "next/link";
import { readSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default function Home() {
  const session = readSession();
  const primaryHref = session.patientId ? "/dashboard" : "/onboard";
  const primaryLabel = session.patientId ? "Open Dashboard" : "Begin Onboarding";

  return (
    <main className="relative flex min-h-screen flex-col bg-sov-bg text-ink">
      {/* Top bar: wordmark + ZK Shield indicator (always visible) */}
      <header className="relative z-10 mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-6 sm:pt-8">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid h-9 w-9 place-items-center rounded-xl text-lg"
            style={{ background: "linear-gradient(135deg, #14b8a6, #2dd4bf)", color: "#042f2a" }}
          >
            +
          </span>
          <div className="flex flex-col leading-tight">
            <span className="font-display text-base font-bold text-ink">CareIQ</span>
            <span className="font-mono text-[8px] uppercase tracking-[0.22em] text-sov-teal">
              Sovereign Shield Technologies LLC
            </span>
          </div>
        </div>
        <div className="zk-shield-pill" aria-label="Prompt Shield active">
          <span className="zk-shield-dot" aria-hidden /> SHIELD ON
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-8 px-6 py-12 text-center sm:py-20">
        <span className="font-mono text-[10px] uppercase tracking-[0.4em] text-sov-gold">
          Clinical Intelligence for the Safety Net
        </span>
        <h1
          className="font-display text-5xl font-extrabold leading-[1.05] tracking-tight text-sov-gold sm:text-6xl md:text-7xl"
          style={{ textShadow: "0 0 28px rgba(20,184,166,0.18)" }}
        >
          CARE
          <br />
          IQ
        </h1>
        <p className="max-w-xl font-display text-2xl leading-snug text-ink sm:text-3xl">
          Clinical intelligence for the safety net.
        </p>
        <p className="max-w-xl text-base leading-relaxed text-ink-soft sm:text-lg">
          Built for community health centers and FQHCs. Records are encrypted
          at rest with AES-256-GCM on the application server. AI insights use
          a reduced summary, and critical identifier queries are blocked before
          any model call.
        </p>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:gap-4">
          <Link href={primaryHref} className="btn-primary no-underline w-56 sm:w-auto">
            {primaryLabel}
          </Link>
          <Link href="/onboard" className="btn-secondary no-underline w-56 sm:w-auto">
            Sign In
          </Link>
        </div>
        <Link href="/demo" className="text-sm text-sov-link">
          Clinic demo with fictional patients
        </Link>

        {/* Three trust pills */}
        <div className="grid w-full max-w-3xl grid-cols-1 gap-3 pt-6 sm:grid-cols-3">
          {[
            { label: "AES-256-GCM", sub: "encrypted at rest on the server" },
            { label: "Append-only", sub: "audit log" },
            { label: "Prompt Shield", sub: "blocks critical identifier queries" },
          ].map((p) => (
            <div
              key={p.label}
              className="rounded-xl border border-sov-border bg-sov-card/60 px-4 py-3 text-left"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-sov-teal">
                {p.sub}
              </div>
              <div className="mt-1 font-display text-lg font-semibold text-ink">{p.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 mx-auto w-full max-w-5xl px-6 pb-8">
        <div className="rounded-xl border border-sov-border bg-sov-card/40 p-4 text-center">
          <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">
            AES-256-GCM at rest on the server &middot; Append-only audit log &middot; Prompt Shield
          </div>
          <div className="mt-2 text-[11px] text-ink-mute">
            (c) Sovereign Shield Technologies LLC
          </div>
        </div>
      </footer>
    </main>
  );
}
