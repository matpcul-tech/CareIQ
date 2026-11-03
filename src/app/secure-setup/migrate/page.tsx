import { notFound } from "next/navigation";
import { isClientEncEnabled } from "@/lib/e2e/flag";
import MigrateClient from "./MigrateClient";

export const dynamic = "force-dynamic";

export default function MigratePage() {
  if (!isClientEncEnabled()) notFound();
  return <MigrateClient />;
}
