import JoinForm from "./JoinForm";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };

export default function ClinicJoinPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">Join your clinic team</h1>
      <p className="mt-3 mb-4 text-sm text-ink-soft">This invite link works once and expires 7 days after your admin made it.</p>
      <JoinForm />
    </main>
  );
}
