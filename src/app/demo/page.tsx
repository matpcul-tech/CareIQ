import DemoClinic from "./DemoClinic";
import { loadDemoSnapshot } from "@/lib/clinic/demo";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "CareIQ demo clinic",
  description: "Fictional rural health center for a CareIQ sales walkthrough. Sample data only. No sign-in.",
};

export default async function DemoPage() {
  const snapshot = await loadDemoSnapshot();
  return <DemoClinic snapshot={snapshot} />;
}
