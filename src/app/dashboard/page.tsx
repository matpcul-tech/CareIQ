import { isAiEnabled } from "@/lib/ai-flag";
import { resolveLabs } from "@/lib/lab-values";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readSession } from "@/lib/session";
import { getServiceClient } from "@/lib/supabase-server";
import { decryptJson } from "@/lib/crypto";
import { logAudit } from "@/lib/audit";
import HealthChart from "./HealthChart";
import InsightButton from "./InsightButton";
import InviteFamilyModal from "@/components/InviteFamilyModal";
import LabFilesCard from "./LabFilesCard";
import { SafetyDisclaimer, SyncSourceList } from "@/components/SyncStatus";
import { loadSyncSources } from "@/lib/sync-sources-server";
import type { SyncSource } from "@/lib/sync-status";

export const dynamic = "force-dynamic";

interface ProfilePlaintext {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  communityAffiliation?: string;
  sex?: "male" | "female";
}

interface ManualLabs {
  a1c?: number;
  ldl?: number;
  hdl?: number;
  fastingGlucose?: number;
  bpSystolic?: number;
  bpDiastolic?: number;
  triglycerides?: number;
  egfr?: number;
  tsh?: number;
  vitaminD?: number;
}

interface HistoryPlaintext {
  chronicConditions?: string[];
  medications?: string;
  allergies?: string;
  familyHistory?: string;
  manualLabs?: ManualLabs;
  biomarkers?: Record<string, unknown>;
}

interface DailyMetric {
  date: string;
  heartRate?: number;
  steps?: number;
  sleepHours?: number;
  spo2?: number;
  calories?: number;
}

export default async function DashboardPage() {
  const session = readSession();
  if (!session.patientId) {
    redirect("/onboard");
  }

  const sb = getServiceClient();

  const { data: pat } = await sb
    .from("patients")
    .select("profile_encrypted, created_at")
    .eq("id", session.patientId)
    .maybeSingle();

  let profile: ProfilePlaintext | null = null;
  if (pat?.profile_encrypted) {
    try {
      profile = decryptJson<ProfilePlaintext>(
        pat.profile_encrypted,
        `profile:${session.patientId}`,
      );
    } catch {
      profile = null;
    }
  }

  const { data: hh } = await sb
    .from("health_history")
    .select("data_encrypted, updated_at")
    .eq("patient_id", session.patientId)
    .maybeSingle();
  let history: HistoryPlaintext | null = null;
  if (hh?.data_encrypted) {
    try {
      history = decryptJson<HistoryPlaintext>(
        hh.data_encrypted,
        `history:${session.patientId}`,
      );
    } catch {
      history = null;
    }
  }

  const manualLabs: ManualLabs = resolveLabs(history);

  let syncSources: SyncSource[] = [];
  try {
    syncSources = await loadSyncSources(
      sb,
      session.patientId,
      (hh as { updated_at?: string } | null)?.updated_at ?? null,
    );
  } catch {
    syncSources = [];
  }

  const { data: labRows } = await sb
    .from("lab_files")
    .select("id, file_type, uploaded_at")
    .eq("patient_id", session.patientId)
    .order("uploaded_at", { ascending: false })
    .limit(20);
  const labFiles = (labRows ?? []).map((r) => ({
    id: String(r.id),
    file_type: String(r.file_type),
    uploaded_at: String(r.uploaded_at),
  }));

  const { data: wd } = await sb
    .from("wearable_data")
    .select("data_encrypted, device_type, uploaded_at")
    .eq("patient_id", session.patientId)
    .order("uploaded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let metrics: DailyMetric[] = [];
  let deviceType = "";
  if (wd?.data_encrypted) {
    try {
      const parsed = decryptJson<{
        device: string;
        metrics: DailyMetric[];
      }>(wd.data_encrypted, `wearable:${session.patientId}`);
      deviceType = parsed.device;
      metrics = (parsed.metrics || []).slice(-7);
    } catch {
      metrics = [];
    }
  }

  await logAudit({
    sessionId: session.sessionId,
    action: "patient.profile.read",
    dataType: "profile",
    success: true,
  });

  return (
    <main className="px-4 py-8 sm:py-12">
      <header className="mx-auto mb-6 flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-mute">
            CareIQ
          </div>
          <div className="text-sm text-ink-soft">
            {profile?.firstName ? `Welcome, ${normalize(profile.firstName)}` : "Welcome"}
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <InviteFamilyModal patientName={profile?.firstName} />
          <Link
            href="/clinical"
            className="btn-primary inline-flex items-center justify-center gap-2 self-start text-sm sm:self-auto"
          >
            View My Health Intelligence
          </Link>
        </div>
      </header>

      <section className="mx-auto grid max-w-5xl grid-cols-1 gap-4 md:grid-cols-2">
        <Link
          href="/onboard?step=2&edit=1"
          aria-label={profile ? "Edit profile" : "Complete profile"}
          className="card group block cursor-pointer transition hover:ring-2 hover:ring-ink/20 focus:outline-none focus:ring-2 focus:ring-ink/40"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Profile</h2>
            <span className="text-xs font-semibold text-ink-mute group-hover:text-ink">
              {profile ? "Edit" : "Complete"}
            </span>
          </div>
          {profile ? (
            <ul className="flex flex-col gap-2 text-sm">
              <Row k="Name" v={normalize((profile.firstName || "") + " " + (profile.lastName || ""))} />
              <Row k="Date of birth" v={profile.dateOfBirth ? maskDob(profile.dateOfBirth) : "-"} />
              <Row
                k="Community affiliation"
                v={profile.communityAffiliation ? normalize(profile.communityAffiliation) : "Not provided"}
              />
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">Complete your profile in onboarding.</p>
          )}
        </Link>

        <Link
          href="/onboard?step=3&edit=1"
          aria-label={history ? "Edit health history" : "Add health history"}
          className="card group block cursor-pointer transition hover:ring-2 hover:ring-ink/20 focus:outline-none focus:ring-2 focus:ring-ink/40"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Health history</h2>
            <span className="text-xs font-semibold text-ink-mute group-hover:text-ink">
              {history ? "Edit" : "Add"}
            </span>
          </div>
          {history ? (
            <ul className="flex flex-col gap-2 text-sm">
              <Row
                k="Chronic conditions"
                v={
                  history.chronicConditions && history.chronicConditions.length
                    ? history.chronicConditions.map(humanCondition).join(", ")
                    : "None recorded"
                }
              />
              <Row k="Medications" v={history.medications ? "On file" : "None recorded"} />
              <Row k="Allergies" v={history.allergies ? "On file" : "None recorded"} />
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">No health history yet.</p>
          )}
        </Link>

        <Link
          href="/onboard?step=4&edit=1"
          aria-label={Object.keys(manualLabs).length > 0 ? "Edit your labs" : "Add your labs"}
          className="card group block cursor-pointer transition hover:ring-2 hover:ring-ink/20 focus:outline-none focus:ring-2 focus:ring-ink/40 md:col-span-2"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Your labs (entered manually)</h2>
            <span className="text-xs font-semibold text-ink-mute group-hover:text-ink">
              {Object.keys(manualLabs).length > 0 ? "Edit" : "Add"}
            </span>
          </div>
          {Object.keys(manualLabs).length > 0 ? (
            <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {manualLabs.bpSystolic != null && manualLabs.bpDiastolic != null && (
                <LabRow label="Blood Pressure" value={`${manualLabs.bpSystolic}/${manualLabs.bpDiastolic} mmHg`} />
              )}
              {manualLabs.a1c != null && (
                <LabRow label="A1C" value={`${manualLabs.a1c.toFixed(1)} %`} />
              )}
              {manualLabs.fastingGlucose != null && (
                <LabRow label="Fasting Glucose" value={`${Math.round(manualLabs.fastingGlucose)} mg/dL`} />
              )}
              {manualLabs.ldl != null && (
                <LabRow label="LDL" value={`${Math.round(manualLabs.ldl)} mg/dL`} />
              )}
              {manualLabs.hdl != null && (
                <LabRow label="HDL" value={`${Math.round(manualLabs.hdl)} mg/dL`} />
              )}
              {manualLabs.triglycerides != null && (
                <LabRow label="Triglycerides" value={`${Math.round(manualLabs.triglycerides)} mg/dL`} />
              )}
              {manualLabs.egfr != null && (
                <LabRow label="eGFR" value={`${Math.round(manualLabs.egfr)} mL/min`} />
              )}
            </ul>
          ) : (
            <p className="text-sm text-ink-mute">
              No values entered yet. Tap to type in any labs you already know (A1C, LDL, HDL, BP, etc.).
            </p>
          )}
        </Link>

        <Link
          href="/connect-device"
          aria-label="Connect a wearable device"
          className="card group block cursor-pointer transition hover:ring-2 hover:ring-ink/20 focus:outline-none focus:ring-2 focus:ring-ink/40 md:col-span-2"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-bold">Wearable signal: last 7 days</h2>
            <span className="text-xs font-semibold text-ink-mute group-hover:text-ink">
              {metrics.length > 0 ? "Connect another" : "Connect a device"}
            </span>
          </div>
          {metrics.length > 0 ? (
            <HealthChart metrics={metrics} deviceType={deviceType} />
          ) : (
            <p className="text-sm text-ink-mute">No wearable data uploaded yet.</p>
          )}
        </Link>

        <div className="card md:col-span-2">
          <h2 className="mb-3 text-base font-bold">Last synced by source</h2>
          <SyncSourceList sources={syncSources} theme="light" />
          <SafetyDisclaimer theme="light" />
        </div>

        <LabFilesCard files={labFiles} />

        <div className="card md:col-span-2">
          <h2 className="mb-3 text-base font-bold">Local health note</h2>
          <p className="text-sm text-ink-mute">
            This note is built from labs and recorded conditions already on the page. It does not call a model.
          </p>
          <InsightButton
            aiEnabled={isAiEnabled()}
            facts={{
              labs: manualLabs,
              sex: profile?.sex === "male" || profile?.sex === "female" ? profile.sex : "unknown",
              conditions: history?.chronicConditions ?? [],
            }}
          />
        </div>
      </section>

      <footer className="mx-auto mt-6 max-w-5xl text-center text-xs text-ink-mute">
        Sovereign Shield Technologies LLC &middot; All access logged &middot; AES-256-GCM at rest
      </footer>
    </main>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
      <span className="font-semibold text-ink-mute sm:w-40">{k}</span>
      <span className="text-ink">{v}</span>
    </li>
  );
}

function LabRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 rounded-lg border border-sov-border/60 bg-sov-card/40 px-3 py-2">
      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-mute">{label}</span>
      <span className="font-mono text-sm text-ink">{value}</span>
    </li>
  );
}

function humanCondition(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function maskDob(dob: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return "On file";
  return `${m[1]}-XX-XX`;
}

function normalize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
