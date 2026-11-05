import { forOrg } from "../db/dal";
import { forVendor } from "../db/vendor-dal";
import { requirePermission, type Ctx } from "../auth/session";
import { notFound } from "../errors";
import { renderInvoicePdf } from "./pdf";
import type { VendorCtx } from "./session";

const include = {
  lines: { orderBy: { position: "asc" as const } },
  vendorAccount: true,
  vendor: { select: { code: true } },
  organisation: { select: { name: true, billingAddress: true } },
  connection: { include: { bankAccount: { select: { bankName: true, accountLast4: true } } } },
};

type Loaded = NonNullable<Awaited<ReturnType<ReturnType<typeof forOrg>["invoice"]["findFirst"]>>> & {
  lines: { description: string; quantity: number; unitPriceMinor: bigint; taxRateBps: number; amountMinor: bigint }[];
  vendorAccount: { legalName: string; taxId: string | null; email: string; phone: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null };
  vendor: { code: string };
  organisation: { name: string; billingAddress: string | null };
  connection: { bankAccount: { bankName: string; accountLast4: string } | null };
};

async function render(inv: Loaded, creditForNumber: string | null) {
  const bytes = await renderInvoicePdf({
    kind: inv.kind, invoiceNumber: inv.invoiceNumber, status: inv.status, currency: inv.currency,
    invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, poNumber: inv.poNumber, notes: inv.notes,
    subtotalMinor: inv.subtotalMinor, taxMinor: inv.taxMinor, totalMinor: inv.totalMinor, creditForNumber,
    supplier: inv.vendorAccount, buyer: { name: inv.organisation.name, billingAddress: inv.organisation.billingAddress, vendorCode: inv.vendor.code },
    payTo: inv.connection.bankAccount, lines: inv.lines,
  });
  const prefix = inv.kind === "credit_note" ? "credit-note" : "invoice";
  return { bytes, filename: `${prefix}-${inv.invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf` };
}

export async function supplierInvoicePdf(ctx: VendorCtx, invoiceId: string) {
  const own = await forVendor(ctx.vendorAccountId).invoice.findFirst({ where: { id: invoiceId }, select: { id: true, organisationId: true } });
  if (!own) throw notFound("Invoice");
  const inv = (await forOrg(own.organisationId).invoice.findFirst({ where: { id: own.id }, include })) as unknown as Loaded;
  const credit = inv.creditForInvoiceId ? await forVendor(ctx.vendorAccountId).invoice.findFirst({ where: { id: inv.creditForInvoiceId }, select: { invoiceNumber: true } }) : null;
  return render(inv, credit?.invoiceNumber ?? null);
}

export async function buyerInvoicePdf(ctx: Ctx, invoiceId: string) {
  requirePermission(ctx, "suppliers:view");
  const db = forOrg(ctx.organisationId);
  const inv = (await db.invoice.findFirst({ where: { id: invoiceId }, include })) as unknown as Loaded | null;
  if (!inv) throw notFound("Invoice");
  const credit = inv.creditForInvoiceId ? await db.invoice.findFirst({ where: { id: inv.creditForInvoiceId }, select: { invoiceNumber: true } }) : null;
  return render(inv, credit?.invoiceNumber ?? null);
}
