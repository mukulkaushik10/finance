import { getPageCtx } from "@/server/auth/page";
import { can } from "@/server/auth/permissions";
import { getAutonomyState } from "@/server/autonomy/service";
import { getPrimaryWorkflow } from "@/server/workflows/service";
import { AUTONOMY_LEVELS } from "@/server/gate/decide";
import { Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatBps, formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { AutonomyControls } from "./controls";

export const metadata = { title: "Autonomy" };

export default async function AutonomyPage() {
  const ctx = await getPageCtx("autonomy:view");
  const wf = await getPrimaryWorkflow(ctx);
  const state = await getAutonomyState(ctx, wf.id);
  const w = state.workflow;
  const acc = state.accuracy;
  const pct = acc.accuracyBps === null ? 0 : acc.accuracyBps / 100;
  const target = w.promotionTargetBps / 100;

  return (
    <>
      <PageHeader
        title="Autonomy"
        description="How much the agent may do without a person. It moves up one level at a time, only once it has proven itself on invoices your team reviewed, and only when someone confirms."
      />

      <div className="grid gap-4 md:grid-cols-4" data-testid="levels">
        {AUTONOMY_LEVELS.map((l) => (
          <div key={l.level} className={cn("rounded-lg border px-4 py-3", l.level === w.autonomyLevel ? "border-brand bg-brand-soft/50 ring-1 ring-brand/30" : "border-border bg-surface")}>
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted">Level {l.level}</div>
              {l.level === w.autonomyLevel ? <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-white" data-testid="current-level">Current</span> : null}
            </div>
            <div className="mt-1 font-semibold">{l.name}</div>
            <div className="mt-1 text-sm text-muted">
              {l.level === 2 ? `Invoices that pass every rule and are at or under ${formatMoney(w.autoApproveLimitMinor, w.currency)} go through automatically.` : l.description}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Track record" description={`How often the agent's decision matched your reviewers' over the last ${w.promotionWindow} reviewed invoices.`} />
          <CardBody>
            <div className="flex items-end gap-6">
              <div>
                <div className="text-4xl font-semibold tabular" data-testid="rolling-accuracy">{acc.accuracyBps === null ? "—" : formatBps(acc.accuracyBps)}</div>
                <div className="text-sm text-muted">{acc.correct} of {acc.sampleSize} reviewed invoices</div>
              </div>
              <div className="text-sm text-muted">Target <span className="font-semibold text-ink">{formatBps(w.promotionTargetBps)}</span></div>
            </div>
            <div className="relative mt-4 h-2 rounded-full bg-surface-2" role="img" aria-label={`Accuracy ${pct}% against target ${target}%`}>
              <div className={cn("h-full rounded-full", pct >= target ? "bg-good" : "bg-warn")} style={{ width: `${Math.min(100, pct)}%` }} />
              <div className="absolute -top-1 h-4 w-0.5 bg-ink" style={{ left: `${target}%` }} title="Target" />
            </div>
            <div className="mt-4 text-sm">
              <span className="font-medium">{state.promotion.nextLevel !== null ? `Level ${state.promotion.nextLevel}: ` : ""}</span>
              {state.promotion.reason}
            </div>
            {w.autonomyLevel >= 2 ? (
              <p className="mt-2 text-xs text-muted">At Level 2 and above, people mostly review the harder invoices, so this figure tends to understate accuracy on routine ones.</p>
            ) : null}
            {state.pendingShadowSpotChecks ? <p className="mt-2 text-xs text-muted">{state.pendingShadowSpotChecks} shadow-mode decisions are waiting for a spot check in the review queue.</p> : null}
          </CardBody>
        </Card>

        <AutonomyControls
          workflowId={w.id}
          level={w.autonomyLevel}
          canChange={can(ctx.user.role, "autonomy:change")}
          promotion={state.promotion}
          settings={{
            autoApproveLimitMinor: Number(w.autoApproveLimitMinor), currency: w.currency,
            confidenceThresholdBps: w.confidenceThresholdBps, promotionWindow: w.promotionWindow, promotionTargetBps: w.promotionTargetBps,
          }}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Level changes" description="Every change, who confirmed it, and the track record at the time." />
        <Table>
          <thead><tr><Th>When</Th><Th>Change</Th><Th>Accuracy at the time</Th><Th>Confirmed by</Th><Th>Reason</Th></tr></thead>
          <tbody>
            {state.history.length === 0 ? <tr><Td colSpan={5} className="text-muted">No changes yet.</Td></tr> : state.history.map((h) => (
              <tr key={h.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(h.createdAt)}</Td>
                <Td className="whitespace-nowrap">Level {h.fromLevel} → Level {h.toLevel} {h.toLevel > h.fromLevel ? "(promotion)" : "(moved down)"}</Td>
                <Td className="tabular">{h.accuracyBps === null ? "—" : `${formatBps(h.accuracyBps)} of ${h.sampleSize}`}</Td>
                <Td>{h.confirmedBy}</Td>
                <Td className="max-w-md">{h.reason}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
