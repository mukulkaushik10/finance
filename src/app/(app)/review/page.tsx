import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { canApproveAtLevel } from "@/server/auth/permissions";
import { listQueue } from "@/server/actions/query";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { APPROVER_TEXT, DECISION_TEXT } from "@/components/action-bits";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatCount } from "@/lib/format";

export const metadata = { title: "Review queue" };

export default async function ReviewQueuePage() {
  const ctx = await getPageCtx("actions:view");
  const { pending, spotChecks } = await listQueue(ctx);
  const mine = pending.filter((a) => canApproveAtLevel(ctx.user.role, a.requiredRole));
  const higher = pending.filter((a) => !canApproveAtLevel(ctx.user.role, a.requiredRole));
  const total = pending.reduce((s, a) => s + a.amountMinor, 0n);

  return (
    <>
      <PageHeader
        title="Review queue"
        description="Invoices the agent wanted to act on that need a person's decision. Every decision needs a reason and is kept in the audit trail."
      />
      <div className="mb-4 text-sm text-muted">
        {formatCount(pending.length)} waiting · {formatMoney(total, "USD")} in total
      </div>
      <QueueTable title={ctx.user.role === "auditor" ? "Waiting for review" : "Waiting for you"} rows={ctx.user.role === "auditor" ? pending : mine} empty="Nothing waiting for your decision." />
      {ctx.user.role !== "auditor" && higher.length ? (
        <div className="mt-6"><QueueTable title="Needs a more senior approver" description="Above your approval limit. You can open them but not decide." rows={higher} empty="" /></div>
      ) : null}
      {spotChecks.length ? (
        <div className="mt-6">
          <QueueTable
            title="Shadow mode spot checks"
            description="In shadow mode the agent goes ahead on its own. Checking a sample of its decisions builds the accuracy record needed to move up a level."
            rows={spotChecks}
            empty=""
          />
        </div>
      ) : null}
    </>
  );
}

function QueueTable({ title, description, rows, empty }: { title: string; description?: string; rows: Awaited<ReturnType<typeof listQueue>>["pending"]; empty: string }) {
  return (
    <Card>
      <CardHeader title={`${title} (${rows.length})`} description={description} />
      {rows.length === 0 ? <EmptyState title={empty} /> : (
        <Table data-testid="queue-table">
          <thead>
            <tr><Th>Invoice</Th><Th className="text-right">Amount</Th><Th>Agent wants to</Th><Th>Why it’s here</Th><Th>Who can approve</Th><Th>Waiting since</Th></tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const reasons = (a.gateReasons as string[]).filter((r) => !r.startsWith("Shadow mode"));
              return (
                <tr key={a.id} className="hover:bg-surface-2/50">
                  <Td>
                    <Link href={`/review/${a.id}`} className="font-medium text-brand hover:underline" data-testid="queue-item">{a.externalRef}</Link>
                    <div className="text-xs text-muted">{a.counterpartyName}</div>
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap font-medium text-ink">{formatMoney(a.amountMinor, a.currency)}</Td>
                  <Td>{DECISION_TEXT[a.proposedDecision]}</Td>
                  <Td className="max-w-md">
                    <div className="text-sm">{reasons[0]}</div>
                    {reasons.length > 1 ? <div className="text-xs text-muted">+{reasons.length - 1} more</div> : null}
                  </Td>
                  <Td>{a.requiredRole ? <Badge tone={a.requiredRole === "reviewer" ? "neutral" : "info"}>{APPROVER_TEXT[a.requiredRole]}</Badge> : <span className="text-muted">Spot check</span>}</Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
