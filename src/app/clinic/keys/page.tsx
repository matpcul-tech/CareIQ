import { notFound } from "next/navigation";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import ClinicKeySetup from "./ClinicKeySetup";

export const dynamic = "force-dynamic";
export const metadata = { referrer: "no-referrer" };

export default function ClinicKeysPage() {
  if (!isClientEncEnabled()) notFound();
  return (
    <main className="mx-auto max-w-xl px-4 py-6 text-ink">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-mute">CareIQ clinic</p>
      <h1 className="mt-2 text-2xl font-bold">Clinic encryption key</h1>
      <p className="mt-3 mb-4 text-sm text-ink-soft">
        Your clinic key is made on this device. CareIQ stores only locked copies of it and cannot open them.
      </p>
      <ClinicKeySetup />
    </main>
  );
}
