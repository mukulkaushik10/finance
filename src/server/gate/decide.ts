import type { ActionStatus, Decision, GateOutcome, Role } from "@prisma/client";
import { formatBps, formatMoney } from "@/lib/money";
import type { EvaluatedRule } from "../rules/types";
import { highestRole } from "../rules/engine";

export const AUTONOMY_LEVELS = [
  { level: 0, name: "Shadow mode", short: "Watch only", description: "Control Room records what it would have done, but never stops the agent." },
  { level: 1, name: "Humans approve everything", short: "All reviewed", description: "Every invoice the agent proposes goes to a person." },
  { level: 2, name: "Auto-approve small invoices", short: "Auto under limit", description: "Invoices that pass every rule and are under the auto-approve limit go through automatically." },
  { level: 3, name: "Auto-approve all passing", short: "Auto when passing", description: "Any invoice that passes every rule goes through automatically." },
] as const;

export interface GateInput {
  level: number;
  autoApproveLimitMinor: bigint;
  workflowCurrency: string;
  confidenceThresholdBps: number;
  proposedDecision: Decision;
  confidenceBps: number | null;
  amountMinor: bigint;
  currency: string;
  ruleResults: EvaluatedRule[];
}

export interface GateDecision {
  /** Returned to the agent. In shadow mode this is always auto_approve. */
  outcome: GateOutcome;
  /** What the rules and autonomy level actually concluded. */
  computedOutcome: GateOutcome;
  enforced: boolean;
  reasons: string[];
  requiredRole: Role | null;
  status: ActionStatus;
}

/**
 * The gate. Order of precedence:
 *  1. A failed "block" rule on an approval -> block.
 *  2. Agent asked for escalation, a "review" rule failed, or confidence is below threshold -> needs_human.
 *  3. Otherwise the autonomy level decides.
 * In shadow mode (level 0) we compute the outcome as if at level 3 (rules + confidence only),
 * record it, and tell the agent to proceed.
 */
export function decideGate(input: GateInput): GateDecision {
  const effectiveLevel = input.level === 0 ? 3 : input.level;
  const reasons: string[] = [];
  const failed = input.ruleResults.filter((r) => r.result === "fail");
  const requiredRole = highestRole(failed.map((r) => r.requiredRole));
  const confOk = input.confidenceBps !== null && input.confidenceBps >= input.confidenceThresholdBps;
  const confReason = input.confidenceBps === null
    ? "The agent did not say how confident it is"
    : `Agent confidence ${formatBps(input.confidenceBps, 0)} is below the ${formatBps(input.confidenceThresholdBps, 0)} threshold`;

  let computed: GateOutcome;

  if (input.proposedDecision === "approve") {
    const blocking = failed.filter((r) => r.severity === "block");
    if (blocking.length) {
      computed = "block";
      reasons.push(...blocking.map((r) => r.explanation));
    } else {
      reasons.push(...failed.map((r) => r.explanation));
      if (!confOk) reasons.push(confReason);
      if (reasons.length) computed = "needs_human";
      else if (effectiveLevel === 1) {
        computed = "needs_human";
        reasons.push("Level 1: a person approves every invoice");
      } else if (effectiveLevel === 2 && (input.currency !== input.workflowCurrency || input.amountMinor > input.autoApproveLimitMinor)) {
        computed = "needs_human";
        reasons.push(
          input.currency !== input.workflowCurrency
            ? `Level 2 only auto-approves invoices in ${input.workflowCurrency}`
            : `${formatMoney(input.amountMinor, input.currency)} is above the ${formatMoney(input.autoApproveLimitMinor, input.workflowCurrency)} auto-approve limit`,
        );
      } else {
        computed = "auto_approve";
        reasons.push(effectiveLevel === 2
          ? `Passed every rule and is within the ${formatMoney(input.autoApproveLimitMinor, input.workflowCurrency)} auto-approve limit`
          : "Passed every rule");
      }
    }
  } else if (input.proposedDecision === "escalate") {
    computed = "needs_human";
    reasons.push("The agent asked for a person to decide");
  } else {
    // reject
    if (effectiveLevel === 3 && confOk) {
      computed = "auto_approve";
      reasons.push("Rejection applied automatically at Level 3");
    } else {
      computed = "needs_human";
      reasons.push(confOk ? "A person confirms every rejection below Level 3" : confReason);
    }
  }

  const shadow = input.level === 0;
  const outcome: GateOutcome = shadow ? "auto_approve" : computed;
  let status: ActionStatus;
  if (shadow) status = "logged";
  else if (computed === "block") status = "blocked";
  else if (computed === "needs_human") status = "pending_review";
  else status = input.proposedDecision === "reject" ? "rejected" : "auto_approved";

  return {
    outcome,
    computedOutcome: computed,
    enforced: !shadow,
    reasons: shadow ? [`Shadow mode: recorded only. Would have been: ${OUTCOME_LABEL[computed]}`, ...reasons] : reasons,
    requiredRole: computed === "needs_human" ? (requiredRole ?? "reviewer") : null,
    status,
  };
}

export const OUTCOME_LABEL: Record<GateOutcome, string> = {
  auto_approve: "Approved automatically",
  needs_human: "Sent for review",
  block: "Blocked",
};
