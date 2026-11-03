import { describe, expect, it } from "vitest";
import {
  approvalLimit, bankDetailsChange, blockedVendor, customCondition, duplicateInvoice, threeWayMatch, RULE_DEFINITIONS,
} from "@/server/rules/definitions";
import { evaluateRules, highestRole, ruleSetVersion } from "@/server/rules/engine";
import { normaliseInvoiceNumber, levenshtein } from "@/server/rules/text";
import type { ActiveRule } from "@/server/rules/types";
import { ctx, vendor } from "../helpers/context";

describe("three-way match", () => {
  const p = threeWayMatch.defaultParams; // 5% amount tolerance, 0% quantity shortfall, PO required

  it("passes when invoice, PO and goods received agree", () => {
    const r = threeWayMatch.evaluate(p, ctx());
    expect(r.result).toBe("pass");
    expect(r.explanation).toContain("10 of 10 units");
  });
  it("passes within tolerance (exactly 5% over)", () => {
    expect(threeWayMatch.evaluate(p, ctx({}, { amount: { minor: 105_000, currency: "USD" } })).result).toBe("pass");
  });
  it("fails just above tolerance and explains by how much", () => {
    const r = threeWayMatch.evaluate(p, ctx({}, { amount: { minor: 105_001, currency: "USD" } }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toMatch(/5\.0% above PO PO-1 \(\$1,000\.00\); tolerance is 5\.0%/);
  });
  it("fails when under-invoiced beyond tolerance too", () => {
    expect(threeWayMatch.evaluate(p, ctx({}, { amount: { minor: 90_000, currency: "USD" } })).result).toBe("fail");
  });
  it("fails without a PO number when a PO is required, not applicable otherwise", () => {
    expect(threeWayMatch.evaluate(p, ctx({}, { po_number: null })).result).toBe("fail");
    expect(threeWayMatch.evaluate({ ...p, requirePo: false }, ctx({}, { po_number: null })).result).toBe("not_applicable");
  });
  it("fails when the PO does not exist", () => {
    const r = threeWayMatch.evaluate(p, ctx({ po: null }, { po_number: "PO-404" }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toContain("PO-404 was not found");
  });
  it("fails when the PO belongs to another vendor", () => {
    const c = ctx();
    c.po = { ...c.po!, vendorCode: "V-9999" };
    expect(threeWayMatch.evaluate(p, c).explanation).toContain("different vendor");
  });
  it("fails on currency mismatch", () => {
    const c = ctx();
    c.po = { ...c.po!, currency: "EUR" };
    expect(threeWayMatch.evaluate(p, c).result).toBe("fail");
  });
  it("fails without a goods received note", () => {
    expect(threeWayMatch.evaluate(p, ctx({}, { grn_number: null })).explanation).toContain("No goods received note");
    expect(threeWayMatch.evaluate(p, ctx({ grn: null })).explanation).toContain("was not found");
  });
  it("fails on short receipt, unless within quantity tolerance", () => {
    const c = ctx();
    c.grn = { ...c.grn!, quantityReceived: 9 };
    expect(threeWayMatch.evaluate(p, c).explanation).toBe("Only 9 of 10 units received on GRN-1");
    expect(threeWayMatch.evaluate({ ...p, quantityToleranceBps: 1000 }, c).result).toBe("pass");
  });
  it("does not apply to non-invoice subjects", () => {
    expect(threeWayMatch.evaluate(p, ctx({ subjectType: "refund" })).result).toBe("not_applicable");
  });
  it("summarises in plain language", () => {
    expect(threeWayMatch.summarize(p)).toBe(
      "Hold for review when the invoice differs from the PO by more than 5.0%, or goods received are more than 0.0% short of the PO quantity, or there is no PO.",
    );
  });
});

describe("approval limits", () => {
  const p = approvalLimit.defaultParams; // <= $10k none, <= $50k controller, above: admin

  it("passes in the no-approval band", () => {
    const r = approvalLimit.evaluate(p, ctx({ amountMinor: 1_000_000n }));
    expect(r.result).toBe("pass");
    expect(r.requiredRole).toBeUndefined();
  });
  it("requires a controller between $10k and $50k (band edges inclusive)", () => {
    const r = approvalLimit.evaluate(p, ctx({ amountMinor: 1_000_001n }));
    expect(r.result).toBe("fail");
    expect(r.requiredRole).toBe("controller");
    expect(r.explanation).toContain("$10,000.00 – $50,000.00 band");
    expect(approvalLimit.evaluate(p, ctx({ amountMinor: 5_000_000n })).requiredRole).toBe("controller");
  });
  it("requires admin/CFO above $50k", () => {
    expect(approvalLimit.evaluate(p, ctx({ amountMinor: 5_000_001n })).requiredRole).toBe("admin");
  });
  it("lowering the limit changes the result", () => {
    const lowered = { ...p, bands: [{ upToMinor: 200_000, approver: "none" as const }, ...p.bands.slice(1)] };
    expect(approvalLimit.evaluate(p, ctx({ amountMinor: 500_000n })).result).toBe("pass");
    expect(approvalLimit.evaluate(lowered, ctx({ amountMinor: 500_000n })).result).toBe("fail");
  });
  it("fails safe for a currency with no limits", () => {
    const r = approvalLimit.evaluate(p, ctx({ currency: "EUR" }));
    expect(r.result).toBe("fail");
    expect(r.requiredRole).toBe("controller");
  });
  it("validates band order", () => {
    expect(approvalLimit.paramsSchema.safeParse({ currency: "USD", bands: [{ upToMinor: 500, approver: "none" }, { upToMinor: 100, approver: "controller" }, { upToMinor: null, approver: "admin" }] }).success).toBe(false);
    expect(approvalLimit.paramsSchema.safeParse({ currency: "USD", bands: [{ upToMinor: 500, approver: "none" }] }).success).toBe(false);
  });
  it("summarises in plain language", () => {
    expect(approvalLimit.summarize(p)).toBe("Invoices up to $10,000.00: no approval needed; up to $50,000.00: a controller; above $50,000.00: the CFO / admin.");
  });
});

describe("duplicate detection", () => {
  const p = duplicateInvoice.defaultParams; // 30 days, fuzzy on
  const prior = (over = {}) => ({ ref: "INV-0", invoiceNumber: "INV-0", amountMinor: 100_000n, currency: "USD", invoiceDate: "2026-09-25", ...over });

  it("passes with no history", () => {
    expect(duplicateInvoice.evaluate(p, ctx()).result).toBe("pass");
  });
  it("flags same vendor + same amount within N days", () => {
    const r = duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior()] }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toContain("same vendor and amount as INV-0 dated 2026-09-25 (6 days apart)");
  });
  it("ignores same amount outside the window", () => {
    expect(duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior({ invoiceDate: "2026-08-01" })] })).result).toBe("pass");
    expect(duplicateInvoice.evaluate({ ...p, windowDays: 90 }, ctx({ priorInvoices: [prior({ invoiceDate: "2026-08-01" })] })).result).toBe("fail");
  });
  it("flags an exact repeated invoice number regardless of amount or date", () => {
    const r = duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior({ invoiceNumber: "INV-1", amountMinor: 5n, invoiceDate: "2025-01-01" })] }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toContain('invoice number "INV-1" was already received');
  });
  it("fuzzy-matches reformatted invoice numbers", () => {
    for (const n of ["1", "INV-0001", "inv 1", "INV-1A"]) {
      const r = duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior({ invoiceNumber: n, amountMinor: 7n, invoiceDate: "2025-01-01" })] }));
      expect(r.result, n).toBe("fail");
    }
  });
  it("does not fuzzy-match when switched off", () => {
    const c = ctx({ priorInvoices: [prior({ invoiceNumber: "0001", amountMinor: 7n, invoiceDate: "2025-01-01" })] });
    expect(duplicateInvoice.evaluate({ ...p, fuzzyInvoiceNumber: false }, c).result).toBe("pass");
  });
  it("does not treat sequential invoice numbers as duplicates", () => {
    const r = duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior({ invoiceNumber: "INV-2", amountMinor: 55_555n })] }));
    expect(r.result).toBe("pass");
  });
  it("ignores itself", () => {
    expect(duplicateInvoice.evaluate(p, ctx({ priorInvoices: [prior({ ref: "INV-1", invoiceNumber: "INV-1" })] })).result).toBe("pass");
  });
  it("normalises invoice numbers", () => {
    expect(normaliseInvoiceNumber("INV-0010432")).toBe("10432");
    expect(normaliseInvoiceNumber("10432A")).toBe("10432");
    expect(normaliseInvoiceNumber("1O432")).toBe("10432");
    expect(levenshtein("10432", "10433")).toBe(1);
  });
});

describe("bank details change", () => {
  const p = bankDetailsChange.defaultParams; // 90 days, new vendors reviewed

  it("passes for a known vendor with unchanged details", () => {
    expect(bankDetailsChange.evaluate(p, ctx()).result).toBe("pass");
  });
  it("fails when the details changed within the lookback", () => {
    const r = bankDetailsChange.evaluate(p, ctx({ vendor: vendor({ bankChangedAt: new Date("2026-09-01T00:00:00Z") }) }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toContain("changed its bank details on 2026-09-01");
  });
  it("passes when the change was longer ago than the lookback", () => {
    expect(bankDetailsChange.evaluate(p, ctx({ vendor: vendor({ bankChangedAt: new Date("2026-05-01T00:00:00Z") }) })).result).toBe("pass");
  });
  it("ignores a change dated after the payment", () => {
    expect(bankDetailsChange.evaluate(p, ctx({ vendor: vendor({ bankChangedAt: new Date("2026-12-01T00:00:00Z") }) })).result).toBe("pass");
  });
  it("fails when invoice bank details differ from the vendor record", () => {
    const r = bankDetailsChange.evaluate(p, ctx({}, { bank_account: { fingerprint: "sha256:other" } }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toContain("don't match");
  });
  it("fails for new vendors (configurable)", () => {
    expect(bankDetailsChange.evaluate(p, ctx({ vendor: null })).result).toBe("fail");
    expect(bankDetailsChange.evaluate({ ...p, reviewNewVendors: false }, ctx({ vendor: null })).result).toBe("not_applicable");
  });
  it("is a mandatory control by default", () => {
    expect(bankDetailsChange.lockedByDefault).toBe(true);
  });
});

describe("blocked vendors", () => {
  const p = blockedVendor.defaultParams;
  it("passes for a normal vendor", () => {
    expect(blockedVendor.evaluate(p, ctx()).result).toBe("pass");
  });
  it("fails for a vendor blocked in the vendor master, with the reason", () => {
    const r = blockedVendor.evaluate(p, ctx({ vendor: vendor({ blocked: true, blockedReason: "Failed sanctions screening" }) }));
    expect(r.result).toBe("fail");
    expect(r.explanation).toBe("Acme Supplies is blocked: Failed sanctions screening");
  });
  it("fails for a name on the extra blocked list (case-insensitive)", () => {
    expect(blockedVendor.evaluate({ additionalBlockedNames: ["acme SUPPLIES "] }, ctx()).result).toBe("fail");
  });
  it("blocks rather than reviews by default", () => {
    expect(blockedVendor.defaultSeverity).toBe("block");
  });
});

describe("custom condition", () => {
  const base = customCondition.defaultParams;
  it("fails when all conditions hold", () => {
    const params = { ...base, conditions: [{ field: "amount" as const, operator: "gt" as const, value: "50000" }, { field: "vendor_category" as const, operator: "eq" as const, value: "office supplies" }] };
    const r = customCondition.evaluate(params, ctx());
    expect(r.result).toBe("fail");
    expect(r.explanation).toBe(base.message);
  });
  it("passes when one of 'all' conditions does not hold, fails for 'any'", () => {
    const conditions = [{ field: "amount" as const, operator: "gt" as const, value: "50000" }, { field: "currency" as const, operator: "eq" as const, value: "EUR" }];
    expect(customCondition.evaluate({ ...base, match: "all", conditions }, ctx()).result).toBe("pass");
    expect(customCondition.evaluate({ ...base, match: "any", conditions }, ctx()).result).toBe("fail");
  });
  it("supports GL mismatch, confidence and 'is one of'", () => {
    const c = ctx({ proposed: { decision: "approve", glCode: "6400", confidenceBps: 8000 } });
    expect(customCondition.evaluate({ ...base, conditions: [{ field: "gl_code", operator: "neq", value: "6100" }] }, c).result).toBe("fail");
    expect(customCondition.evaluate({ ...base, conditions: [{ field: "confidence", operator: "lt", value: "85" }] }, c).result).toBe("fail");
    expect(customCondition.evaluate({ ...base, conditions: [{ field: "gl_code", operator: "in", value: "6100, 6200" }] }, c).result).toBe("pass");
  });
  it("can require a specific approver", () => {
    expect(customCondition.evaluate({ ...base, requiredApprover: "controller", conditions: [{ field: "has_po", operator: "eq", value: "true" }] }, ctx()).requiredRole).toBe("controller");
  });
  it("rejects operators that don't fit the field", () => {
    expect(customCondition.paramsSchema.safeParse({ ...base, conditions: [{ field: "amount", operator: "contains", value: "1" }] }).success).toBe(false);
    expect(customCondition.paramsSchema.safeParse({ ...base, conditions: [{ field: "amount", operator: "gt", value: "12.5" }] }).success).toBe(false);
  });
  it("summarises in plain language", () => {
    expect(customCondition.summarize(base)).toBe("When invoice amount is more than $25,000.00: “Large invoice needs a second look”.");
  });
});

describe("rule engine", () => {
  const rule = (over: Partial<ActiveRule>): ActiveRule => ({
    ruleId: "r1", ruleVersionId: "rv1", version: 1, name: "Blocked", type: "blocked_vendor", severity: "block", enabled: true,
    params: { additionalBlockedNames: [] }, ...over,
  });
  it("records switched-off rules as not applicable", () => {
    const [r] = evaluateRules([rule({ enabled: false })], ctx({ vendor: vendor({ blocked: true }) }));
    expect(r.result).toBe("not_applicable");
    expect(r.explanation).toBe("This rule is switched off");
  });
  it("fails safe on invalid settings", () => {
    const [r] = evaluateRules([rule({ params: { nope: 1 } })], ctx());
    expect(r.result).toBe("fail");
  });
  it("keeps the rule version on every result", () => {
    const [r] = evaluateRules([rule({ version: 7, ruleVersionId: "rv7" })], ctx());
    expect(r).toMatchObject({ version: 7, ruleVersionId: "rv7", result: "pass" });
  });
  it("every default rule's defaults are valid", () => {
    for (const def of Object.values(RULE_DEFINITIONS)) {
      expect(def.paramsSchema.safeParse(def.defaultParams).success, def.type).toBe(true);
    }
  });
  it("picks the highest approver role and fingerprints the rule set", () => {
    expect(highestRole(["reviewer", undefined, "admin", "controller"])).toBe("admin");
    expect(ruleSetVersion([rule({ ruleId: "a", version: 2 }), rule({ ruleId: "b", enabled: false })])).toBe("a@2,b@1:off");
  });
});
