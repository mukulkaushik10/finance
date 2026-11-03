import { z } from "zod";
import type { Decision } from "@prisma/client";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { canApproveAtLevel, ROLE_LABELS } from "../auth/permissions";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { getErpConnector } from "../connectors/erp";
import { enqueue, QUEUES } from "../jobs/queue";
import { isControlFailure } from "../rules/routing";

export const ReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().min(10, "Please give a reason of at least a few words").max(2000),
  /** Only asked when the agent escalated: was sending it to a person the right call? Default yes. */
  agentRightToEscalate: z.boolean().optional(),
});

export interface ReviewOptions {
  now?: Date;
  /** Seed/tests: skip the background callback to the agent. */
  skipCallback?: boolean;
}

/**
 * A person approves or rejects a queued action, with a required reason.
 * The outcome becomes ground truth for accuracy tracking and is written to the audit trail.
 * Shadow-mode actions (status "logged") can also be reviewed as spot checks: this records ground
 * truth without changing what already happened.
 */
export async function reviewAction(ctx: Ctx, actionId: string, input: unknown, opts: ReviewOptions = {}) {
  requirePermission(ctx, "actions:review");
  const data = ReviewSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const now = opts.now ?? new Date();

  const result = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"action:" + actionId}))`;
    const action = await tx.action.findFirst({ where: { id: actionId }, include: { review: true, workflow: true, ruleResults: true } });
    if (!action) throw notFound("Action");
    if (action.review) throw conflict("This invoice has already been reviewed");
    const spotCheck = action.status === "logged";
    if (action.status !== "pending_review" && !spotCheck) throw conflict("This invoice is not waiting for review");
    if (!spotCheck && !canApproveAtLevel(ctx.user.role, action.requiredRole)) {
      throw forbidden(`This invoice needs a decision by ${ROLE_LABELS[action.requiredRole ?? "reviewer"].toLowerCase()} or above`);
    }
    if (data.agentRightToEscalate !== undefined && action.proposedDecision !== "escalate") {
      throw badRequest("agentRightToEscalate only applies when the agent escalated");
    }
    const correctDecision: Decision =
      action.proposedDecision === "escalate" && data.agentRightToEscalate !== false ? "escalate" : data.decision;
    const agentWasCorrect = action.proposedDecision === correctDecision;

    const review = await tx.review.create({
      data: {
        organisationId: ctx.organisationId, actionId, reviewerId: ctx.user.id, decision: data.decision,
        correctDecision, agentWasCorrect, reason: data.reason, createdAt: now,
      },
    });
    let erpRef: string | null = null;
    if (!spotCheck) {
      await tx.action.update({ where: { id: actionId }, data: { status: data.decision === "approve" ? "approved" : "rejected", decidedAt: now } });
      if (data.decision === "approve") {
        const erp = getErpConnector(action.workflow.erpConnector, db);
        erpRef = (await erp.postApprovedInvoice({ invoiceId: action.externalRef, amountMinor: action.amountMinor, currency: action.currency, glCode: action.proposedGlCode })).externalRef;
      }
    }
    const failedRules = action.ruleResults.filter(isControlFailure);
    const audit = await appendAudit(tx, ctx.organisationId, {
      eventType: "action.reviewed",
      entityType: "action",
      entityId: actionId,
      actorType: "user",
      actorId: ctx.user.id,
      occurredAt: now,
      payload: {
        reviewer: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
        decision: data.decision,
        reason: data.reason,
        spotCheck,
        agentProposed: action.proposedDecision,
        correctDecision,
        agentWasCorrect,
        requiredRole: action.requiredRole,
        previousStatus: action.status,
        newStatus: spotCheck ? action.status : data.decision === "approve" ? "approved" : "rejected",
        overriddenRules: data.decision === "approve" ? failedRules.map((r) => ({ ruleId: r.ruleId, ruleVersionId: r.ruleVersionId, name: r.ruleName, explanation: r.explanation })) : [],
        amountMinor: action.amountMinor,
        currency: action.currency,
        erpRef,
      },
    });
    return { review, audit, callback: Boolean(!spotCheck) };
  });

  if (result.callback && !opts.skipCallback) {
    const agent = await db.action.findFirst({ where: { id: actionId }, select: { agent: { select: { callbackUrl: true } } } });
    if (agent?.agent.callbackUrl) await enqueue(QUEUES.reviewCallback, { organisationId: ctx.organisationId, actionId }).catch((e) => console.error(e));
  }
  return { review: result.review, audit: { seq: result.audit.seq, hash: result.audit.hash } };
}

export async function getActionDetail(ctx: Ctx, actionId: string) {
  requirePermission(ctx, "actions:view");
  const db = forOrg(ctx.organisationId);
  const action = await db.action.findFirst({
    where: { id: actionId },
    include: {
      agent: { select: { id: true, name: true, vendorName: true } },
      workflow: { select: { id: true, name: true } },
      ruleResults: { include: { ruleVersion: { select: { version: true, summary: true } } } },
      review: { include: { reviewer: { select: { name: true, role: true } } } },
    },
  });
  if (!action) throw notFound("Action");
  const order = { fail: 0, pass: 1, not_applicable: 2 } as const;
  action.ruleResults.sort((a, b) => order[a.result] - order[b.result]);
  const audit = await db.auditRecord.findMany({ where: { entityType: "action", entityId: actionId }, orderBy: { seq: "asc" } });
  return { action, audit, canReview: canApproveAtLevel(ctx.user.role, action.requiredRole) && ctx.user.role !== "auditor" };
}
