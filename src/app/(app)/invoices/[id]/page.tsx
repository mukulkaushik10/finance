import Link from "next/link";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getPageCtx } from "@/server/auth/page";
import { can, canApproveAtLevel } from "@/server/auth/permissions";
import { getPortalInvoice } from "@/server/portal/buyer-invoices";
import { listBankAccounts } from "@/server/banking/service";
import { AppError } from "@/server/errors";
import { Alert, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { InvoiceMeta, InvoiceStatus, KindTag, LinesTable, Timeline } from "@/components/invoice-bits";
import { RuleResultList, StatusBadge, DECISION_TEXT, APPROVER_TEXT } from "@/components/action-bits";
import { MessageThread } from "@/components/message-thread";
import { formatMoney, formatBps } from "@/lib/money";
import { formatDate } from "@/lib/format";
import { plain } from "@/lib/send";
import { DecisionPanel, PaymentPanel } from "./panels";

export const metadata = { title: "Supplier invoice" };

export default async function SupplierInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await getPageCtx("suppliers:view");
  const { id } = await params;
  const inv = await getPortalInvoice(ctx, id).catch((e) => { if (e instanceof AppError && e.status === 404) notFound(); throw e; });
  const role = ctx.user.role;
  const a = inv.action;
  const failed = a?.ruleResults.filter((r) => r.result === "fail") ?? [];
  const canDecide = inv.status === "under_review" && can(role, "actions:review") && (!a || a.status === "blocked" || a.status === "logged" || canApproveAtLevel(role, a.requiredRole));
  const needsHigher = inv.status === "under_review" && a?.status === "pending_review" && !canApproveAtLevel(role, a.requiredRole);
  const canPay = can(role, "payments:manage") && inv.kind === "invoice" && (inv.status === "approved" || inv.status === "scheduled");
  const accounts = canPay ? await listBankAccounts(ctx) : [];
  const supplier = inv.vendorAccount;
  const payTo = inv.connection.bankAccount;

  return (
    <>
      <div className="mb-2 text-sm"><Link href="/invoices" className="text-muted hover:text-ink">← Supplier invoices</Link></div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{inv.kind === "credit_note" ? "Credit note" : "Invoice"} {inv.invoiceNumber} <InvoiceStatus status={inv.status} side="buyer" /> <KindTag kind={inv.kind} /></span>}
        description={`From ${inv.vendor.name} (${inv.vendor.code})${inv.revision > 1 ? ` · sent ${inv.revision} times` : ""}`}
        actions={<a href={`/api/supplier-invoices/${inv.id}/pdf`} target="_blank" className="inline-flex h-9 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium hover:bg-surface-2"><FileText className="h-4 w-4" /> PDF</a>}
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          {inv.pendingBankChange ? <Alert tone="warn" title="Bank detail change waiting">This supplier asked to change where they’re paid on {formatDate(inv.pendingBankChange.requestedAt)}. Payments are on hold until someone decides it on the <Link href="/suppliers" className="underline">Suppliers</Link> page.</Alert> : null}
          {inv.payToChangedSinceSent ? <Alert tone="bad" title="Bank details changed after this invoice was sent">Ask the supplier to confirm and send the invoice again before paying.</Alert> : null}
          {inv.vendor.blocked ? <Alert tone="bad" title="Vendor is blocked">{inv.vendor.blockedReason}</Alert> : null}
          <Card>
            <CardBody className="space-y-5 py-5">
              <InvoiceMeta items={[
                ["Invoice date", formatDate(inv.invoiceDate)],
                ["Due", formatDate(inv.dueDate)],
                ["PO", inv.poNumber ?? "None"],
                ["Delivery record", inv.grnNumber ?? "None"],
                ["Received", formatDate(inv.submittedAt)],
                ["Pay to", payTo ? `${payTo.bankName} ••${payTo.accountLast4}` : "No approved account"],
                ...(inv.payFrom ? [["Pay from", `${inv.payFrom.nickname} ••${inv.payFrom.accountLast4}`] as [string, string]] : []),
                ...(inv.scheduledFor ? [["Payment date", formatDate(inv.scheduledFor)] as [string, string]] : []),
                ...(inv.paymentReference ? [["Payment reference", inv.paymentReference] as [string, string]] : []),
                ...(inv.creditFor ? [["Credit for", <Link key="c" className="text-brand hover:underline" href={`/invoices/${inv.creditFor.id}`}>{inv.creditFor.invoiceNumber}</Link>] as [string, React.ReactNode]] : []),
              ]} />
              <LinesTable lines={plain(inv.lines)} currency={inv.currency} subtotalMinor={inv.subtotalMinor} taxMinor={inv.taxMinor} totalMinor={inv.totalMinor} kind={inv.kind} />
              {inv.notes ? <div className="rounded-md bg-surface-2 px-3 py-2 text-sm"><span className="text-muted">Supplier’s note: </span>{inv.notes}</div> : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="AI check and rules" description={a ? `Checked by ${a.agent.name} and your rules. The supplier doesn't see any of this.` : "This invoice wasn't checked by an AI agent; a person decides."} action={a ? <Link href={`/actions/${a.id}`} className="text-sm text-brand hover:underline">Full detail →</Link> : null} />
            {a ? (
              <CardBody className="space-y-4">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                  <div><span className="text-muted">Agent proposed: </span><span className="font-medium">{DECISION_TEXT[a.proposedDecision]}</span>{a.agentConfidenceBps !== null ? <span className="text-muted"> · {formatBps(a.agentConfidenceBps, 0)} sure</span> : null}</div>
                  <div><span className="text-muted">Outcome: </span><StatusBadge status={a.status} /></div>
                  {a.requiredRole ? <div><span className="text-muted">Needs: </span>{APPROVER_TEXT[a.requiredRole]}</div> : null}
                </div>
                {a.agentReason ? <p className="text-sm text-ink-2">“{a.agentReason}”</p> : null}
                {failed.length ? <Alert tone="warn">{failed.length} check{failed.length > 1 ? "s" : ""} failed. Approving overrides {failed.length > 1 ? "them" : "it"}.</Alert> : null}
                <RuleResultList results={plain(a.ruleResults)} />
                {a.review ? <p className="text-sm text-muted">Reviewed by {a.review.reviewer.name}: “{a.review.reason}”</p> : null}
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Messages with the supplier" />
            <CardBody>
              <MessageThread messages={plain(inv.messages)} postUrl={`/api/supplier-invoices/${inv.id}/messages`} me="buyer" canPost={can(role, "actions:review") || can(role, "suppliers:manage")} emptyText="No messages yet." />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {canDecide ? <DecisionPanel invoiceId={inv.id} blocked={a?.status === "blocked"} failedCount={failed.length} /> : null}
          {needsHigher ? <Alert tone="info">This invoice needs a decision by {APPROVER_TEXT[a!.requiredRole!].toLowerCase()}.</Alert> : null}
          {canPay ? <PaymentPanel invoiceId={inv.id} status={inv.status} amount={formatMoney(inv.totalMinor, inv.currency)} accounts={plain(accounts)} payTo={payTo ? `${payTo.bankName} ••${payTo.accountLast4}` : null} blockedReason={inv.pendingBankChange ? "A bank detail change is waiting for a decision." : inv.vendor.blocked ? `Vendor is blocked: ${inv.vendor.blockedReason}` : !payTo ? "The supplier has no approved bank account." : null} /> : null}
          <Card>
            <CardHeader title="Supplier" />
            <CardBody className="space-y-1 text-sm">
              <div className="font-medium">{supplier.legalName}</div>
              {supplier.taxId ? <div className="text-muted">EIN {supplier.taxId}</div> : null}
              <div className="text-muted">{supplier.email}{supplier.phone ? ` · ${supplier.phone}` : ""}</div>
              {supplier.addressLine1 ? <div className="text-muted">{supplier.addressLine1}, {supplier.city}, {supplier.region} {supplier.postalCode}</div> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Timeline" description="What the supplier sees, in their words" />
            <CardBody><Timeline events={plain(inv.events.map((e) => ({ ...e, at: e.createdAt })))} side="buyer" /></CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
