import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { listBankChanges, listSupplierConnections } from "@/server/portal/suppliers";
import { forOrg } from "@/server/db/dal";
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDate, formatDateTime } from "@/lib/format";
import { plain } from "@/lib/send";
import { BankChangeDecision, InviteSupplier, ConnectionActions } from "./client";

export const metadata = { title: "Suppliers" };

const CONN: Record<string, { label: string; tone: "good" | "warn" | "neutral" | "bad" }> = {
  active: { label: "Connected", tone: "good" }, invited: { label: "Invited", tone: "warn" }, suspended: { label: "Suspended", tone: "bad" },
};

export default async function SuppliersPage() {
  const ctx = await getPageCtx("suppliers:view");
  const manage = can(ctx.user.role, "suppliers:manage");
  const [connections, pending, history] = await Promise.all([
    listSupplierConnections(ctx), listBankChanges(ctx), listBankChanges(ctx, { status: "all" }),
  ]);
  const connected = new Set(connections.map((c) => c.vendor.id));
  const vendors = manage ? (await forOrg(ctx.organisationId).vendor.findMany({ where: { blocked: false }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true } })).filter((v) => !connected.has(v.id)) : [];
  const decided = history.filter((h) => h.status !== "pending").slice(0, 10);

  return (
    <>
      <PageHeader title="Suppliers" description="Invite suppliers to send invoices through the supplier portal, and approve any change to where they're paid." />
      <div className="space-y-5">
        <Card data-testid="bank-changes">
          <CardHeader title={`Bank detail changes waiting (${pending.length})`} description="Changing where a supplier is paid is the most common way invoice fraud happens. Before approving, call the supplier on a number from your own records, not one from the request." />
          {pending.length === 0 ? <EmptyState title="Nothing waiting">New requests from suppliers appear here.</EmptyState> : (
            <CardBody className="space-y-4">
              {pending.map((c) => (
                <div key={c.id} className="rounded-lg border border-warn/40 bg-warn-soft/30 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold">{c.vendor.name} <span className="text-sm font-normal text-muted">{c.vendor.code}</span></div>
                      <div className="text-sm text-muted">Requested by {c.requestedByName} on {formatDateTime(c.requestedAt)} · contact on file: {c.supplier.email}{c.supplier.phone ? `, ${c.supplier.phone}` : ""}</div>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                    <div className="rounded-md bg-surface p-3"><div className="text-xs text-muted">Currently paid into</div>{c.previousAccount ? <div className="font-medium">{c.previousAccount.bankName} ••{c.previousAccount.accountLast4}<div className="text-xs font-normal text-muted">Routing {c.previousAccount.routingNumber}</div></div> : <div className="text-muted">No approved account</div>}</div>
                    <div className="rounded-md bg-surface p-3 ring-1 ring-warn/50"><div className="text-xs text-muted">Wants to be paid into</div><div className="font-medium">{c.newAccount.bankName} ••{c.newAccount.accountLast4}<div className="text-xs font-normal text-muted">Routing {c.newAccount.routingNumber} · holder {c.newAccount.holderName}</div></div></div>
                  </div>
                  {manage ? <BankChangeDecision id={c.id} /> : null}
                </div>
              ))}
            </CardBody>
          )}
        </Card>

        <Card>
          <CardHeader title="Suppliers on the portal" action={manage ? <InviteSupplier vendors={vendors} /> : null} />
          {connections.length === 0 ? <EmptyState title="No suppliers yet">Invite a supplier from your vendor list to get started.</EmptyState> : (
            <Table>
              <thead><tr><Th>Supplier</Th><Th>Status</Th><Th>Portal account</Th><Th>Paid into</Th><Th>Terms</Th><Th className="text-right">Invoices</Th><Th /></tr></thead>
              <tbody>
                {connections.map((c) => (
                  <tr key={c.id}>
                    <Td><div className="font-medium">{c.vendor.name}</div><div className="text-xs text-muted">{c.vendor.code} · {c.vendor.category}</div></Td>
                    <Td><Badge tone={c.inviteExpired ? "bad" : CONN[c.status].tone}>{c.inviteExpired ? "Invitation expired" : CONN[c.status].label}</Badge><div className="mt-0.5 text-xs text-muted">{c.status === "invited" ? `Sent ${formatDate(c.invitedAt)} to ${c.inviteEmail}` : `Since ${formatDate(c.acceptedAt)}`}</div></Td>
                    <Td>{c.supplier ? <><div>{c.supplier.legalName}</div><div className="text-xs text-muted">{c.supplier.email}{c.supplier.taxId ? ` · EIN ${c.supplier.taxId}` : ""}</div></> : <span className="text-muted">Not yet</span>}</Td>
                    <Td>{c.bankAccount ? `${c.bankAccount.bankName} ••${c.bankAccount.accountLast4}` : <span className="text-muted">None approved</span>}</Td>
                    <Td className="text-muted">{c.paymentTermsDays} days</Td>
                    <Td className="text-right tabular">{c.invoiceCount}</Td>
                    <Td className="text-right">{manage ? <ConnectionActions connection={plain(c)} /> : null}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {decided.length ? (
          <Card>
            <CardHeader title="Recent bank detail decisions" />
            <Table>
              <thead><tr><Th>Supplier</Th><Th>New account</Th><Th>Decision</Th><Th>How it was verified</Th><Th>When</Th></tr></thead>
              <tbody>
                {decided.map((h) => (
                  <tr key={h.id}>
                    <Td>{h.vendor.name}</Td>
                    <Td>{h.newAccount.bankName} ••{h.newAccount.accountLast4}</Td>
                    <Td><Badge tone={h.status === "approved" ? "good" : h.status === "withdrawn" ? "neutral" : "bad"}>{h.status === "approved" ? "Approved" : h.status === "withdrawn" ? "Replaced by a newer request" : "Rejected"}</Badge>{h.decidedByName ? <div className="text-xs text-muted">{h.decidedByName}</div> : null}</Td>
                    <Td className="max-w-sm text-sm text-ink-2">{h.verification ?? h.decisionNote ?? "-"}</Td>
                    <Td className="text-muted">{formatDateTime(h.decidedAt ?? h.requestedAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        ) : null}
      </div>
    </>
  );
}
