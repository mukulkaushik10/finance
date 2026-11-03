import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { startComparison } from "@/server/replay/service";

export const dynamic = "force-dynamic";

/** Start replaying a set against one to three agents. Runs happen in the background worker. */
export const POST = route(async (req) => {
  const ctx = await requireCtx(req, "replay:run");
  const comparison = await startComparison(ctx, await readJson(req));
  return json({ comparison }, 202);
});
