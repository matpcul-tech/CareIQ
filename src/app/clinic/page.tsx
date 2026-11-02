import ClinicPanel from "./ClinicPanel";

export const dynamic = "force-dynamic";

export default function ClinicPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">Care team circle</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Patients and caregivers send home blood pressure, glucose, missed medication or appointment check-ins, and short concerns to this clinic. Provider, MA, and CHW roles share that circle. Only the patient or an admin can add or revoke members.
      </p>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        The scorecard shows an estimated rate, the gap to the clinic target, and the patients who would close that gap. Defaults come from the public scorecard. CMS2 and CMS159 have no default percent there, so those targets stay blank until a provider sets them. P4P dollars and RPM dollars are estimates. CCM and APCM time is tracked only, with no dollar estimate. Nothing here is a validated measure or a claim.
      </p>
      <ClinicPanel />
    </main>
  );
}
