import Link from "next/link";
import UdsPanel from "./UdsPanel";

export const dynamic = "force-dynamic";

export default function UdsPanelPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">UDS patient panel</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        CMS165 Controlling High Blood Pressure and CMS122 Diabetes HbA1c Poor Control (over 9%) for your clinic panel.
        Clinic staff only. Logic tested against the measure specs, not certified eCQM software.
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        <Link href="/clinic">Back to the care team circle</Link>
      </p>
      <UdsPanel />
    </main>
  );
}
