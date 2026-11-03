import { describe, expect, it } from "vitest";
import { decideGate, type GateInput } from "@/server/gate/decide";
import type { EvaluatedRule } from "@/server/rules/types";

const pass = (name = "Three-way match"): EvaluatedRule => ({
  ruleId: name, ruleVersionId: "v", version: 1, name, type: "three_way_match", severity: "review", result: "pass", explanation: "ok",
});
const fail = (over: Partial<EvaluatedRule> = {}): EvaluatedRule => ({ ...pass(), result: "fail", explanation: "Invoice is 12% above PO", ...over });

const input = (over: Partial<GateInput> = {}): GateInput => ({
  level: 2, autoApproveLimitMinor: 500_000n, workflowCurrency: "USD", confidenceThresholdBps: 8500,
  proposedDecision: "approve", confidenceBps: 9500, amountMinor: 100_000n, currency: "USD", ruleResults: [pass()], ...over,
});

describe("gate: autonomy levels", () => {
  it("Level 0 (shadow) never blocks but records what would have happened", () => {
    const d = decideGate(input({ level: 0, ruleResults: [fail({ severity: "block" })] }));
    expect(d).toMatchObject({ outcome: "auto_approve", computedOutcome: "block", enforced: false, status: "logged" });
    expect(d.reasons[0]).toContain("Would have been: Blocked");
  });
  it("Level 0 computes the shadow outcome with rules only (as if Level 3)", () => {
    expect(decideGate(input({ level: 0, amountMinor: 9_000_000n })).computedOutcome).toBe("auto_approve");
  });
  it("Level 1 sends every passing approval to a person", () => {
    const d = decideGate(input({ level: 1 }));
    expect(d).toMatchObject({ outcome: "needs_human", status: "pending_review", requiredRole: "reviewer" });
    expect(d.reasons).toContain("Level 1: a person approves every invoice");
  });
  it("Level 2 auto-approves passing invoices at or under the limit", () => {
    expect(decideGate(input({ amountMinor: 500_000n }))).toMatchObject({ outcome: "auto_approve", status: "auto_approved", requiredRole: null });
  });
  it("Level 2 sends invoices above the limit for review", () => {
    const d = decideGate(input({ amountMinor: 500_001n }));
    expect(d.outcome).toBe("needs_human");
    expect(d.reasons[0]).toBe("$5,000.01 is above the $5,000.00 auto-approve limit");
  });
  it("Level 2 does not auto-approve other currencies", () => {
    expect(decideGate(input({ currency: "EUR" })).outcome).toBe("needs_human");
  });
  it("Level 3 auto-approves any passing invoice", () => {
    expect(decideGate(input({ level: 3, amountMinor: 9_000_000n })).outcome).toBe("auto_approve");
  });
});

describe("gate: rules and confidence", () => {
  it("a failed review rule sends the invoice to a person with the rule's explanation", () => {
    const d = decideGate(input({ level: 3, ruleResults: [pass(), fail()] }));
    expect(d.outcome).toBe("needs_human");
    expect(d.reasons).toEqual(["Invoice is 12% above PO"]);
  });
  it("a failed block rule blocks an approval", () => {
    const d = decideGate(input({ level: 3, ruleResults: [fail({ severity: "block", explanation: "Vendor is blocked" })] }));
    expect(d).toMatchObject({ outcome: "block", status: "blocked", requiredRole: null, reasons: ["Vendor is blocked"] });
  });
  it("not-applicable results do not hold anything up", () => {
    expect(decideGate(input({ ruleResults: [{ ...pass(), result: "not_applicable" }] })).outcome).toBe("auto_approve");
  });
  it("low or missing confidence sends to a person", () => {
    expect(decideGate(input({ confidenceBps: 8499 })).reasons[0]).toBe("Agent confidence 85% is below the 85% threshold");
    expect(decideGate(input({ confidenceBps: 8500 })).outcome).toBe("auto_approve");
    expect(decideGate(input({ confidenceBps: null })).outcome).toBe("needs_human");
  });
  it("uses the highest approver role required by failed rules", () => {
    const d = decideGate(input({ ruleResults: [fail({ requiredRole: "controller" }), fail({ requiredRole: "admin" })] }));
    expect(d.requiredRole).toBe("admin");
  });
});

describe("gate: escalations and rejections", () => {
  it("an escalation always goes to a person", () => {
    for (const level of [1, 2, 3]) expect(decideGate(input({ level, proposedDecision: "escalate" })).outcome).toBe("needs_human");
  });
  it("rejections are confirmed by a person below Level 3", () => {
    expect(decideGate(input({ level: 2, proposedDecision: "reject" })).outcome).toBe("needs_human");
  });
  it("confident rejections are applied automatically at Level 3", () => {
    expect(decideGate(input({ level: 3, proposedDecision: "reject" }))).toMatchObject({ outcome: "auto_approve", status: "rejected" });
    expect(decideGate(input({ level: 3, proposedDecision: "reject", confidenceBps: 5000 })).outcome).toBe("needs_human");
  });
  it("a block rule does not block a rejection of a blocked vendor", () => {
    const d = decideGate(input({ level: 3, proposedDecision: "reject", ruleResults: [fail({ severity: "block" })] }));
    expect(d.computedOutcome).toBe("auto_approve");
  });
});
