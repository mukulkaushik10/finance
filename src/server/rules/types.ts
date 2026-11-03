import type { z } from "zod";
import type { Decision, Role, RuleResultValue, RuleSeverity, RuleType } from "@prisma/client";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";

export interface VendorRecord {
  code: string;
  name: string;
  category: string;
  defaultGlCode: string;
  bankFingerprint: string;
  bankChangedAt: Date | null;
  blocked: boolean;
  blockedReason: string | null;
}
export interface PurchaseOrderRecord {
  poNumber: string; vendorCode: string; amountMinor: bigint; currency: string; quantity: number; unitPriceMinor: bigint;
}
export interface GoodsReceiptRecord { grnNumber: string; poNumber: string; quantityReceived: number; receivedAt: Date }
export interface PriorInvoice {
  ref: string;           // invoice_id
  invoiceNumber: string;
  amountMinor: bigint;
  currency: string;
  invoiceDate: string;   // YYYY-MM-DD
}

/** Everything a rule may look at. Pre-loaded, so rule evaluation is pure and synchronous. */
export interface RuleContext {
  workflowType: "ap_invoice";
  subjectType: string;
  subject: InvoiceSubject;
  amountMinor: bigint;
  currency: string;
  proposed: { decision: Decision; glCode: string | null; confidenceBps: number | null };
  vendor: VendorRecord | null;
  po: PurchaseOrderRecord | null;
  grn: GoodsReceiptRecord | null;
  priorInvoices: PriorInvoice[]; // earlier invoices from the same vendor
  /** The moment the payment would happen: now for live calls, the invoice date for replays. */
  asOf: Date;
}

export interface RuleOutcome {
  result: RuleResultValue;
  explanation: string;
  details?: Record<string, unknown>;
  /** Minimum approver role, set by approval-limit style rules. */
  requiredRole?: Role;
}

export interface RuleDefinition<P = unknown> {
  type: RuleType;
  label: string;
  description: string;
  defaultName: string;
  defaultSeverity: RuleSeverity;
  defaultParams: P;
  /** Some rules (e.g. bank detail changes) can be tuned but never switched off. */
  lockedByDefault?: boolean;
  paramsSchema: z.ZodType<P>;
  /** One plain-language sentence describing what the rule does with these settings. */
  summarize(params: P): string;
  evaluate(params: P, ctx: RuleContext): RuleOutcome;
}

export interface ActiveRule {
  ruleId: string;
  ruleVersionId: string;
  version: number;
  name: string;
  type: RuleType;
  severity: RuleSeverity;
  enabled: boolean;
  params: unknown;
}

export interface EvaluatedRule extends RuleOutcome {
  ruleId: string;
  ruleVersionId: string;
  version: number;
  name: string;
  type: RuleType;
  severity: RuleSeverity;
}
