import { isClientEncEnabled } from "@/lib/e2e/flag";
import SetupForm from "./SetupForm";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };

export default function ClinicSetupPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">Set up your clinic</h1>
      <p className="mt-3 mb-4 text-sm text-ink-soft">This one-time link creates your clinic and makes you its first admin. It works once and expires.</p>
      <SetupForm encEnabled={isClientEncEnabled()} />
    </main>
  );
}
