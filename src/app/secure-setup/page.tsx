import { notFound } from "next/navigation";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import SecureSetup from "./SecureSetup";

export const dynamic = "force-dynamic";

export default function SecureSetupPage() {
  if (!isClientEncEnabled()) notFound();
  return <SecureSetup />;
}
