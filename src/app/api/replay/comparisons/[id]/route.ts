import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { notFound } from "@/server/errors";
import { forOrg } from "@/server/db/dal";
import { computeComparison } from "@/server/replay/report";

export const dynamic = "force-dynamic";

/** Progress and report for a comparison. Poll until `done` is true. */
export const GET = route<{ id: string }>(async (req, { id }) => {
  const ctx = await requireCtx(req, "replay:view");
  const result = await computeComparison(forOrg(ctx.organisationId), id);
  if (!result) throw notFound("Comparison");
  return json(result);
});
