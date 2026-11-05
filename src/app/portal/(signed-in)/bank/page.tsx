import { getVendorPageCtx } from "@/server/portal/page";
import { listBuyers, listSupplierBankAccounts } from "@/server/portal/profile";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { BankChangeForm } from "./form";

export const metadata = { title: "Supplier portal · Bank details" };

export default async function BankPage({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const ctx = await getVendorPageCtx();
  const { welcome } = await searchParams;
  const [buyers, accounts] = await Promise.all([listBuyers(ctx), listSupplierBankAccounts(ctx)]);
  return (
    <>
      <PageHeader title="Bank details" description="Where your buyers pay you. To protect you from payment fraud, each buyer confirms any new account with you before using it." />
      {welcome ? <Alert tone="good" className="mb-5" title="Welcome to the supplier portal">Add the account you want to be paid into. Your buyer will contact you to confirm it, then you can start sending invoices.</Alert> : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Each buyer pays you into" />
            <CardBody className="space-y-3">
              {buyers.map((b) => (
                <div key={b.connectionId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm" data-testid="buyer-bank">
                  <div className="font-medium">{b.buyerName}</div>
                  <div className="text-right">
                    {b.bankAccount ? <div>{b.bankAccount.bankName} ••{b.bankAccount.accountLast4} <Badge tone="good">Approved</Badge></div> : <Badge tone="warn">No approved account</Badge>}
                    {b.pendingBankChange ? <div className="mt-1 text-xs text-warn">Change to {b.pendingBankChange.newBankAccount.bankName} ••{b.pendingBankChange.newBankAccount.accountLast4} requested {formatDate(b.pendingBankChange.requestedAt)}, waiting for {b.buyerName}</div> : null}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Accounts you've added" />
            <CardBody className="space-y-2 text-sm">
              {accounts.length === 0 ? <p className="text-muted">None yet.</p> : accounts.map((a) => (
                <div key={a.id} className="flex justify-between"><span>{a.bankName} ••{a.accountLast4} <span className="text-muted">· routing {a.routingNumber}</span></span><span className="text-muted">Added {formatDate(a.createdAt)}</span></div>
              ))}
            </CardBody>
          </Card>
          <Alert tone="info" title="We'll never ask by email">Your buyers will never ask you to change bank details by email. If someone does, contact the buyer on a number you already know.</Alert>
        </div>
        <BankChangeForm buyers={buyers.filter((b) => b.status === "active").map((b) => ({ connectionId: b.connectionId, buyerName: b.buyerName }))} canEdit={ctx.user.role === "owner"} />
      </div>
    </>
  );
}
