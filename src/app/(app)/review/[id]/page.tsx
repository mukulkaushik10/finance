import { getPageCtx } from "@/server/auth/page";
import { can, canApproveAtLevel } from "@/server/auth/permissions";
import { getActionDetail } from "@/server/review/service";
import { forOrg } from "@/server/db/dal";
import { ActionDetail } from "@/components/action-detail";

export const metadata = { title: "Review invoice" };

export default async function ReviewItemPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageCtx("actions:view");
  const { id } = await params;
  const detail = await getActionDetail(ctx, id);
  // The next invoice this person can decide, oldest first.
  const queue = await forOrg(ctx.organisationId).action.findMany({
    where: { status: "pending_review", id: { not: id } }, orderBy: { createdAt: "asc" }, select: { id: true, requiredRole: true },
  });
  const next = queue.find((q) => canApproveAtLevel(ctx.user.role, q.requiredRole))?.id ?? null;
  return <ActionDetail detail={detail} back={{ href: "/review", label: "Review queue" }} nextId={next} canExport={can(ctx.user.role, "audit:export")} />;
}
