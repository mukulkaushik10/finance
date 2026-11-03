import { z } from "zod";
import type { Role, RuleType } from "@prisma/client";
import { diffBps, formatBps, formatMoney, withinTolerance } from "@/lib/money";
import type { RuleContext, RuleDefinition, RuleOutcome } from "./types";
import { daysBetween, levenshtein, normaliseInvoiceNumber } from "./text";
import { invoiceNumberOf } from "../workflows/ap_invoice/subject";

const NA = (explanation: string): RuleOutcome => ({ result: "not_applicable", explanation });
const isInvoice = (ctx: RuleContext) => ctx.subjectType === "invoice";
const fmt = (minor: bigint, ctx: RuleContext) => formatMoney(minor, ctx.currency);

// ---------------------------------------------------------------- Three-way match

export const threeWayMatchParams = z.object({
  amountToleranceBps: z.number().int().min(0).max(10_000).describe("Allowed difference between invoice and PO amount, in basis points"),
  quantityToleranceBps: z.number().int().min(0).max(10_000).describe("Allowed shortfall between goods received and PO quantity, in basis points"),
  requirePo: z.boolean().describe("Invoices without a PO number fail the check"),
});
type ThreeWay = z.infer<typeof threeWayMatchParams>;

export const threeWayMatch: RuleDefinition<ThreeWay> = {
  type: "three_way_match",
  label: "Three-way match",
  description: "Checks that the invoice, the purchase order and the goods received note agree.",
  defaultName: "Three-way match",
  defaultSeverity: "review",
  defaultParams: { amountToleranceBps: 500, quantityToleranceBps: 0, requirePo: true },
  paramsSchema: threeWayMatchParams,
  summarize: (p) =>
    `Hold for review when the invoice differs from the PO by more than ${formatBps(p.amountToleranceBps)}, ` +
    `or goods received are more than ${formatBps(p.quantityToleranceBps)} short of the PO quantity` +
    (p.requirePo ? ", or there is no PO." : "."),
  evaluate(p, ctx) {
    if (!isInvoice(ctx)) return NA("Only applies to invoices");
    const s = ctx.subject;
    if (!s.po_number) {
      return p.requirePo
        ? { result: "fail", explanation: "The invoice has no PO number" }
        : NA("Non-PO invoice; three-way match not required");
    }
    const po = ctx.po;
    if (!po) return { result: "fail", explanation: `PO ${s.po_number} was not found in the system of record` };
    if (ctx.vendor && po.vendorCode !== ctx.vendor.code) {
      return { result: "fail", explanation: `PO ${po.poNumber} belongs to a different vendor (${po.vendorCode})` };
    }
    if (po.currency !== ctx.currency) {
      return { result: "fail", explanation: `Invoice is in ${ctx.currency} but PO ${po.poNumber} is in ${po.currency}` };
    }
    const bps = diffBps(ctx.amountMinor, po.amountMinor);
    const over = ctx.amountMinor >= po.amountMinor ? "above" : "below";
    const details = { poNumber: po.poNumber, poAmountMinor: po.amountMinor, invoiceAmountMinor: ctx.amountMinor, differenceBps: Number(bps) };
    if (!withinTolerance(ctx.amountMinor, po.amountMinor, p.amountToleranceBps)) {
      return {
        result: "fail",
        explanation: `Invoice ${fmt(ctx.amountMinor, ctx)} is ${formatBps(bps)} ${over} PO ${po.poNumber} (${fmt(po.amountMinor, ctx)}); tolerance is ${formatBps(p.amountToleranceBps)}`,
        details,
      };
    }
    if (!s.grn_number) return { result: "fail", explanation: `No goods received note for PO ${po.poNumber}`, details };
    const grn = ctx.grn;
    if (!grn) return { result: "fail", explanation: `Goods received note ${s.grn_number} was not found`, details };
    if (grn.poNumber !== po.poNumber) {
      return { result: "fail", explanation: `Goods received note ${grn.grnNumber} is for ${grn.poNumber}, not ${po.poNumber}`, details };
    }
    const shortBy = po.quantity - grn.quantityReceived;
    const qtyOk = shortBy <= 0 || BigInt(shortBy) * 10_000n <= BigInt(po.quantity) * BigInt(p.quantityToleranceBps);
    const qtyDetails = { ...details, quantityOrdered: po.quantity, quantityReceived: grn.quantityReceived };
    if (!qtyOk) {
      return {
        result: "fail",
        explanation: `Only ${grn.quantityReceived} of ${po.quantity} units received on ${grn.grnNumber}`,
        details: qtyDetails,
      };
    }
    return {
      result: "pass",
      explanation: `Invoice ${fmt(ctx.amountMinor, ctx)} is within ${formatBps(p.amountToleranceBps)} of PO ${po.poNumber}` +
        (bps > 0n ? ` (${formatBps(bps)} ${over})` : "") + ` and ${grn.quantityReceived} of ${po.quantity} units were received`,
      details: qtyDetails,
    };
  },
};

// ---------------------------------------------------------------- Approval limits

export const APPROVER_OPTIONS = ["none", "reviewer", "controller", "admin"] as const;
export const approvalLimitParams = z.object({
  currency: z.string().length(3),
  bands: z.array(z.object({
    upToMinor: z.number().int().positive().nullable().describe("Upper bound of the band (inclusive); null = no upper bound"),
    approver: z.enum(APPROVER_OPTIONS).describe("Who must approve invoices in this band; none = can be approved automatically"),
  })).min(1),
}).superRefine((p, c) => {
  for (let i = 1; i < p.bands.length; i++) {
    const prev = p.bands[i - 1].upToMinor;
    const cur = p.bands[i].upToMinor;
    if (prev === null) c.addIssue({ code: "custom", message: "Only the last band can have no upper limit", path: ["bands", i] });
    else if (cur !== null && cur <= prev) c.addIssue({ code: "custom", message: "Bands must increase", path: ["bands", i] });
  }
  if (p.bands[p.bands.length - 1].upToMinor !== null) {
    c.addIssue({ code: "custom", message: "The last band must have no upper limit", path: ["bands", p.bands.length - 1] });
  }
});
type ApprovalLimits = z.infer<typeof approvalLimitParams>;

export const APPROVER_LABEL: Record<(typeof APPROVER_OPTIONS)[number], string> = {
  none: "no approval needed", reviewer: "a reviewer", controller: "a controller", admin: "the CFO / admin",
};

function bandFor(p: ApprovalLimits, amount: bigint) {
  let lower = 0n;
  for (const b of p.bands) {
    if (b.upToMinor === null || amount <= BigInt(b.upToMinor)) return { band: b, lower };
    lower = BigInt(b.upToMinor);
  }
  return { band: p.bands[p.bands.length - 1], lower };
}

export const approvalLimit: RuleDefinition<ApprovalLimits> = {
  type: "approval_limit",
  label: "Approval limits",
  description: "Decides who must approve an invoice, based on its amount.",
  defaultName: "Approval limits",
  defaultSeverity: "review",
  defaultParams: {
    currency: "USD",
    bands: [
      { upToMinor: 1_000_000, approver: "none" },        // up to $10,000
      { upToMinor: 5_000_000, approver: "controller" },  // up to $50,000
      { upToMinor: null, approver: "admin" },            // above $50,000
    ],
  },
  paramsSchema: approvalLimitParams,
  summarize: (p) => {
    let lower = 0n;
    const parts = p.bands.map((b) => {
      const who = APPROVER_LABEL[b.approver];
      const s = b.upToMinor === null
        ? `above ${formatMoney(lower, p.currency)}: ${who}`
        : `up to ${formatMoney(BigInt(b.upToMinor), p.currency)}: ${who}`;
      if (b.upToMinor !== null) lower = BigInt(b.upToMinor);
      return s;
    });
    return `Invoices ${parts.join("; ")}.`;
  },
  evaluate(p, ctx) {
    if (!isInvoice(ctx)) return NA("Only applies to invoices");
    if (ctx.currency !== p.currency) {
      return {
        result: "fail",
        explanation: `No approval limits are set for ${ctx.currency}; a controller must approve`,
        requiredRole: "controller",
      };
    }
    const { band, lower } = bandFor(p, ctx.amountMinor);
    const range = band.upToMinor === null
      ? `above ${formatMoney(lower, p.currency)}`
      : `${formatMoney(lower, p.currency)} – ${formatMoney(BigInt(band.upToMinor), p.currency)}`;
    if (band.approver === "none") {
      return { result: "pass", explanation: `${fmt(ctx.amountMinor, ctx)} is in the ${range} band, which needs no approval`, details: { band } };
    }
    return {
      result: "fail",
      explanation: `${fmt(ctx.amountMinor, ctx)} is in the ${range} band and needs approval by ${APPROVER_LABEL[band.approver]}`,
      requiredRole: band.approver as Role,
      details: { band },
    };
  },
};

// ---------------------------------------------------------------- Duplicate detection

export const duplicateParams = z.object({
  windowDays: z.number().int().min(0).max(365).describe("Same vendor and amount within this many days counts as a duplicate"),
  fuzzyInvoiceNumber: z.boolean().describe("Also match invoice numbers that differ only in formatting (e.g. INV-0123 vs 123A)"),
});
type Dup = z.infer<typeof duplicateParams>;

export const duplicateInvoice: RuleDefinition<Dup> = {
  type: "duplicate_invoice",
  label: "Duplicate invoice check",
  description: "Looks for an earlier invoice from the same vendor that this one repeats.",
  defaultName: "Duplicate invoice check",
  defaultSeverity: "review",
  defaultParams: { windowDays: 30, fuzzyInvoiceNumber: true },
  paramsSchema: duplicateParams,
  summarize: (p) =>
    `Hold for review when the same vendor has billed the same amount within ${p.windowDays} days` +
    (p.fuzzyInvoiceNumber ? ", or the invoice number looks like one already received." : ", or the invoice number was already received."),
  evaluate(p, ctx) {
    if (!isInvoice(ctx)) return NA("Only applies to invoices");
    const me = ctx.subject;
    const myNumber = invoiceNumberOf(me);
    const myNorm = normaliseInvoiceNumber(myNumber);
    const matches: { ref: string; reason: string }[] = [];
    for (const prior of ctx.priorInvoices) {
      if (prior.ref === me.invoice_id) continue;
      const days = daysBetween(prior.invoiceDate, me.invoice_date);
      if (prior.amountMinor === ctx.amountMinor && prior.currency === ctx.currency && days <= p.windowDays) {
        matches.push({ ref: prior.ref, reason: `same vendor and amount as ${prior.ref} dated ${prior.invoiceDate} (${days} day${days === 1 ? "" : "s"} apart)` });
        continue;
      }
      if (prior.invoiceNumber === myNumber) {
        matches.push({ ref: prior.ref, reason: `invoice number "${myNumber}" was already received on ${prior.ref}` });
        continue;
      }
      if (p.fuzzyInvoiceNumber) {
        const pn = normaliseInvoiceNumber(prior.invoiceNumber);
        // Same core number, or same amount and a one-character slip in a number long enough to be meaningful.
        const slip = prior.amountMinor === ctx.amountMinor && Math.min(pn.length, myNorm.length) >= 4 && levenshtein(pn, myNorm) <= 1;
        if (pn === myNorm || slip) {
          matches.push({ ref: prior.ref, reason: `invoice number "${myNumber}" looks the same as "${prior.invoiceNumber}" on ${prior.ref}` });
        }
      }
    }
    if (matches.length) {
      const first = matches[0];
      return {
        result: "fail",
        explanation: `Possible duplicate: ${first.reason}` + (matches.length > 1 ? ` (+${matches.length - 1} more)` : ""),
        details: { matches: matches.slice(0, 5) },
      };
    }
    return {
      result: "pass",
      explanation: `No earlier invoice from this vendor with the same amount within ${p.windowDays} days or a matching invoice number`,
      details: { comparedWith: ctx.priorInvoices.length },
    };
  },
};

// ---------------------------------------------------------------- Bank details change

export const bankChangeParams = z.object({
  lookbackDays: z.number().int().min(1).max(730).describe("Payments within this many days of a bank detail change need review"),
  reviewNewVendors: z.boolean().describe("Vendors not yet in the vendor master need review"),
});
type Bank = z.infer<typeof bankChangeParams>;

export const bankDetailsChange: RuleDefinition<Bank> = {
  type: "bank_details_change",
  label: "Bank detail change review",
  description: "Sends invoices to a person when the vendor is new or its bank details changed recently.",
  defaultName: "New or changed bank details",
  defaultSeverity: "review",
  lockedByDefault: true,
  defaultParams: { lookbackDays: 90, reviewNewVendors: true },
  paramsSchema: bankChangeParams,
  summarize: (p) =>
    `Always send to a person when the bank details differ from the vendor record or changed in the last ${p.lookbackDays} days` +
    (p.reviewNewVendors ? ", or the vendor is new." : "."),
  evaluate(p, ctx) {
    if (!isInvoice(ctx)) return NA("Only applies to invoices");
    const v = ctx.vendor;
    if (!v) {
      return p.reviewNewVendors
        ? { result: "fail", explanation: `"${ctx.subject.vendor_name}" is not in the vendor master; a new vendor's first payment needs review` }
        : NA("Vendor not in vendor master");
    }
    const fp = ctx.subject.bank_account?.fingerprint;
    if (fp && fp !== v.bankFingerprint) {
      return { result: "fail", explanation: `The bank details on this invoice don't match the details on file for ${v.name}`, details: { onFile: v.bankFingerprint, onInvoice: fp } };
    }
    if (v.bankChangedAt && v.bankChangedAt.getTime() <= ctx.asOf.getTime()) {
      const days = daysBetween(v.bankChangedAt, ctx.asOf);
      if (days <= p.lookbackDays) {
        return {
          result: "fail",
          explanation: `${v.name} changed its bank details on ${v.bankChangedAt.toISOString().slice(0, 10)} (${days} days ago); payments within ${p.lookbackDays} days of a change need review`,
          details: { bankChangedAt: v.bankChangedAt },
        };
      }
    }
    return { result: "pass", explanation: `Bank details match the vendor record and have not changed in the last ${p.lookbackDays} days` };
  },
};

// ---------------------------------------------------------------- Blocked vendors

export const blockedVendorParams = z.object({
  additionalBlockedNames: z.array(z.string()).describe("Vendor names blocked in addition to vendors flagged in the vendor master"),
});
type Blocked = z.infer<typeof blockedVendorParams>;

export const blockedVendor: RuleDefinition<Blocked> = {
  type: "blocked_vendor",
  label: "Blocked vendor list",
  description: "Stops payment to vendors on the blocked list.",
  defaultName: "Blocked vendors",
  defaultSeverity: "block",
  defaultParams: { additionalBlockedNames: [] },
  paramsSchema: blockedVendorParams,
  summarize: (p) =>
    `Stop the invoice when the vendor is blocked in the vendor master` +
    (p.additionalBlockedNames.length ? ` or is one of: ${p.additionalBlockedNames.join(", ")}.` : "."),
  evaluate(p, ctx) {
    if (!isInvoice(ctx)) return NA("Only applies to invoices");
    if (ctx.vendor?.blocked) {
      return { result: "fail", explanation: `${ctx.vendor.name} is blocked: ${ctx.vendor.blockedReason ?? "no reason recorded"}` };
    }
    const name = ctx.subject.vendor_name.trim().toLowerCase();
    const hit = p.additionalBlockedNames.find((n) => n.trim().toLowerCase() === name);
    if (hit) return { result: "fail", explanation: `${ctx.subject.vendor_name} is on the blocked vendor list` };
    return { result: "pass", explanation: "Vendor is not on the blocked list" };
  },
};

// ---------------------------------------------------------------- Custom condition

export const CONDITION_FIELDS = {
  amount: { label: "Invoice amount", kind: "money" },
  vendor_name: { label: "Vendor name", kind: "text" },
  vendor_category: { label: "Vendor category", kind: "text" },
  gl_code: { label: "GL code chosen by the agent", kind: "text" },
  expected_gl_code: { label: "Vendor's usual GL code", kind: "text" },
  decision: { label: "Agent's decision", kind: "decision" },
  confidence: { label: "Agent's confidence (%)", kind: "percent" },
  invoice_age_days: { label: "Days since invoice date", kind: "number" },
  currency: { label: "Currency", kind: "text" },
  has_po: { label: "Has a PO number", kind: "boolean" },
} as const;
export type ConditionField = keyof typeof CONDITION_FIELDS;

export const OPERATORS = {
  gt: "is more than", gte: "is at least", lt: "is less than", lte: "is at most",
  eq: "is", neq: "is not", contains: "contains", in: "is one of",
} as const;
export type Operator = keyof typeof OPERATORS;

export const OPERATORS_BY_KIND: Record<string, Operator[]> = {
  money: ["gt", "gte", "lt", "lte", "eq", "neq"],
  number: ["gt", "gte", "lt", "lte", "eq", "neq"],
  percent: ["gt", "gte", "lt", "lte"],
  text: ["eq", "neq", "contains", "in"],
  decision: ["eq", "neq"],
  boolean: ["eq"],
};

const conditionSchema = z.object({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [ConditionField, ...ConditionField[]]),
  operator: z.enum(Object.keys(OPERATORS) as [Operator, ...Operator[]]),
  /** money: minor units as a string; percent: whole percent; boolean: "true"/"false"; in: comma separated */
  value: z.string(),
}).superRefine((c, ctx) => {
  const kind = CONDITION_FIELDS[c.field].kind;
  if (!OPERATORS_BY_KIND[kind].includes(c.operator)) {
    ctx.addIssue({ code: "custom", message: `"${OPERATORS[c.operator]}" can't be used with ${CONDITION_FIELDS[c.field].label}` });
  }
  if ((kind === "money" || kind === "number" || kind === "percent") && !/^-?\d+$/.test(c.value)) {
    ctx.addIssue({ code: "custom", message: `${CONDITION_FIELDS[c.field].label} needs a whole number` });
  }
});

export const customConditionParams = z.object({
  match: z.enum(["all", "any"]),
  conditions: z.array(conditionSchema).min(1).max(10),
  message: z.string().min(3).max(300).describe("Shown to reviewers when the rule fails"),
  requiredApprover: z.enum(["reviewer", "controller", "admin"]).nullable(),
});
type Custom = z.infer<typeof customConditionParams>;

function fieldValue(field: ConditionField, ctx: RuleContext): string | bigint | number | boolean | null {
  switch (field) {
    case "amount": return ctx.amountMinor;
    case "vendor_name": return ctx.subject.vendor_name;
    case "vendor_category": return ctx.vendor?.category ?? null;
    case "gl_code": return ctx.proposed.glCode;
    case "expected_gl_code": return ctx.vendor?.defaultGlCode ?? null;
    case "decision": return ctx.proposed.decision;
    case "confidence": return ctx.proposed.confidenceBps === null ? null : ctx.proposed.confidenceBps;
    case "invoice_age_days": return daysBetween(ctx.subject.invoice_date, ctx.asOf);
    case "currency": return ctx.currency;
    case "has_po": return Boolean(ctx.subject.po_number);
  }
}

export function conditionHolds(c: z.infer<typeof conditionSchema>, ctx: RuleContext): boolean {
  const kind = CONDITION_FIELDS[c.field].kind;
  const actual = fieldValue(c.field, ctx);
  if (actual === null) return false;
  if (kind === "money" || kind === "number" || kind === "percent") {
    const a = typeof actual === "bigint" ? actual : BigInt(actual as number);
    const v = kind === "percent" ? BigInt(c.value) * 100n : BigInt(c.value); // percent -> bps
    switch (c.operator) {
      case "gt": return a > v;
      case "gte": return a >= v;
      case "lt": return a < v;
      case "lte": return a <= v;
      case "eq": return a === v;
      case "neq": return a !== v;
      default: return false;
    }
  }
  if (kind === "boolean") return String(actual) === c.value;
  const a = String(actual).toLowerCase();
  const v = c.value.toLowerCase();
  switch (c.operator) {
    case "eq": return a === v;
    case "neq": return a !== v;
    case "contains": return a.includes(v);
    case "in": return v.split(",").map((x) => x.trim()).includes(a);
    default: return false;
  }
}

export function describeCondition(c: z.infer<typeof conditionSchema>, currency = "USD"): string {
  const f = CONDITION_FIELDS[c.field];
  let value = c.value;
  if (f.kind === "money") value = formatMoney(BigInt(c.value), currency);
  if (f.kind === "percent") value = `${c.value}%`;
  if (f.kind === "boolean") return `${f.label.toLowerCase()} ${c.value === "true" ? "is yes" : "is no"}`;
  return `${f.label.toLowerCase()} ${OPERATORS[c.operator]} ${value}`;
}

export const customCondition: RuleDefinition<Custom> = {
  type: "custom_condition",
  label: "Custom condition",
  description: "Your own rule, built from fields and conditions.",
  defaultName: "Custom rule",
  defaultSeverity: "review",
  defaultParams: {
    match: "all",
    conditions: [{ field: "amount", operator: "gt", value: "2500000" }],
    message: "Large invoice needs a second look",
    requiredApprover: null,
  },
  paramsSchema: customConditionParams,
  summarize: (p) => {
    const joiner = p.match === "all" ? " and " : " or ";
    return `When ${p.conditions.map((c) => describeCondition(c)).join(joiner)}: “${p.message}”.`;
  },
  evaluate(p, ctx) {
    const results = p.conditions.map((c) => conditionHolds(c, ctx));
    const hit = p.match === "all" ? results.every(Boolean) : results.some(Boolean);
    if (!hit) return { result: "pass", explanation: "Conditions not met" };
    return {
      result: "fail",
      explanation: p.message,
      requiredRole: p.requiredApprover ?? undefined,
      details: { matched: p.conditions.filter((_, i) => results[i]).map((c) => describeCondition(c, ctx.currency)) },
    };
  },
};

// ---------------------------------------------------------------- Registry

export const RULE_DEFINITIONS: Record<RuleType, RuleDefinition<any>> = {
  three_way_match: threeWayMatch,
  approval_limit: approvalLimit,
  duplicate_invoice: duplicateInvoice,
  bank_details_change: bankDetailsChange,
  blocked_vendor: blockedVendor,
  custom_condition: customCondition,
};

/** The default rule set shipped for an AP invoice workflow, in display order. */
export const DEFAULT_AP_RULES: RuleType[] = [
  "blocked_vendor", "bank_details_change", "duplicate_invoice", "three_way_match", "approval_limit",
];
