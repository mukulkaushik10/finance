import type { OrgDb } from "../db/dal";
import type { GoodsReceiptRecord, PurchaseOrderRecord, VendorRecord } from "../rules/types";

// System-of-record connector. The MVP ships one fake implementation backed by local tables,
// presented as QuickBooks / Xero / NetSuite. A real connector implements the same interface.

export interface ErpConnector {
  readonly id: string;
  readonly label: string;
  readonly isDemo: boolean;
  findVendor(ref: { code?: string | null; name: string }): Promise<VendorRecord | null>;
  getPurchaseOrder(poNumber: string): Promise<PurchaseOrderRecord | null>;
  getGoodsReceipt(grnNumber: string): Promise<GoodsReceiptRecord | null>;
  /** Write-back seam. The fake records nothing and returns a made-up reference. */
  postApprovedInvoice(input: { invoiceId: string; amountMinor: bigint; currency: string; glCode: string | null }): Promise<{ externalRef: string }>;
}

export const ERP_CONNECTORS = {
  fake_quickbooks: "QuickBooks Online (demo data)",
  fake_xero: "Xero (demo data)",
  fake_netsuite: "NetSuite (demo data)",
} as const;
export type ErpConnectorId = keyof typeof ERP_CONNECTORS;

class FakeErpConnector implements ErpConnector {
  readonly isDemo = true;
  constructor(readonly id: ErpConnectorId, private db: OrgDb) {}
  get label() { return ERP_CONNECTORS[this.id]; }

  async findVendor(ref: { code?: string | null; name: string }) {
    const v = ref.code
      ? await this.db.vendor.findFirst({ where: { code: ref.code } })
      : await this.db.vendor.findFirst({ where: { name: { equals: ref.name.trim(), mode: "insensitive" } } });
    return v ? toVendorRecord(v) : null;
  }
  async getPurchaseOrder(poNumber: string) {
    const po = await this.db.purchaseOrder.findFirst({ where: { poNumber } });
    return po ? { poNumber: po.poNumber, vendorCode: po.vendorCode, amountMinor: po.amountMinor, currency: po.currency, quantity: po.quantity, unitPriceMinor: po.unitPriceMinor } : null;
  }
  async getGoodsReceipt(grnNumber: string) {
    const g = await this.db.goodsReceipt.findFirst({ where: { grnNumber } });
    return g ? { grnNumber: g.grnNumber, poNumber: g.poNumber, quantityReceived: g.quantityReceived, receivedAt: g.receivedAt } : null;
  }
  async postApprovedInvoice(input: { invoiceId: string }) {
    return { externalRef: `${this.id.replace("fake_", "").toUpperCase()}-BILL-${input.invoiceId}` };
  }
}

export function toVendorRecord(v: {
  code: string; name: string; category: string; defaultGlCode: string; bankFingerprint: string;
  bankChangedAt: Date | null; blocked: boolean; blockedReason: string | null;
}): VendorRecord {
  return {
    code: v.code, name: v.name, category: v.category, defaultGlCode: v.defaultGlCode,
    bankFingerprint: v.bankFingerprint, bankChangedAt: v.bankChangedAt, blocked: v.blocked, blockedReason: v.blockedReason,
  };
}

export function getErpConnector(id: string, db: OrgDb): ErpConnector {
  if (id in ERP_CONNECTORS) return new FakeErpConnector(id as ErpConnectorId, db);
  throw new Error(`Unknown ERP connector "${id}"`);
}
