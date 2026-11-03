import type { RuleType } from "@prisma/client";

/**
 * Rules whose "fail" only decides WHO must approve (e.g. approval limits). When the right person
 * approves, the control has worked; it is not an override and not money at risk.
 */
export const ROUTING_RULE_TYPES: RuleType[] = ["approval_limit"];

/** A failed check a person would be overriding by approving anyway. */
export function isControlFailure(r: { result: string; ruleType?: RuleType; type?: RuleType }): boolean {
  const type = r.ruleType ?? r.type;
  return r.result === "fail" && !(type && ROUTING_RULE_TYPES.includes(type));
}

/** Prisma filter for the same thing. */
export const CONTROL_FAILURE_WHERE = { result: "fail" as const, ruleType: { notIn: ROUTING_RULE_TYPES } };
