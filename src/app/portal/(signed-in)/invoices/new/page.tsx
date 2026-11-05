import Link from "next/link";
import { getVendorPageCtx } from "@/server/portal/page";
import { listBuyers } from "@/server/portal/profile";
import { getSupplierInvoice, listOpenPurchaseOrders, suggestFromPurchaseOrder } from "@/server/portal/invoices";
import { Alert, Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";
import { InvoiceForm, type FormValues } from "../invoice-form";

export const metadata = { title: "Supplier portal · New invoice" };

const DAY = 86_400_000;
const dollars = (minor: number | bigint) => (Number(minor) / 100).toFixed(2);

export default async function NewInvoice({ searchParams }: { searchParams: Promise<{ buyer?: string; po?: string; kind?: string; for?: string }> }) {
  const ctx = await getVendorPageCtx();
  const sp = await searchParams;
  const buyers = (await listBuyers(ctx)).filter((b) => b.status === "active");
  if (!buyers.length) return <EmptyState title="You aren't connected to any buyers yet">Buyers invite you to the portal. Ask your contact to send an invitation.</EmptyState>;
  const today = new Date().toISOString().slice(0, 10);

  if (sp.kind === "credit_note" && sp.for) {
    const orig = await getSupplierInvoice(ctx, sp.for);
    const initial: FormValues = { connectionId: orig.connectionId, invoiceNumber: "", invoiceDate: today, dueDate: "", poNumber: orig.poNumber ?? "", notes: `Credit for invoice ${orig.invoiceNumber}`, lines: orig.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: dollars(l.unitPriceMinor), taxPct: String(l.taxRateBps / 100) })) };
    return (
      <>
        <div className="mb-2 text-sm"><Link href={`/portal/invoices/${orig.id}`} className="text-muted hover:text-ink">← Invoice {orig.invoiceNumber}</Link></div>
        <PageHeader title={`Credit note for ${orig.invoiceNumber}`} description="Reduce what the buyer owes, for example for returned or damaged goods. Adjust the lines to the amount you're crediting." />
        <InvoiceForm mode="create" kind="credit_note" creditForInvoiceId={orig.id} buyers={buyers} initial={initial} />
      </>
    );
  }

  const buyer = buyers.find((b) => b.connectionId === sp.buyer) ?? buyers[0];
  const pos = await listOpenPurchaseOrders(ctx, buyer.connectionId);
  let initial: FormValues = { connectionId: buyer.connectionId, invoiceNumber: "", invoiceDate: today, dueDate: new Date(Date.parse(today) + buyer.paymentTermsDays * DAY).toISOString().slice(0, 10), poNumber: "", notes: "", lines: [{ description: "", quantity: "1", unitPrice: "", taxPct: "0" }] };
  if (sp.po) {
    const s = await suggestFromPurchaseOrder(ctx, buyer.connectionId, sp.po);
    initial = { ...initial, poNumber: s.poNumber, dueDate: s.dueDate, lines: s.lines.map((l) => ({ description: l.description, quantity: String(l.quantity), unitPrice: dollars(l.unitPriceMinor), taxPct: "0" })) };
  }
  return (
    <>
      <PageHeader title="New invoice" description="Start from one of the buyer's purchase orders and the lines are filled in for what's been delivered. Or fill in your own." />
      {buyers.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1">
          {buyers.map((b) => <Link key={b.connectionId} href={`/portal/invoices/new?buyer=${b.connectionId}`} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", b.connectionId === buyer.connectionId ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2")}>{b.buyerName}</Link>)}
        </div>
      ) : null}
      {!buyer.bankAccount ? <Alert tone="warn" className="mb-4">{buyer.buyerName} hasn’t approved your bank details yet. You can prepare invoices now and send them once they approve. <Link href="/portal/bank" className="underline">Bank details</Link></Alert> : null}
      <Card className="mb-5">
        <CardHeader title={`Open purchase orders from ${buyer.buyerName}`} description="Pick one to bill what's been delivered." />
        {pos.length === 0 ? <EmptyState title="No open purchase orders">Everything ordered has been billed. You can still create an invoice below.</EmptyState> : (
          <CardBody className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="open-pos">
            {pos.map((p) => {
              const unbilled = Math.max(0, p.quantityReceived - p.quantityBilled);
              return (
                <Link key={p.poNumber} href={`/portal/invoices/new?buyer=${buyer.connectionId}&po=${encodeURIComponent(p.poNumber)}`}
                  className={cn("rounded-md border p-3 text-sm transition-colors hover:border-brand/60 hover:bg-brand-soft/30", sp.po === p.poNumber ? "border-brand bg-brand-soft/40" : "border-border")} data-testid="po-card">
                  <div className="flex justify-between font-medium"><span>{p.poNumber}</span><span className="tabular">{formatMoney(p.amountMinor, p.currency)}</span></div>
                  <div className="text-xs text-muted">Raised {formatDate(p.raisedOn)} · {p.quantity} × {formatMoney(p.unitPriceMinor, p.currency)}</div>
                  <div className="mt-1 text-xs">{p.quantityReceived === 0 ? <span className="text-warn">Nothing delivered yet</span> : <>{p.quantityReceived} delivered · {p.quantityBilled} billed · <span className="font-medium">{unbilled} ready to bill</span></>}</div>
                </Link>
              );
            })}
          </CardBody>
        )}
      </Card>
      <InvoiceForm key={`${buyer.connectionId}-${sp.po ?? ""}`} mode="create" kind="invoice" buyers={buyers} initial={initial} />
    </>
  );
}
