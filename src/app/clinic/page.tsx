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
        CMS165 and CMS122 figures are estimates, not validated measures. Reading days and care management minutes are tracking only, not claims submission. Text delivery is skipped when SMS is not configured. Any AI summary is masked before it is sent.
      </p>
      <ClinicPanel />
    </main>
  );
}
