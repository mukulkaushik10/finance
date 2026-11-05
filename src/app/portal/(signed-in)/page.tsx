import Link from "next/link";
import { Plus } from "lucide-react";
import { getVendorPageCtx } from "@/server/portal/page";
import { getSupplierHome } from "@/server/portal/invoices";
import { listBuyers } from "@/server/portal/profile";
import { Alert, Card, CardBody, CardHeader, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { InvoiceStatus } from "@/components/invoice-bits";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Supplier portal" };

export default async function PortalHome() {
  const ctx = await getVendorPageCtx();
  const [home, buyers] = await Promise.all([getSupplierHome(ctx), listBuyers(ctx)]);
  const noBank = buyers.filter((b) => !b.bankAccount);
  return (
    <>
      <PageHeader title={`Hello, ${ctx.user.name.split(" ")[0]}`} description="What you're owed, what's on its way, and anything that needs you."
        actions={<LinkButton href="/portal/invoices/new" variant="primary"><Plus className="h-4 w-4" /> New invoice</LinkButton>} />
      {noBank.length ? <Alert tone="warn" className="mb-5" title="Add your bank details">{noBank.map((b) => b.buyerName).join(", ")} can’t pay you until you add bank details and they approve them. <Link href="/portal/bank" className="underline">Add bank details</Link></Alert> : null}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="supplier-stats">
        <Stat label="Owed to you" value={formatMoney(home.outstandingMinor, "USD")} sub={`${home.outstandingCount} invoice${home.outstandingCount === 1 ? "" : "s"} sent, not yet paid`} href="/portal/invoices?status=outstanding" />
        <Stat label="Payment scheduled" value={formatMoney(home.scheduledMinor, "USD")} sub="Buyer has set a payment date" href="/portal/invoices?status=scheduled" />
        <Stat label="Paid, last 90 days" value={formatMoney(home.paid90Minor, "USD")} sub={`${home.paid90Count} invoice${home.paid90Count === 1 ? "" : "s"}`} href="/portal/invoices?status=paid" tone="good" />
        <Stat label="Average time to get paid" value={home.avgDaysToPay === null ? "-" : `${home.avgDaysToPay} days`} sub="From sending to payment" />
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Needs your attention" />
          {home.attention.length === 0 ? <EmptyState title="All clear">Nothing is waiting for you.</EmptyState> : (
            <CardBody className="divide-y divide-border p-0">
              {home.attention.map((a) => (
                <Link key={a.id} href={`/portal/invoices/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2/60">
                  <div><div className="font-medium">{a.invoiceNumber}</div><div className="text-xs text-muted">{a.buyerName} · {a.status === "draft" ? "Draft not sent yet" : "The buyer asked for changes"}</div></div>
                  <div className="flex items-center gap-3"><span className="tabular">{formatMoney(a.totalMinor, a.currency)}</span><InvoiceStatus status={a.status} side="supplier" /></div>
                </Link>
              ))}
            </CardBody>
          )}
          {home.overdueCount ? <CardBody><Alert tone="warn">{home.overdueCount} invoice{home.overdueCount === 1 ? " is" : "s are"} past due ({formatMoney(home.overdueMinor, "USD")}). You can message the buyer from the invoice.</Alert></CardBody> : null}
        </Card>
        <Card>
          <CardHeader title="Your buyers" />
          <CardBody className="space-y-3">
            {buyers.map((b) => (
              <div key={b.connectionId} className="rounded-md border border-border p-3 text-sm">
                <div className="font-medium">{b.buyerName}</div>
                <div className="text-xs text-muted">Your vendor code: {b.yourVendorCode} · {b.paymentTermsDays}-day terms</div>
                <div className="mt-1 text-xs">{b.bankAccount ? <>Pays into {b.bankAccount.bankName} ••{b.bankAccount.accountLast4}</> : <span className="text-warn">No approved bank account</span>}{b.pendingBankChange ? <span className="text-warn"> · change waiting for approval</span> : null}</div>
                <div className="mt-2"><Link href={`/portal/invoices/new?buyer=${b.connectionId}`} className="text-xs font-medium text-brand hover:underline">Bill a purchase order →</Link></div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
