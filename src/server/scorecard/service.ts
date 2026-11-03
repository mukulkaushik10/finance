import { z } from "zod";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { actionWhere } from "../actions/query";
import { CONTROL_FAILURE_WHERE } from "../rules/routing";

// Weekly outcome scorecard. Weeks start Monday 00:00 UTC. Every figure comes with the action-list
// filter that reproduces it, so each number links down to the underlying invoices.

const DAY = 86_400_000;
export const ScorecardQuerySchema = z.object({ weeks: z.coerce.number().int().min(2).max(26).default(8), week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(x.getTime() - dow * DAY);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface WeekStats {
  weekStart: string;
  weekEnd: string;      // inclusive, YYYY-MM-DD
  partial: boolean;     // the current, unfinished week
  volume: number;
  reviewed: number;
  agentCorrect: number;
  accuracy: number | null;          // agreement with people, on invoices reviewed
  escalated: number;
  escalationRate: number | null;    // share of invoices sent to a person
  blocked: number;
  autoApproved: number;
  autoApprovedMinor: bigint;
  humanApprovedMinor: bigint;
  moneyAtRiskMinor: bigint;
  moneyAtRiskCount: number;
  costMinor: bigint;
  costPerActionMinor: bigint | null;
  pending: number;
  byStatus: Record<string, number>;
}

export async function getScorecard(ctx: Ctx, input: unknown = {}, now = new Date()) {
  requirePermission(ctx, "scorecard:view");
  const q = ScorecardQuerySchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const org = await db.workflow.findFirst({ where: { type: "ap_invoice" }, select: { currency: true } });
  const currency = org?.currency ?? "USD";
  const current = weekStart(now);
  const first = new Date(current.getTime() - (q.weeks - 1) * 7 * DAY);

  const rows = await db.action.findMany({
    where: { ...actionWhere({}), createdAt: { gte: first }, currency },
    select: {
      createdAt: true, amountMinor: true, status: true, computedOutcome: true, proposedDecision: true, costMinor: true,
      review: { select: { agentWasCorrect: true } },
      _count: { select: { ruleResults: { where: CONTROL_FAILURE_WHERE } } },
    },
  });

  const weeks: WeekStats[] = [];
  for (let i = 0; i < q.weeks; i++) {
    const start = new Date(first.getTime() + i * 7 * DAY);
    weeks.push({
      weekStart: iso(start), weekEnd: iso(new Date(start.getTime() + 6 * DAY)), partial: start.getTime() === current.getTime(),
      volume: 0, reviewed: 0, agentCorrect: 0, accuracy: null, escalated: 0, escalationRate: null, blocked: 0,
      autoApproved: 0, autoApprovedMinor: 0n, humanApprovedMinor: 0n, moneyAtRiskMinor: 0n, moneyAtRiskCount: 0,
      costMinor: 0n, costPerActionMinor: null, pending: 0, byStatus: {},
    });
  }
  for (const r of rows) {
    const w = weeks[Math.floor((r.createdAt.getTime() - first.getTime()) / (7 * DAY))];
    if (!w) continue;
    w.volume++;
    w.byStatus[r.status] = (w.byStatus[r.status] ?? 0) + 1;
    w.costMinor += r.costMinor;
    if (r.review) { w.reviewed++; if (r.review.agentWasCorrect) w.agentCorrect++; }
    if (r.computedOutcome === "needs_human") w.escalated++;
    if (r.status === "blocked") w.blocked++;
    if (r.status === "pending_review") w.pending++;
    if (r.status === "auto_approved") { w.autoApproved++; w.autoApprovedMinor += r.amountMinor; }
    if (r.status === "approved") w.humanApprovedMinor += r.amountMinor;
    const failed = r._count.ruleResults > 0;
    const atRisk = failed && (r.status === "approved" || (r.status === "logged" && r.proposedDecision === "approve" && r.computedOutcome !== "auto_approve"));
    if (atRisk) { w.moneyAtRiskMinor += r.amountMinor; w.moneyAtRiskCount++; }
  }
  for (const w of weeks) {
    w.accuracy = w.reviewed ? w.agentCorrect / w.reviewed : null;
    w.escalationRate = w.volume ? w.escalated / w.volume : null;
    w.costPerActionMinor = w.volume ? w.costMinor / BigInt(w.volume) : null;
  }

  // The headline week: the one asked for, else the last complete week.
  const selected = (q.week && weeks.find((w) => w.weekStart === q.week)) || weeks[weeks.length - 2] || weeks[weeks.length - 1];
  const idx = weeks.indexOf(selected);
  const previous = idx > 0 ? weeks[idx - 1] : null;
  const range = { from: selected.weekStart, to: selected.weekEnd };
  const qs = (extra: Record<string, string>) => "/actions?" + new URLSearchParams({ ...range, ...extra }).toString();
  return {
    currency,
    weeks,
    selected,
    previous,
    links: {
      volume: qs({}),
      accuracy: qs({ flag: "reviewed" }),
      agentWrong: qs({ flag: "agent_wrong" }),
      escalation: qs({ flag: "escalated" }),
      autoApproved: qs({ status: "auto_approved" }),
      moneyAtRisk: qs({ flag: "money_at_risk" }),
      blocked: qs({ status: "blocked" }),
      cost: qs({}),
      pending: "/review",
    },
  };
}
