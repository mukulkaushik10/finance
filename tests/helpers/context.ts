import type { RuleContext, VendorRecord } from "@/server/rules/types";
import type { InvoiceSubject } from "@/server/workflows/ap_invoice/subject";

export const vendor = (over: Partial<VendorRecord> = {}): VendorRecord => ({
  code: "V-0001", name: "Acme Supplies", category: "Office supplies", defaultGlCode: "6100",
  bankFingerprint: "sha256:abc", bankChangedAt: null, blocked: false, blockedReason: null, ...over,
});

export const subject = (over: Partial<InvoiceSubject> = {}): InvoiceSubject => ({
  type: "invoice", invoice_id: "INV-1", invoice_number: "INV-1", vendor_id: "V-0001", vendor_name: "Acme Supplies",
  amount: { minor: 100_000, currency: "USD" }, po_number: "PO-1", grn_number: "GRN-1", invoice_date: "2026-10-01",
  bank_account: null, ...over,
});

/** A clean, fully matching invoice context; override what each test needs. */
export function ctx(over: Partial<RuleContext> = {}, subj: Partial<InvoiceSubject> = {}): RuleContext {
  const s = subject(subj);
  return {
    workflowType: "ap_invoice",
    subjectType: "invoice",
    subject: s,
    amountMinor: BigInt(s.amount.minor),
    currency: s.amount.currency,
    proposed: { decision: "approve", glCode: "6100", confidenceBps: 9500 },
    vendor: vendor(),
    po: { poNumber: "PO-1", vendorCode: "V-0001", amountMinor: 100_000n, currency: "USD", quantity: 10, unitPriceMinor: 10_000n },
    grn: { grnNumber: "GRN-1", poNumber: "PO-1", quantityReceived: 10, receivedAt: new Date("2026-09-28") },
    priorInvoices: [],
    asOf: new Date("2026-10-02T12:00:00Z"),
    ...over,
  };
}
