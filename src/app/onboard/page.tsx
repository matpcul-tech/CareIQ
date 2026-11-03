import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import OnboardClient from "./OnboardClient";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import { loadSavedHistory } from "@/lib/history-read";

export const dynamic = "force-dynamic";

/**
 * /onboard
 *
 * Authenticated visitors are bounced to /dashboard UNLESS they arrive
 * with ?edit=1 (the entrypoint used by dashboard cards to complete or
 * edit profile / health history). The form is otherwise only shown to
 * unauthenticated users.
 *
 * Reachable as the form when:
 *   - First visit, no auth cookie at all
 *   - Auth itself failed (?error=auth_failed)
 *   - Session expired (?expired=1)
 *   - Authenticated user clicked an edit card on /dashboard (?edit=1)
 */
export default async function OnboardPage({
  searchParams,
}: {
  searchParams?: {
    step?: string;
    expired?: string;
    error?: string;
    edit?: string;
  };
}) {
  const session = readSession();
  const editMode = searchParams?.edit === "1";

  if (session.patientId && !editMode) {
    redirect("/dashboard");
  }

  const requestedStep = Number(searchParams?.step || "");
  const stepFromUrl =
    Number.isFinite(requestedStep) && requestedStep >= 1 && requestedStep <= 4
      ? requestedStep
      : null;

  // Authenticated edit flow defaults to step 2 (the first post-email step).
  // Anonymous flow defaults to step 1 (email entry).
  const initialStep =
    stepFromUrl ?? (session.patientId && editMode ? 2 : 1);

  // Decrypted on the server for the signed-in patient only, so the form opens with saved answers.
  const savedHistory = session.patientId ? await loadSavedHistory(session.patientId) : null;

  return (
    <OnboardClient
      savedHistory={savedHistory}
      encEnabled={isClientEncEnabled()}
      initialStep={initialStep}
      authenticated={Boolean(session.patientId)}
      expired={searchParams?.expired === "1"}
      linkError={Boolean(searchParams?.error)}
    />
  );
}
