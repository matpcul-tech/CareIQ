import Link from "next/link";
import WearableUpload from "@/components/WearableUpload";
import { SafetyDisclaimer } from "@/components/SyncStatus";
import { isWithingsEnabled } from "@/lib/withings/flag";

export const dynamic = "force-static";
export const revalidate = false;

interface Device {
  name: string;
  format: string;
  steps: string[];
}

const DEVICES: Device[] = [
  {
    name: "Fitbit",
    format: "JSON archive",
    steps: [
      "Open fitbit.com on a desktop browser and sign in.",
      "Go to Settings, then Data Export.",
      "Click Request Data, and confirm via the email Fitbit sends you.",
      "Download the archive when ready, then unzip it on your computer.",
      "Upload the zip, or the largest .json file inside it, on this page.",
    ],
  },
  {
    name: "Apple Watch",
    format: "export.xml",
    steps: [
      "On your iPhone, open the Health app.",
      "Tap your profile picture in the top right.",
      "Scroll down and tap Export All Health Data.",
      "Wait for the export.zip to be prepared, then save it to Files.",
      "Upload the zip on this page. CareIQ reads export.xml on this device.",
    ],
  },
  {
    name: "Garmin",
    format: "CSV",
    steps: [
      "Open Garmin Connect on a desktop browser and sign in.",
      "Go to Account Management, then Manage My Data.",
      "Choose Export Your Data and download the archive.",
      "Upload the zip, a FIT file, or a wellness CSV on this page.",
    ],
  },
  {
    name: "Samsung Health",
    format: "CSV",
    steps: [
      "Open the Samsung Health app on your phone.",
      "Tap the menu, then Settings.",
      "Tap Download personal data.",
      "Confirm the download and locate the resulting CSV file.",
      "Upload the CSV file on this page. If the columns are unfamiliar, match them before saving.",
    ],
  },
  {
    name: "Google Fit",
    format: "JSON via Google Takeout",
    steps: [
      "Visit takeout.google.com on a desktop browser.",
      "Click Deselect all, then check only Fit.",
      "Choose JSON as the export format and create the export.",
      "Download the archive when Google emails you, and unzip it.",
      "Upload the zip or the daily summary JSON on this page.",
    ],
  },
];

export default function ConnectDevicePage() {
  return (
    <main className="px-4 py-8 sm:py-12">
      <header className="mx-auto mb-6 max-w-3xl">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-ink-mute">
          CareIQ
        </div>
        <h1 className="mt-2 text-2xl font-bold sm:text-3xl">Upload an export from any device</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-soft sm:text-base">
          This is not a live connection and does not track RPM time.
          The file is read on this device. Only a daily summary is uploaded.
        </p>
      </header>

      <section className="card mx-auto mb-6 max-w-3xl">
        <WearableUpload />
      </section>

      {isWithingsEnabled() && (
        <section className="card mx-auto mb-6 max-w-3xl">
          <h2 className="text-base font-bold">Withings account</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Link a Withings account to receive scale and blood pressure readings after
            your device syncs to Withings. New readings usually arrive within minutes,
            but can take hours. Each source shows when it last synced.
          </p>
          <a className="mt-3 inline-block text-sm font-semibold underline" href="/api/withings/connect">
            Connect Withings
          </a>
        </section>
      )}

      <div className="mx-auto mb-6 max-w-3xl">
        <SafetyDisclaimer theme="light" />
      </div>

      <section className="mx-auto grid max-w-3xl gap-4">
        {DEVICES.map((d) => (
          <article key={d.name} className="card">
            <div className="mb-2 flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-bold">{d.name}</h2>
              <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-800">
                {d.format}
              </span>
            </div>
            <ol className="mb-3 list-decimal space-y-1 pl-6 text-sm leading-relaxed text-ink">
              {d.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <div
              aria-hidden="true"
              className="grid h-28 place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs tracking-wider text-ink-mute"
            >
              {d.name} export screenshot
            </div>
          </article>
        ))}
      </section>

      <section className="card mx-auto mt-6 max-w-3xl">
        <h2 className="mb-2 text-lg font-bold">What happens to my file?</h2>
        <ul className="list-disc space-y-1 pl-6 text-sm leading-relaxed text-ink">
          <li>The file stays on this device. It is not uploaded.</li>
          <li>A daily summary can include heart rate, steps, sleep, SpO2, calories, blood pressure, glucose, weight, and heart rate variability.</li>
          <li>The summary is encrypted with AES-256-GCM before it is stored. The key is in the server environment.</li>
          <li>This is not a live connection and does not track RPM time.</li>
          <li>The summary is not sent to a model unless the server model flag is on.</li>
        </ul>
      </section>

      <footer className="mx-auto mt-6 max-w-3xl text-center">
        <Link href="/dashboard" className="text-sov-link">
          Back to your dashboard upload zone
        </Link>
      </footer>
    </main>
  );
}
