import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { forOrg } from "@/server/db/dal";
import { listDatasets } from "@/server/replay/service";
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatDateTime, formatCount } from "@/lib/format";
import { ReplaySetup } from "./replay-setup";

export const metadata = { title: "Replay testing" };

const STATUS_TONE = { queued: "neutral", running: "info", completed: "good", failed: "bad" } as const;

export default async function ReplayPage() {
  const ctx = await getPageCtx("replay:view");
  const db = forOrg(ctx.organisationId);
  const [datasets, agents] = await Promise.all([
    listDatasets(ctx),
    db.agent.findMany({ where: { active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, vendorName: true, kind: true, version: true } }),
  ]);
  const comparisons = datasets.flatMap((d) => d.comparisons.map((c) => ({ ...c, dataset: d })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <>
      <PageHeader
        title="Replay testing"
        description="Before an agent goes live, replay past invoices whose correct outcome you already know. See how often it gets them right, and how much money its mistakes would have cost."
      />
      {can(ctx.user.role, "replay:run") ? (
        <ReplaySetup
          datasets={datasets.map((d) => ({ id: d.id, name: d.name, rowCount: d.rowCount, createdAt: d.createdAt.toISOString() }))}
          agents={agents}
        />
      ) : null}

      <Card className="mt-6">
        <CardHeader title="Past replays" description="Each replay sends every invoice in the set to the chosen agents and compares their answers with the known correct outcome." />
        {comparisons.length === 0 ? (
          <EmptyState title="No replays yet">Upload a set of past invoices above and choose the agents to compare.</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>Replay</Th><Th>Invoice set</Th><Th>Agents</Th><Th>Started</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {comparisons.map((c) => {
                const status = c.runs.some((r) => r.status === "failed") ? "failed"
                  : c.runs.every((r) => r.status === "completed") ? "completed"
                  : c.runs.some((r) => r.status === "running") ? "running" : "queued";
                return (
                  <tr key={c.id} className="hover:bg-surface-2/50">
                    <Td><Link href={`/replay/${c.id}`} className="font-medium text-brand hover:underline">{c.name}</Link></Td>
                    <Td>{c.dataset.name} <span className="text-muted">· {formatCount(c.dataset.rowCount)} invoices</span></Td>
                    <Td>{c.runs.map((r) => r.agent.name).join(", ")}</Td>
                    <Td className="whitespace-nowrap">{formatDateTime(c.createdAt)}</Td>
                    <Td><Badge tone={STATUS_TONE[status]}>{status === "completed" ? "Finished" : status === "running" ? "Running" : status === "failed" ? "Failed" : "Waiting"}</Badge></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
