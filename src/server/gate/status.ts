import type { Agent } from "@prisma/client";
import { forOrg } from "../db/dal";
import { notFound } from "../errors";

/** GET /v1/actions/{id}: lets an agent poll for a person's decision on a queued action. */
export async function getActionStatus(agent: Agent, actionId: string) {
  const db = forOrg(agent.organisationId);
  const a = await db.action.findFirst({
    where: { id: actionId, agentId: agent.id },
    include: { review: { include: { reviewer: { select: { name: true } } } } },
  });
  if (!a) throw notFound("Action");
  const final =
    a.status === "approved" || a.status === "auto_approved" || a.status === "logged" ? "approve"
    : a.status === "rejected" || a.status === "blocked" ? "reject"
    : null;
  return {
    action_id: a.id,
    status: a.status,
    outcome: a.gateOutcome,
    final_decision: (a.status === "logged" ? a.proposedDecision : final) as "approve" | "reject" | "escalate" | null,
    decided_at: a.decidedAt?.toISOString() ?? null,
    reviewer: a.review ? { name: a.review.reviewer.name, reason: a.review.reason } : null,
  };
}
