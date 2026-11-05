import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getVendorPageCtx } from "@/server/portal/page";
import { checkBeforeSending, getSupplierInvoice } from "@/server/portal/invoices";
import { AppError } from "@/server/errors";
import { Alert, Card, CardBody, CardHeader, LinkButton, PageHeader } from "@/components/ui";
import { InvoiceMeta, InvoiceStatus, KindTag, LinesTable, Timeline } from "@/components/invoice-bits";
import { MessageThread } from "@/components/message-thread";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { plain } from "@/lib/send";
import { SendPanel } from "./send-panel";

export const metadata = { title: "Supplier portal · Invoice" };

export default async function PortalInvoice({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getVendorPageCtx();
  const { id } = await params;
  const inv = await getSupplierInvoice(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const editable = inv.status === "draft" || inv.status === "needs_changes";
  const checks = editable ? await checkBeforeSending(ctx, id).catch(() => []) : [];
  const label = inv.kind === "credit_note" ? "Credit note" : "Invoice";
  const creditable = inv.kind === "invoice" && ["approved", "scheduled", "paid"].includes(inv.status);
  return (
    <>
      <div className="mb-2 text-sm"><Link href="/portal/invoices" className="text-muted hover:text-ink">← Invoices</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{label} {inv.invoiceNumber} <InvoiceStatus status={inv.status} side="supplier" /> <KindTag kind={inv.kind} /></span>}
        description={`To ${inv.buyerName}`}
        actions={<>
          {creditable ? <LinkButton href={`/portal/invoices/new?kind=credit_note&for=${inv.id}`}>Issue a credit note</LinkButton> : null}
          <a href={`/api/portal/invoices/${inv.id}/pdf`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2" data-testid="supplier-pdf"><FileText className="h-4 w-4" /> Download PDF</a>
        </>}
      />
      {inv.status === "needs_changes" && inv.supplierNote ? <Alert tone="warn" className="mb-5" title={`${inv.buyerName} asked for changes`}>{inv.supplierNote}</Alert> : null}
      {inv.status === "rejected" && inv.supplierNote ? <Alert tone="bad" className="mb-5" title="Rejected">{inv.supplierNote}</Alert> : null}
      {inv.status === "scheduled" ? <Alert tone="good" className="mb-5" title={`Payment scheduled for ${formatDate(inv.scheduledFor)}`}>{formatMoney(inv.totalMinor, inv.currency)} to your account ending {inv.payTo?.accountLast4}.</Alert> : null}
      {inv.status === "paid" ? <Alert tone="good" className="mb-5" title={`Paid on ${formatDate(inv.paidAt)}`}>Payment reference {inv.paymentReference}.</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardBody className="space-y-5 py-5">
              <InvoiceMeta items={[
                ["Date", formatDate(inv.invoiceDate)],
                ...(inv.kind === "invoice" ? [["Due", formatDate(inv.dueDate)] as [string, string]] : []),
                ["PO", inv.poNumber ?? "None"],
                ["Your vendor code", inv.yourVendorCode],
                ["Paid into", inv.payTo ? `${inv.payTo.bankName} ••${inv.payTo.accountLast4}` : "Not approved yet"],
                ...(inv.creditFor ? [["Credit for", <Link key="c" href={`/portal/invoices/${inv.creditFor.id}`} className="text-brand hover:underline">{inv.creditFor.invoiceNumber}</Link>] as [string, React.ReactNode]] : []),
              ]} />
              <LinesTable lines={plain(inv.lines)} currency={inv.currency} subtotalMinor={inv.subtotalMinor} taxMinor={inv.taxMinor} totalMinor={inv.totalMinor} kind={inv.kind} />
              {inv.notes ? <div className="rounded-md bg-surface-2 px-3 py-2 text-sm"><span className="text-muted">Notes: </span>{inv.notes}</div> : null}
              {inv.credits.length ? <div className="text-sm text-muted">Credit notes against this invoice: {inv.credits.map((c) => <Link key={c.id} href={`/portal/invoices/${c.id}`} className="mr-2 text-brand hover:underline">{c.invoiceNumber} ({formatMoney(c.totalMinor, inv.currency)})</Link>)}</div> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={`Messages with ${inv.buyerName}`} />
            <CardBody><MessageThread messages={plain(inv.messages)} postUrl={`/api/portal/invoices/${inv.id}/messages`} me="supplier" canPost={inv.status !== "draft"} emptyText={inv.status === "draft" ? "You can message the buyer once you've sent the invoice." : "No messages yet. Ask a question about this invoice here."} /></CardBody>
          </Card>
        </div>
        <div className="space-y-5">
          {editable ? <SendPanel invoiceId={inv.id} checks={checks} resend={inv.revision > 0} isDraft={inv.status === "draft"} /> : null}
          <Card>
            <CardHeader title="Where it is" />
            <CardBody><Timeline events={plain(inv.events)} side="supplier" /></CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
