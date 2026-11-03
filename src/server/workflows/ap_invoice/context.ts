import type { Decision } from "@prisma/client";
import type { OrgDb } from "../../db/dal";
import type { ErpConnector } from "../../connectors/erp";
import type { GoodsReceiptRecord, PriorInvoice, PurchaseOrderRecord, RuleContext, VendorRecord } from "../../rules/types";
import { invoiceNumberOf, type InvoiceSubject } from "./subject";

/** Where a rule context gets its reference data. Live calls use the ERP + action history; replays use memory. */
export interface ContextLookup {
  vendor(subject: InvoiceSubject): Promise<VendorRecord | null> | VendorRecord | null;
  po(poNumber: string): Promise<PurchaseOrderRecord | null> | PurchaseOrderRecord | null;
  grn(grnNumber: string): Promise<GoodsReceiptRecord | null> | GoodsReceiptRecord | null;
  priorInvoices(vendorKey: string, subject: InvoiceSubject): Promise<PriorInvoice[]> | PriorInvoice[];
}

export function vendorKeyOf(subject: InvoiceSubject, vendor: VendorRecord | null): string {
  return vendor?.code ?? subject.vendor_id ?? subject.vendor_name.trim().toLowerCase();
}

export async function buildInvoiceContext(
  subject: InvoiceSubject,
  proposed: { decision: Decision; glCode: string | null; confidenceBps: number | null },
  lookup: ContextLookup,
  asOf: Date,
): Promise<{ ctx: RuleContext; vendorKey: string }> {
  const vendor = await lookup.vendor(subject);
  const [po, grn] = await Promise.all([
    subject.po_number ? lookup.po(subject.po_number) : null,
    subject.grn_number ? lookup.grn(subject.grn_number) : null,
  ]);
  const vendorKey = vendorKeyOf(subject, vendor);
  const priorInvoices = await lookup.priorInvoices(vendorKey, subject);
  return {
    vendorKey,
    ctx: {
      workflowType: "ap_invoice",
      subjectType: "invoice",
      subject,
      amountMinor: BigInt(subject.amount.minor),
      currency: subject.amount.currency.toUpperCase(),
      proposed,
      vendor, po, grn, priorInvoices, asOf,
    },
  };
}

/** Live lookup: ERP connector for master data, earlier actions for duplicate history. */
export function liveLookup(db: OrgDb, erp: ErpConnector, workflowId: string): ContextLookup {
  return {
    vendor: (s) => erp.findVendor({ code: s.vendor_id, name: s.vendor_name }),
    po: (n) => erp.getPurchaseOrder(n),
    grn: (n) => erp.getGoodsReceipt(n),
    async priorInvoices(vendorKey, s) {
      const since = new Date(Date.parse(s.invoice_date + "T00:00:00Z") - 365 * 86_400_000);
      const rows = await db.action.findMany({
        where: { workflowId, source: "live", counterpartyKey: vendorKey, occurredOn: { gte: since }, externalRef: { not: s.invoice_id } },
        select: { externalRef: true, amountMinor: true, currency: true, occurredOn: true, payload: true },
        orderBy: { createdAt: "desc" },
        take: 500,
      });
      return rows.map((r) => {
        const p = r.payload as unknown as InvoiceSubject;
        return {
          ref: r.externalRef,
          invoiceNumber: invoiceNumberOf(p),
          amountMinor: r.amountMinor,
          currency: r.currency,
          invoiceDate: p.invoice_date,
        };
      });
    },
  };
}
