import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { createCustomRule, listRules } from "@/server/rules/service";
import { badRequest } from "@/server/errors";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "rules:view");
  const workflowId = new URL(req.url).searchParams.get("workflowId");
  if (!workflowId) throw badRequest("workflowId is required");
  return json({ rules: await listRules(ctx, workflowId) });
});

export const POST = route(async (req) => {
  const ctx = await requireCtx(req, "rules:edit");
  const rule = await createCustomRule(ctx, await readJson(req));
  return json({ rule }, 201);
});
