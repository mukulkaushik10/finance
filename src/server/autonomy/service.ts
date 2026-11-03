import { z } from "zod";
import type { Workflow } from "@prisma/client";
import { forOrg, type OrgDb } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { badRequest, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { AUTONOMY_LEVELS } from "../gate/decide";
import { formatBps } from "@/lib/money";

export interface RollingAccuracy { sampleSize: number; correct: number; accuracyBps: number | null }

/** Agreement between the agent and people over the last N reviewed actions of a workflow. */
export async function rollingAccuracy(db: OrgDb, workflowId: string, window: number, before?: Date): Promise<RollingAccuracy> {
  const reviews = await db.review.findMany({
    where: { action: { workflowId, source: "live" }, ...(before ? { createdAt: { lte: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: window,
    select: { agentWasCorrect: true },
  });
  const correct = reviews.filter((r) => r.agentWasCorrect).length;
  return { sampleSize: reviews.length, correct, accuracyBps: reviews.length ? Math.floor((correct * 10_000) / reviews.length) : null };
}

export function promotionCheck(wf: Pick<Workflow, "autonomyLevel" | "promotionWindow" | "promotionTargetBps">, acc: RollingAccuracy) {
  if (wf.autonomyLevel >= 3) return { eligible: false, nextLevel: null, reason: "Already at the highest level" };
  const next = wf.autonomyLevel + 1;
  if (acc.sampleSize < wf.promotionWindow) {
    return { eligible: false, nextLevel: next, reason: `Needs ${wf.promotionWindow} reviewed invoices; ${acc.sampleSize} so far` };
  }
  if ((acc.accuracyBps ?? 0) < wf.promotionTargetBps) {
    return { eligible: false, nextLevel: next, reason: `Accuracy ${formatBps(acc.accuracyBps ?? 0)} is below the ${formatBps(wf.promotionTargetBps)} target` };
  }
  return {
    eligible: true, nextLevel: next,
    reason: `The agent agreed with your reviewers on ${formatBps(acc.accuracyBps ?? 0)} of the last ${acc.sampleSize} invoices (target ${formatBps(wf.promotionTargetBps)})`,
  };
}

export async function getAutonomyState(ctx: Ctx, workflowId: string) {
  requirePermission(ctx, "autonomy:view");
  const db = forOrg(ctx.organisationId);
  const wf = await db.workflow.findFirst({ where: { id: workflowId } });
  if (!wf) throw notFound("Workflow");
  const acc = await rollingAccuracy(db, wf.id, wf.promotionWindow);
  const changes = await db.autonomyChange.findMany({ where: { workflowId }, orderBy: { createdAt: "desc" } });
  const users = await db.user.findMany({ where: { id: { in: changes.map((c) => c.confirmedById) } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const pendingShadow = await db.action.count({ where: { workflowId, status: "logged", review: null } });
  return {
    workflow: wf,
    level: AUTONOMY_LEVELS[wf.autonomyLevel],
    accuracy: acc,
    promotion: promotionCheck(wf, acc),
    pendingShadowSpotChecks: pendingShadow,
    history: changes.map((c) => ({ ...c, confirmedBy: names.get(c.confirmedById) ?? "Unknown" })),
  };
}

export const ChangeLevelSchema = z.object({
  toLevel: z.number().int().min(0).max(3),
  reason: z.string().trim().min(10, "Please explain the change in a few words").max(1000),
});

/**
 * Change a workflow's autonomy level. Promotions go one level at a time and only when the rolling
 * accuracy meets the target; a person must confirm each one. Moving down is always allowed.
 */
export async function changeAutonomyLevel(ctx: Ctx, workflowId: string, input: unknown, opts: { now?: Date } = {}) {
  requirePermission(ctx, "autonomy:change");
  const data = ChangeLevelSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const now = opts.now ?? new Date();
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"workflow:" + workflowId}))`;
    const wf = await tx.workflow.findFirst({ where: { id: workflowId } });
    if (!wf) throw notFound("Workflow");
    if (data.toLevel === wf.autonomyLevel) throw badRequest(`Already at Level ${wf.autonomyLevel}`);
    const acc = await rollingAccuracy(tx as unknown as OrgDb, wf.id, wf.promotionWindow, now);
    const promoting = data.toLevel > wf.autonomyLevel;
    if (promoting) {
      if (data.toLevel !== wf.autonomyLevel + 1) throw badRequest("Promote one level at a time");
      const check = promotionCheck(wf, acc);
      if (!check.eligible) throw badRequest(`Not ready for Level ${data.toLevel}: ${check.reason}`);
    }
    const change = await tx.autonomyChange.create({
      data: {
        organisationId: ctx.organisationId, workflowId, fromLevel: wf.autonomyLevel, toLevel: data.toLevel,
        accuracyBps: acc.accuracyBps, sampleSize: acc.sampleSize, confirmedById: ctx.user.id, reason: data.reason, createdAt: now,
      },
    });
    const updated = await tx.workflow.update({ where: { id: workflowId }, data: { autonomyLevel: data.toLevel } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "autonomy.changed", entityType: "workflow", entityId: workflowId, actorType: "user", actorId: ctx.user.id, occurredAt: now,
      payload: {
        fromLevel: wf.autonomyLevel, toLevel: data.toLevel, direction: promoting ? "promotion" : "demotion",
        rollingAccuracyBps: acc.accuracyBps, sampleSize: acc.sampleSize, targetBps: wf.promotionTargetBps, window: wf.promotionWindow,
        confirmedBy: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role }, reason: data.reason,
      },
    });
    return { workflow: updated, change };
  });
}

export const WorkflowSettingsSchema = z.object({
  autoApproveLimitMinor: z.number().int().min(0).optional(),
  confidenceThresholdBps: z.number().int().min(0).max(10_000).optional(),
  promotionWindow: z.number().int().min(5).max(1000).optional(),
  promotionTargetBps: z.number().int().min(5000).max(10_000).optional(),
  reason: z.string().trim().min(10, "Please explain the change in a few words").max(1000),
});

export async function updateWorkflowSettings(ctx: Ctx, workflowId: string, input: unknown) {
  requirePermission(ctx, "autonomy:change");
  const { reason, ...data } = WorkflowSettingsSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const wf = await tx.workflow.findFirst({ where: { id: workflowId } });
    if (!wf) throw notFound("Workflow");
    const patch = {
      ...(data.autoApproveLimitMinor !== undefined ? { autoApproveLimitMinor: BigInt(data.autoApproveLimitMinor) } : {}),
      ...(data.confidenceThresholdBps !== undefined ? { confidenceThresholdBps: data.confidenceThresholdBps } : {}),
      ...(data.promotionWindow !== undefined ? { promotionWindow: data.promotionWindow } : {}),
      ...(data.promotionTargetBps !== undefined ? { promotionTargetBps: data.promotionTargetBps } : {}),
    };
    const updated = await tx.workflow.update({ where: { id: workflowId }, data: patch });
    const pick = (w: Workflow) => ({ autoApproveLimitMinor: w.autoApproveLimitMinor, confidenceThresholdBps: w.confidenceThresholdBps, promotionWindow: w.promotionWindow, promotionTargetBps: w.promotionTargetBps });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "workflow.settings_changed", entityType: "workflow", entityId: workflowId, actorType: "user", actorId: ctx.user.id,
      payload: { before: pick(wf), after: pick(updated), reason, changedBy: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role } },
    });
    return updated;
  });
}
