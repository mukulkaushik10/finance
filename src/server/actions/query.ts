import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";

// One filter vocabulary for the action list, the scorecard drill-downs and evidence exports.

const isoDate = z.string().refine(
  (s) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s + "T00:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  },
  "Use a real date in YYYY-MM-DD format",
);

export const ActionFilterSchema = z.object({
  status: z.string().optional(),            // comma separated ActionStatus values
  outcome: z.enum(["auto_approve", "needs_human", "block"]).optional(),
  flag: z.enum(["money_at_risk", "agent_wrong", "reviewed", "escalated", "overridden"]).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),   // inclusive
  vendor: z.string().optional(),
  q: z.string().optional(),                 // invoice id contains
  agentId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});
export type ActionFilter = z.infer<typeof ActionFilterSchema>;

/**
 * Money at risk: invoices that went ahead even though a rule failed.
 *  - a person approved it despite a failed rule (an override), or
 *  - in shadow mode the agent went ahead with an approval the rules would have stopped.
 */
export const MONEY_AT_RISK: Prisma.ActionWhereInput = {
  ruleResults: { some: { result: "fail" } },
  OR: [
    { status: "approved" },
    { status: "logged", proposedDecision: "approve", computedOutcome: { not: "auto_approve" } },
  ],
};

export function actionWhere(f: Partial<ActionFilter>): Prisma.ActionWhereInput {
  const and: Prisma.ActionWhereInput[] = [{ source: "live" }];
  if (f.status) and.push({ status: { in: f.status.split(",") as never } });
  if (f.outcome) and.push({ computedOutcome: f.outcome });
  if (f.from) and.push({ createdAt: { gte: new Date(f.from + "T00:00:00Z") } });
  if (f.to) and.push({ createdAt: { lt: new Date(new Date(f.to + "T00:00:00Z").getTime() + 86_400_000) } });
  if (f.vendor) and.push({ OR: [{ counterpartyKey: f.vendor }, { counterpartyName: { contains: f.vendor, mode: "insensitive" } }] });
  if (f.q) and.push({ externalRef: { contains: f.q, mode: "insensitive" } });
  if (f.agentId) and.push({ agentId: f.agentId });
  switch (f.flag) {
    case "money_at_risk": and.push(MONEY_AT_RISK); break;
    case "overridden": and.push({ status: "approved", ruleResults: { some: { result: "fail" } } }); break;
    case "agent_wrong": and.push({ review: { agentWasCorrect: false } }); break;
    case "reviewed": and.push({ review: { isNot: null } }); break;
    case "escalated": and.push({ computedOutcome: "needs_human" }); break;
  }
  return { AND: and };
}

export async function listActions(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "actions:view");
  const f = ActionFilterSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const where = actionWhere(f);
  const [rows, total, sum] = await Promise.all([
    db.action.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        agent: { select: { name: true } },
        review: { select: { decision: true, agentWasCorrect: true, reviewer: { select: { name: true } } } },
        ruleResults: { where: { result: "fail" }, select: { ruleName: true, explanation: true } },
      },
    }),
    db.action.count({ where }),
    db.action.aggregate({ where, _sum: { amountMinor: true } }),
  ]);
  return { rows, total, totalAmountMinor: sum._sum.amountMinor ?? 0n, page: f.page, pageSize: f.pageSize, filter: f };
}

export async function listQueue(ctx: Ctx) {
  requirePermission(ctx, "actions:view");
  const db = forOrg(ctx.organisationId);
  const [pending, spotChecks] = await Promise.all([
    db.action.findMany({
      where: { status: "pending_review", source: "live" },
      orderBy: { createdAt: "asc" },
      include: { agent: { select: { name: true } }, ruleResults: { where: { result: "fail" }, select: { ruleName: true, explanation: true } } },
    }),
    db.action.findMany({
      where: { status: "logged", source: "live", review: null },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { agent: { select: { name: true } }, ruleResults: { where: { result: "fail" }, select: { ruleName: true, explanation: true } } },
    }),
  ]);
  return { pending, spotChecks };
}
