import { forOrg } from "../db/dal";
import type { Ctx } from "../auth/session";
import { notFound } from "../errors";

/** The MVP has one AP workflow per organisation; this is the seam for several. */
export async function getPrimaryWorkflow(ctx: Ctx) {
  const wf = await forOrg(ctx.organisationId).workflow.findFirst({ where: { type: "ap_invoice" }, orderBy: { createdAt: "asc" } });
  if (!wf) throw notFound("Workflow");
  return wf;
}
