import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { changeAutonomyLevel, getAutonomyState } from "@/server/autonomy/service";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "autonomy:view");
  return json(await getAutonomyState(ctx, id));
});

/** Change the autonomy level. Promotions need the accuracy target to be met and a person to confirm. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "autonomy:change");
  return json(await changeAutonomyLevel(ctx, id, await readJson(req)));
});
