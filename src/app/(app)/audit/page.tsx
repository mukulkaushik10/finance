import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { listAuditRecords } from "@/server/audit/service";
import { Card, CardHeader, LinkButton, PageHeader, Select, Button, Table, Td, Th, Input } from "@/components/ui";
import { formatCount, formatDateTime } from "@/lib/format";
import { VerifyChain } from "./verify";
import { ExportEvidence } from "./export";

export const metadata = { title: "Audit trail" };

const EVENT_LABEL: Record<string, string> = {
  "action.evaluated": "Invoice checked",
  "action.reviewed": "Human decision",
  "rule.created": "Rule created",
  "rule.changed": "Rule changed",
  "autonomy.changed": "Autonomy changed",
  "workflow.settings_changed": "Limits changed",
  "replay.completed": "Replay finished",
  "evidence.exported": "Evidence exported",
  "agent.created": "Agent connected",
  "agent.changed": "Agent changed",
  "vendor.changed": "Vendor changed",
  "user.changed": "User changed",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await getPageCtx("audit:view");
  const sp = await searchParams;
  const result = await listAuditRecords(ctx, sp);
  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const qs = (patch: Record<string, string | number>) => "?" + new URLSearchParams({ ...sp, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v)])) }).toString();

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every invoice, decision and policy change, in order. Records can only be added, never edited, and each one is fingerprinted and linked to the one before it, so any change is detectable."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <VerifyChain />
        {can(ctx.user.role, "audit:export") ? <ExportEvidence defaults={{ from: sp.from, to: sp.to, vendor: sp.vendor }} /> : null}
      </div>

      <Card className="mt-6">
        <CardHeader
          title={`Records (${formatCount(result.total)})`}
          action={
            <form method="get" className="flex gap-2">
              <Select name="eventType" defaultValue={sp.eventType ?? ""}>
                <option value="">All events</option>
                {Object.entries(EVENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Input name="entity" defaultValue={sp.entity ?? ""} placeholder="Record about (ID)" className="w-44" />
              <Button variant="secondary" type="submit">Filter</Button>
            </form>
          }
        />
        <Table data-testid="audit-table">
          <thead><tr><Th>#</Th><Th>When</Th><Th>Event</Th><Th>What happened</Th><Th>By</Th><Th>Fingerprint</Th></tr></thead>
          <tbody>
            {result.rows.map((r) => (
              <tr key={r.id} id={`seq-${r.seq}`}>
                <Td className="tabular text-xs">{r.seq}</Td>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(r.occurredAt)}</Td>
                <Td className="whitespace-nowrap">{EVENT_LABEL[r.eventType] ?? r.eventType}</Td>
                <Td className="max-w-lg">
                  {r.entityType === "action" ? <Link href={`/actions/${r.entityId}`} className="hover:underline">{r.summary}</Link> : r.summary}
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted">Full record</summary>
                    <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-2 p-2 text-[11px] leading-snug">{JSON.stringify(r.payload, null, 2)}</pre>
                  </details>
                </Td>
                <Td className="whitespace-nowrap text-xs">{r.actorName}</Td>
                <Td className="font-mono text-[11px] text-muted" title={`Fingerprint ${r.hash}\nLinks to ${r.prevHash}`}>{r.hash.slice(0, 12)}…</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {pages > 1 ? (
          <div className="flex items-center justify-between px-5 py-3 text-sm">
            <span className="text-muted">Page {result.page} of {formatCount(pages)}</span>
            <div className="flex gap-2">
              {result.page > 1 ? <LinkButton size="sm" href={qs({ page: result.page - 1 })}>Newer</LinkButton> : null}
              {result.page < pages ? <LinkButton size="sm" href={qs({ page: result.page + 1 })}>Older</LinkButton> : null}
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}
