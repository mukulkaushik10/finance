import { getPageCtx } from "@/server/auth/page";
import { PageHeader } from "@/components/ui";

export default async function ScorecardPage() {
  await getPageCtx("scorecard:view");
  return <PageHeader title="Scorecard" description="Coming in slice (f)." />;
}
