import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateRule } from "@/server/rules/service";

export const dynamic = "force-dynamic";

export const PUT = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "rules:edit");
  const result = await updateRule(ctx, id, await readJson(req));
  return json(result);
});
