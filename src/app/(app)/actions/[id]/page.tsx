import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { getActionDetail } from "@/server/review/service";
import { ActionDetail } from "@/components/action-detail";

export const metadata = { title: "Invoice" };

export default async function ActionPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageCtx("actions:view");
  const { id } = await params;
  const detail = await getActionDetail(ctx, id);
  return <ActionDetail detail={detail} back={{ href: "/actions", label: "All actions" }} canExport={can(ctx.user.role, "audit:export")} />;
}
