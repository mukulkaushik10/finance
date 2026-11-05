import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { listPortalInvoices } from "@/server/portal/buyer-invoices";
import { Card, EmptyState, Input, LinkButton, PageHeader, Table, Td, Th, Button } from "@/components/ui";
import { InvoiceStatus, KindTag } from "@/components/invoice-bits";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Supplier invoices" };

const TABS: [string, string][] = [
  ["under_review", "Waiting for a decision"],
  ["approved", "Ready to pay"],
  ["scheduled", "Scheduled"],
  ["paid", "Paid"],
  ["needs_changes", "Sent back"],
  ["", "All"],
];

export default async function SupplierInvoicesPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const ctx = await getPageCtx("suppliers:view");
  const sp = await searchParams;
  const status = sp.status ?? "under_review";
  const [rows, all] = await Promise.all([listPortalInvoices(ctx, { status: status || undefined, q: sp.q }), listPortalInvoices(ctx, {})]);
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k ? all.filter((r) => r.status === k).length : all.length]));
  const total = rows.reduce((s, r) => s + (r.kind === "credit_note" ? -r.totalMinor : r.totalMinor), 0n);
  return (
    <>
      <PageHeader
        title="Supplier invoices"
        description="Invoices your suppliers sent through the supplier portal. Each one goes through the same AI check, rules and approval limits as any other invoice."
        actions={<LinkButton href="/suppliers">Suppliers & bank changes</LinkButton>}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map(([k, label]) => (
            <Link key={k || "all"} href={`/invoices?status=${k}`} role="tab" aria-selected={status === k}
              className={cn("rounded-md px-3 py-1.5 text-sm font-medium", status === k ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-surface-2")}>
              {label} <span className="ml-1 text-xs text-muted tabular">{counts[k]}</span>
            </Link>
          ))}
        </div>
        <form method="get" className="flex gap-2">
          <input type="hidden" name="status" value={status} />
          <Input name="q" defaultValue={sp.q} placeholder="Invoice, supplier or PO" className="w-56" />
          <Button type="submit" variant="secondary">Search</Button>
        </form>
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState title="Nothing here">No supplier invoices with this status.</EmptyState> : (
          <Table>
            <thead><tr><Th>Invoice</Th><Th>Supplier</Th><Th>PO</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Received</Th><Th>Due</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/60">
                  <Td><Link href={`/invoices/${r.id}`} className="font-medium text-brand hover:underline" data-testid="invoice-link">{r.invoiceNumber}</Link> <KindTag kind={r.kind} />{r.revision > 1 ? <span className="ml-1 text-xs text-muted">resent</span> : null}</Td>
                  <Td><div>{r.vendor.name}</div><div className="text-xs text-muted">{r.vendor.code}</div></Td>
                  <Td className="text-muted">{r.poNumber ?? "None"}</Td>
                  <Td className="text-right tabular">{r.kind === "credit_note" ? "−" : ""}{formatMoney(r.totalMinor, r.currency)}</Td>
                  <Td><InvoiceStatus status={r.status} side="buyer" />{r.check?.status === "blocked" ? <span className="ml-1 text-xs text-bad">blocked by a rule</span> : null}</Td>
                  <Td className="text-muted">{formatDate(r.submittedAt)}</Td>
                  <Td className="text-muted">{r.status === "scheduled" ? `Paying ${formatDate(r.scheduledFor)}` : r.status === "paid" ? `Paid ${formatDate(r.paidAt)}` : formatDate(r.dueDate)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-sm text-muted">{rows.length} invoice{rows.length === 1 ? "" : "s"} · <span className="font-medium text-ink tabular">{formatMoney(total, "USD")}</span></p>
    </>
  );
}
