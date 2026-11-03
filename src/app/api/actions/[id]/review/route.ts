import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { reviewAction } from "@/server/review/service";

export const dynamic = "force-dynamic";

/** A person approves or rejects a queued invoice. Reason required. */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "actions:review");
  return json(await reviewAction(ctx, id, await readJson(req)), 201);
});
