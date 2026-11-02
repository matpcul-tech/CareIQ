import Link from "next/link";
import { redirect } from "next/navigation";
import ClinicPanel from "./ClinicPanel";

export const dynamic = "force-dynamic";

export default function ClinicPage({ searchParams }: { searchParams?: { demo?: string } }) {
  if (searchParams?.demo === "1") redirect("/demo");
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">Care team circle</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Patients and caregivers send home blood pressure, glucose, missed medication or appointment check-ins, and short concerns to this clinic. Provider, MA, and CHW roles share that circle. Only the patient or an admin can add or revoke members.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        The scorecard shows an estimated rate, the gap to the clinic target, and the patients who would close that gap. Cancer screening, falls screening, a missed wellness check-in, and high caregiver strain show up on that same list. Built-in targets are examples until a provider sets the clinic target. P4P and RPM dollar amounts are examples, not a cited fee schedule, and 99470 is unconfirmed. CCM and APCM time is tracked only, with no dollar estimate. Nothing here is a validated measure or a claim.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        <Link href="/demo">Open the sample clinic</Link> for a fictional rural panel. No sign-in.
      </p>
      <ClinicPanel />
    </main>
  );
}
