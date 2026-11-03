import type { Role } from "@prisma/client";
import { RULE_DEFINITIONS } from "./definitions";
import type { ActiveRule, EvaluatedRule, RuleContext } from "./types";
import { APPROVER_RANK } from "../auth/permissions";

/**
 * Run every rule against the context. Pure and synchronous.
 * - Switched-off rules are recorded as not applicable, so the audit trail shows they were skipped.
 * - A rule that throws is recorded as a failure (fail safe), never silently passed.
 */
export function evaluateRules(rules: ActiveRule[], ctx: RuleContext): EvaluatedRule[] {
  return rules.map((rule) => {
    const base = {
      ruleId: rule.ruleId, ruleVersionId: rule.ruleVersionId, version: rule.version,
      name: rule.name, type: rule.type, severity: rule.severity,
    };
    if (!rule.enabled) return { ...base, result: "not_applicable" as const, explanation: "This rule is switched off" };
    const def = RULE_DEFINITIONS[rule.type];
    const parsed = def.paramsSchema.safeParse(rule.params);
    if (!parsed.success) {
      return { ...base, result: "fail" as const, explanation: "This rule's settings are invalid, so it could not be checked" };
    }
    try {
      return { ...base, ...def.evaluate(parsed.data, ctx) };
    } catch (e) {
      return { ...base, result: "fail" as const, explanation: `This rule could not be checked: ${(e as Error).message}` };
    }
  });
}

export function highestRole(roles: (Role | undefined | null)[]): Role | null {
  let best: Role | null = null;
  for (const r of roles) {
    if (!r) continue;
    if (!best || APPROVER_RANK[r] > APPROVER_RANK[best]) best = r;
  }
  return best;
}

/** e.g. "ckabc@3,ckdef@1": identifies exactly which rule versions produced a decision. */
export function ruleSetVersion(rules: ActiveRule[]): string {
  return rules.map((r) => `${r.ruleId}@${r.version}${r.enabled ? "" : ":off"}`).join(",");
}
