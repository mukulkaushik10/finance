import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { getActionDetail } from "@/server/review/service";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "actions:view");
  return json(await getActionDetail(ctx, id));
});
