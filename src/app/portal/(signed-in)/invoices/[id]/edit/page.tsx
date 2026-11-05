import Link from "next/link";
import { redirect } from "next/navigation";
import { getVendorPageCtx } from "@/server/portal/page";
import { listBuyers } from "@/server/portal/profile";
import { getSupplierInvoice } from "@/server/portal/invoices";
import { Alert, PageHeader } from "@/components/ui";
import { InvoiceForm } from "../../invoice-form";

export const metadata = { title: "Supplier portal · Edit invoice" };

export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getVendorPageCtx();
  const { id } = await params;
  const inv = await getSupplierInvoice(ctx, id);
  if (!["draft", "needs_changes"].includes(inv.status)) redirect(`/portal/invoices/${id}`);
  const buyers = await listBuyers(ctx);
  const d10 = (d: Date) => new Date(d).toISOString().slice(0, 10);
  return (
    <>
      <div className="mb-2 text-sm"><Link href={`/portal/invoices/${id}`} className="text-muted hover:text-ink">← Back</Link></div>
      <PageHeader title={`Edit ${inv.kind === "credit_note" ? "credit note" : "invoice"} ${inv.invoiceNumber}`} />
      {inv.status === "needs_changes" && inv.supplierNote ? <Alert tone="warn" className="mb-4" title={`What ${inv.buyerName} asked for`}>{inv.supplierNote}</Alert> : null}
      <InvoiceForm mode="edit" invoiceId={id} kind={inv.kind} creditForInvoiceId={inv.creditFor?.id} buyers={buyers} lockNumber={inv.revision > 0}
        initial={{ connectionId: inv.connectionId, invoiceNumber: inv.invoiceNumber, invoiceDate: d10(inv.invoiceDate), dueDate: d10(inv.dueDate), poNumber: inv.poNumber ?? "", notes: inv.notes ?? "",
          lines: inv.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: (Number(l.unitPriceMinor) / 100).toFixed(2), taxPct: String(l.taxRateBps / 100) })) }} />
    </>
  );
}
