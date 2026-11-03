import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateWorkflowSettings } from "@/server/autonomy/service";

export const dynamic = "force-dynamic";

/** Update auto-approve limit, confidence threshold and promotion settings. */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "autonomy:change");
  return json({ workflow: await updateWorkflowSettings(ctx, id, await readJson(req)) });
});
