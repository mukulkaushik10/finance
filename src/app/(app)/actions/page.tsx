import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { listActions } from "@/server/actions/query";
import { Badge, Button, Card, EmptyState, Input, LinkButton, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { DECISION_TEXT, StatusBadge } from "@/components/action-bits";
import { formatMoney } from "@/lib/money";
import { formatCount, formatDateTime } from "@/lib/format";
import { Download } from "lucide-react";

export const metadata = { title: "All actions" };

const FLAG_LABEL: Record<string, string> = {
  money_at_risk: "Money at risk: went ahead despite a failed check",
  overridden: "Approved by a person despite a failed check",
  agent_wrong: "Agent was wrong (per reviewer)",
  reviewed: "Reviewed by a person",
  escalated: "Sent for review",
};

export default async function ActionsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getPageCtx("actions:view");
  const sp = await searchParams;
  const result = await listActions(ctx, sp);
  const f = result.filter;
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)]));
    return `?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k]) => ["from", "to", "vendor"].includes(k))).toString();
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader
        title="All actions"
        description="Every invoice an agent proposed to act on, with what Control Room decided."
        actions={can(ctx.user.role, "audit:export") ? (
          <LinkButton href={`/audit?${exportQs}`}><Download className="h-4 w-4" /> Export evidence</LinkButton>
        ) : null}
      />
      <form className="mb-4 flex flex-wrap items-end gap-2" method="get">
        <div><div className="mb-1 text-xs text-muted">Invoice</div><Input name="q" defaultValue={f.q} placeholder="Invoice ID" className="w-36" /></div>
        <div><div className="mb-1 text-xs text-muted">Vendor</div><Input name="vendor" defaultValue={f.vendor} placeholder="Name or code" className="w-44" /></div>
        <div>
          <div className="mb-1 text-xs text-muted">Status</div>
          <Select name="status" defaultValue={f.status ?? ""}>
            <option value="">Any</option>
            <option value="auto_approved">Approved automatically</option>
            <option value="pending_review">Waiting for review</option>
            <option value="approved">Approved by a person</option>
            <option value="rejected">Rejected</option>
            <option value="blocked">Blocked</option>
            <option value="logged">Recorded (shadow)</option>
          </Select>
        </div>
        <div>
          <div className="mb-1 text-xs text-muted">Show only</div>
          <Select name="flag" defaultValue={f.flag ?? ""}>
            <option value="">Everything</option>
            {Object.entries(FLAG_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
        <div><div className="mb-1 text-xs text-muted">From</div><Input type="date" name="from" defaultValue={f.from} className="w-40" /></div>
        <div><div className="mb-1 text-xs text-muted">To</div><Input type="date" name="to" defaultValue={f.to} className="w-40" /></div>
        <Button type="submit" variant="secondary">Filter</Button>
        {Object.keys(sp).length ? <LinkButton href="/actions" variant="ghost">Clear</LinkButton> : null}
      </form>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="actions-summary">
        <span><span className="font-semibold text-ink">{formatCount(result.total)}</span> invoices · <span className="font-semibold text-ink">{formatMoney(result.totalAmountMinor, "USD")}</span></span>
        {f.flag ? <Badge tone="info">{FLAG_LABEL[f.flag]}</Badge> : null}
      </div>

      <Card>
        {result.rows.length === 0 ? <EmptyState title="No invoices match these filters" /> : (
          <Table>
            <thead>
              <tr><Th>Invoice</Th><Th className="text-right">Amount</Th><Th>Agent proposed</Th><Th>Outcome</Th><Th>Failed checks</Th><Th>Reviewed by</Th><Th>Received</Th></tr>
            </thead>
            <tbody>
              {result.rows.map((a) => (
                <tr key={a.id} className="hover:bg-surface-2/50" data-testid="action-row">
                  <Td>
                    <Link href={`/actions/${a.id}`} className="font-medium text-brand hover:underline">{a.externalRef}</Link>
                    <div className="text-xs text-muted">{a.counterpartyName}</div>
                  </Td>
                  <Td className="text-right tabular whitespace-nowrap font-medium text-ink">{formatMoney(a.amountMinor, a.currency)}</Td>
                  <Td>{DECISION_TEXT[a.proposedDecision]}</Td>
                  <Td><StatusBadge status={a.status} /></Td>
                  <Td className="max-w-xs text-xs">{a.ruleResults.length ? a.ruleResults.map((r) => r.ruleName).join(", ") : <span className="text-muted">None</span>}</Td>
                  <Td className="text-xs">
                    {a.review ? (
                      <>{a.review.reviewer.name}{a.review.agentWasCorrect ? "" : <Badge tone="warn" className="ml-1">Agent wrong</Badge>}</>
                    ) : <span className="text-muted">—</span>}
                  </Td>
                  <Td className="whitespace-nowrap text-xs">{formatDateTime(a.createdAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {pages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">Page {result.page} of {pages}</span>
          <div className="flex gap-2">
            {result.page > 1 ? <LinkButton href={qs({ page: result.page - 1 })} size="sm">Previous</LinkButton> : null}
            {result.page < pages ? <LinkButton href={qs({ page: result.page + 1 })} size="sm">Next</LinkButton> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
