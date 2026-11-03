import { getPageCtx } from "@/server/auth/page";
import { ComparisonReport } from "./report";

export const metadata = { title: "Replay report" };

export default async function ReplayReportPage({ params }: { params: Promise<{ id: string }> }) {
  await getPageCtx("replay:view");
  const { id } = await params;
  return <ComparisonReport id={id} />;
}
