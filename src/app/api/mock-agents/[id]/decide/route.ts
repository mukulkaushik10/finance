import { rawPrisma } from "@/server/db/client";
import { forOrg } from "@/server/db/dal";
import { json, route } from "@/server/http";
import { AppError, notFound } from "@/server/errors";
import { MockConfigSchema, mockAgentDecide } from "@/server/agents/mock";
import { verifySignature } from "@/server/agents/webhook";
import { getErpConnector } from "@/server/connectors/erp";
import { liveLookup } from "@/server/workflows/ap_invoice/context";
import { InvoiceSubjectSchema } from "@/server/workflows/ap_invoice/subject";

export const dynamic = "force-dynamic";

/**
 * A built-in mock agent exposed over the webhook contract, so the webhook connector can be
 * demoed end to end: create a webhook agent whose endpoint is
 *   {APP_URL}/api/mock-agents/{mockAgentId}/decide
 * and give it the same signing secret as the mock agent.
 */
export const POST = route<{ id: string }>(async (req, { id }) => {
  const agent = await rawPrisma.agent.findUnique({ where: { id } });
  if (!agent || agent.kind !== "mock") throw notFound("Mock agent");
  const raw = await req.text();
  if (!verifySignature(agent.signingSecret, req.headers.get("x-controlroom-timestamp"), raw, req.headers.get("x-controlroom-signature"))) {
    throw new AppError(401, "bad_signature", "Signature check failed");
  }
  const body = JSON.parse(raw) as { subject: unknown };
  const subject = InvoiceSubjectSchema.parse(body.subject);
  const db = forOrg(agent.organisationId);
  const wf = await db.workflow.findFirstOrThrow({ where: { type: "ap_invoice" } });
  const answer = await mockAgentDecide(subject, liveLookup(db, getErpConnector(wf.erpConnector, db), wf.id), MockConfigSchema.parse(agent.mockConfig), new Date(subject.invoice_date + "T12:00:00Z"));
  return json(answer);
});
