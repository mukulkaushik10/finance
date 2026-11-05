import Link from "next/link";
import { Plus } from "lucide-react";
import { getVendorPageCtx } from "@/server/portal/page";
import { listSupplierInvoices } from "@/server/portal/invoices";
import { OUTSTANDING } from "@/server/portal/labels";
import { Card, EmptyState, LinkButton, PageHeader, Table, Td, Th } from "@/components/ui";
import { InvoiceStatus, KindTag } from "@/components/invoice-bits";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Supplier portal · Invoices" };

const TABS: [string, string][] = [["", "All"], ["outstanding", "Not yet paid"], ["needs_changes", "Needs changes"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ["paid", "Paid"]];

export default async function PortalInvoices({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await getVendorPageCtx();
  const { status = "" } = await searchParams;
  const all = await listSupplierInvoices(ctx);
  const rows = status === "outstanding" ? all.filter((i) => OUTSTANDING.includes(i.status)) : status ? all.filter((i) => i.status === status) : all;
  return (
    <>
      <PageHeader title="Invoices" description="Everything you've sent, and where it is." actions={<LinkButton href="/portal/invoices/new" variant="primary"><Plus className="h-4 w-4" /> New invoice</LinkButton>} />
      <div className="mb-4 flex flex-wrap gap-1">
        {TABS.map(([k, label]) => <Link key={k || "all"} href={`/portal/invoices${k ? `?status=${k}` : ""}`} className={cn("rounded-md px-3 py-1.5 text-sm font-medium", status === k ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2")}>{label}</Link>)}
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="No invoices here" action={<LinkButton href="/portal/invoices/new" variant="primary">Create an invoice</LinkButton>} /> : (
          <Table>
            <thead><tr><Th>Number</Th><Th>Buyer</Th><Th>PO</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Sent</Th><Th>Due / paid</Th></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="hover:bg-surface-2/60">
                  <Td><Link href={`/portal/invoices/${i.id}`} className="font-medium text-brand hover:underline" data-testid="supplier-invoice-link">{i.invoiceNumber}</Link> <KindTag kind={i.kind} /></Td>
                  <Td>{i.buyerName}</Td>
                  <Td className="text-muted">{i.poNumber ?? "-"}</Td>
                  <Td className="text-right tabular">{formatMoney(i.totalMinor, i.currency)}</Td>
                  <Td><InvoiceStatus status={i.status} side="supplier" /></Td>
                  <Td className="text-muted">{formatDate(i.submittedAt)}</Td>
                  <Td className="text-muted">{i.status === "paid" ? `Paid ${formatDate(i.paidAt)}` : i.status === "scheduled" ? `Paying ${formatDate(i.scheduledFor)}` : formatDate(i.dueDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
