import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listActions } from "@/server/actions/query";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "actions:view");
  return json(await listActions(ctx, Object.fromEntries(new URL(req.url).searchParams)));
});
