import Link from "next/link";
import { getPageCtx } from "@/server/auth/page";
import { getScorecard, type WeekStats } from "@/server/scorecard/service";
import { getPrimaryWorkflow } from "@/server/workflows/service";
import { AUTONOMY_LEVELS } from "@/server/gate/decide";
import { Card, CardHeader, PageHeader, Table, Td, Th, Alert } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatCount, formatDate, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";
import { OutcomeChart } from "./outcome-chart";

export const metadata = { title: "Scorecard" };

type Metric = {
  key: string; label: string; value: string; href: string; sub: string;
  series: (number | null)[]; format: (v: number) => string;
  delta: { text: string; good: boolean | null } | null; tone?: "bad";
};

export default async function ScorecardPage({ searchParams }: { searchParams: Promise<{ week?: string; denied?: string }> }) {
  const ctx = await getPageCtx("scorecard:view");
  const sp = await searchParams;
  const [sc, wf] = await Promise.all([getScorecard(ctx, { week: sp.week }), getPrimaryWorkflow(ctx)]);
  const { selected: w, previous: p, weeks, currency, links } = sc;
  const money = (m: bigint | number) => formatMoney(typeof m === "number" ? BigInt(Math.round(m)) : m, currency, { compact: true });

  const delta = (cur: number | null, prev: number | null | undefined, kind: "pct" | "count" | "money", higherIsGood: boolean | null): Metric["delta"] => {
    if (cur === null || prev === null || prev === undefined) return null;
    const d = cur - prev;
    if (d === 0) return { text: "same as the week before", good: null };
    const txt = kind === "pct" ? `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)} pts` : kind === "money" ? `${d > 0 ? "+" : "-"}${money(Math.abs(d))}` : `${d > 0 ? "+" : ""}${formatCount(d)}`;
    return { text: `${txt} vs the week before`, good: higherIsGood === null ? null : (d > 0) === higherIsGood };
  };
  const n = (b: bigint) => Number(b);

  const metrics: Metric[] = [
    { key: "volume", label: "Invoices handled", value: formatCount(w.volume), href: links.volume, sub: `${formatCount(w.autoApproved)} approved automatically`, series: weeks.map((x) => x.volume), format: (v) => formatCount(v), delta: delta(w.volume, p?.volume, "count", null) },
    { key: "accuracy", label: "Agent accuracy", value: formatPct(w.accuracy), href: links.accuracy, sub: `Agreed with people on ${formatCount(w.agentCorrect)} of ${formatCount(w.reviewed)} reviewed`, series: weeks.map((x) => x.accuracy), format: (v) => formatPct(v), delta: delta(w.accuracy, p?.accuracy, "pct", true) },
    { key: "escalation", label: "Sent to a person", value: formatPct(w.escalationRate), href: links.escalation, sub: `${formatCount(w.escalated)} invoices${w.pending ? ` · ${formatCount(w.pending)} still waiting` : ""}`, series: weeks.map((x) => x.escalationRate), format: (v) => formatPct(v), delta: delta(w.escalationRate, p?.escalationRate, "pct", false) },
    { key: "auto", label: "Money approved automatically", value: money(w.autoApprovedMinor), href: links.autoApproved, sub: `${formatCount(w.autoApproved)} invoices with no person involved`, series: weeks.map((x) => n(x.autoApprovedMinor)), format: (v) => money(v), delta: delta(n(w.autoApprovedMinor), p ? n(p.autoApprovedMinor) : null, "money", null) },
    { key: "risk", label: "Money at risk", value: money(w.moneyAtRiskMinor), href: links.moneyAtRisk, sub: `${formatCount(w.moneyAtRiskCount)} invoices paid despite a failed check`, series: weeks.map((x) => n(x.moneyAtRiskMinor)), format: (v) => money(v), delta: delta(n(w.moneyAtRiskMinor), p ? n(p.moneyAtRiskMinor) : null, "money", false), tone: w.moneyAtRiskCount ? "bad" : undefined },
    { key: "cost", label: "Agent cost per invoice", value: w.costPerActionMinor === null ? "—" : formatMoney(w.costPerActionMinor, currency), href: links.cost, sub: `${formatMoney(w.costMinor, currency)} for the week`, series: weeks.map((x) => (x.costPerActionMinor === null ? null : n(x.costPerActionMinor))), format: (v) => formatMoney(BigInt(Math.round(v)), currency), delta: null },
  ];

  return (
    <>
      <PageHeader
        title="Scorecard"
        description={`Accounts payable · ${wf.name.split("—")[1]?.trim() ?? wf.name} · Level ${wf.autonomyLevel}: ${AUTONOMY_LEVELS[wf.autonomyLevel].name}`}
      />
      {sp.denied ? <Alert tone="warn" className="mb-4">You don't have access to that page.</Alert> : null}
      <div className="mb-5 flex flex-wrap items-center gap-1.5" aria-label="Choose week">
        <span className="mr-1 text-sm text-muted">Week of</span>
        {weeks.slice().reverse().map((x) => (
          <Link key={x.weekStart} href={`/?week=${x.weekStart}`} data-testid={`week-${x.weekStart}`}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", x.weekStart === w.weekStart ? "border-brand bg-brand text-white" : "border-border bg-surface text-ink-2 hover:border-brand/40")}>
            {formatDate(x.weekStart).replace(/ \d{4}$/, "")}{x.partial ? " (so far)" : ""}
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="kpis">
        {metrics.map((m) => <MetricTile key={m.key} m={m} weeks={weeks} selectedIdx={weeks.indexOf(w)} />)}
      </div>

      <Card className="mt-6">
        <CardHeader title="What happened to each week's invoices" description="Every bar is one week; select a week above to see its numbers. The table below has the same figures." />
        <div className="px-3 py-4"><OutcomeChart weeks={weeks.map((x) => ({ label: formatDate(x.weekStart).replace(/ \d{4}$/, ""), partial: x.partial, ...x.byStatus }))} /></div>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Week by week" />
        <Table data-testid="weekly-table">
          <thead>
            <tr><Th>Week of</Th><Th className="text-right">Invoices</Th><Th className="text-right">Accuracy</Th><Th className="text-right">Sent to a person</Th><Th className="text-right">Approved automatically</Th><Th className="text-right">Money at risk</Th><Th className="text-right">Cost per invoice</Th></tr>
          </thead>
          <tbody>
            {weeks.slice().reverse().map((x) => {
              const q = `from=${x.weekStart}&to=${x.weekEnd}`;
              return (
                <tr key={x.weekStart} className={cn(x.weekStart === w.weekStart && "bg-brand-soft/40")}>
                  <Td className="whitespace-nowrap">{formatDate(x.weekStart)}{x.partial ? <span className="text-muted"> (so far)</span> : null}</Td>
                  <Td className="text-right tabular"><Link className="hover:underline" href={`/actions?${q}`}>{formatCount(x.volume)}</Link></Td>
                  <Td className="text-right tabular"><Link className="hover:underline" href={`/actions?${q}&flag=reviewed`}>{formatPct(x.accuracy)}</Link></Td>
                  <Td className="text-right tabular"><Link className="hover:underline" href={`/actions?${q}&flag=escalated`}>{formatPct(x.escalationRate)}</Link></Td>
                  <Td className="text-right tabular"><Link className="hover:underline" href={`/actions?${q}&status=auto_approved`}>{formatMoney(x.autoApprovedMinor, currency)}</Link></Td>
                  <Td className="text-right tabular"><Link className={cn("hover:underline", x.moneyAtRiskCount && "text-bad")} href={`/actions?${q}&flag=money_at_risk`}>{formatMoney(x.moneyAtRiskMinor, currency)}</Link></Td>
                  <Td className="text-right tabular">{x.costPerActionMinor === null ? "—" : formatMoney(x.costPerActionMinor, currency)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-muted">
        Accuracy compares the agent's decision with the decision of the person who reviewed the invoice. Money at risk is invoices that were paid even though a check failed: a person overrode the check, or the agent went ahead in shadow mode.
      </p>
    </>
  );
}

function MetricTile({ m, weeks, selectedIdx }: { m: Metric; weeks: WeekStats[]; selectedIdx: number }) {
  return (
    <Link href={m.href} className="group block rounded-lg border border-border bg-surface px-4 py-3 transition-colors hover:border-brand/50" data-testid={`kpi-${m.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-muted">{m.label}</div>
          <div className={cn("mt-1 text-3xl font-semibold tabular", m.tone === "bad" ? "text-bad" : "text-ink")} data-testid={`kpi-value-${m.key}`}>{m.value}</div>
        </div>
        <Sparkline series={m.series} selectedIdx={selectedIdx} format={m.format} labels={weeks.map((w) => formatDate(w.weekStart))} />
      </div>
      <div className="mt-1 text-xs text-muted">{m.sub}</div>
      {m.delta ? (
        <div className={cn("mt-1 text-xs font-medium", m.delta.good === null ? "text-ink-2" : m.delta.good ? "text-good" : "text-bad")}>{m.delta.text}</div>
      ) : null}
      <div className="mt-2 text-xs font-medium text-brand opacity-0 transition-opacity group-hover:opacity-100">See the invoices →</div>
    </Link>
  );
}

/** 8-week trend, 2px line, end dot with a surface ring; hover a point for its value. */
function Sparkline({ series, selectedIdx, format, labels }: { series: (number | null)[]; selectedIdx: number; format: (v: number) => string; labels: string[] }) {
  const W = 120, H = 40, P = 5;
  const vals = series.filter((v): v is number => v !== null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i: number) => P + (i * (W - 2 * P)) / (series.length - 1);
  const y = (v: number) => (max === min ? H / 2 : H - P - ((v - min) * (H - 2 * P)) / (max - min));
  const pts = series.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
  const d = pts.reduce((acc, pt, i) => (pt ? acc + `${acc && pts[i - 1] ? "L" : "M"}${pt[0].toFixed(1)},${pt[1].toFixed(1)}` : acc), "");
  const sel = pts[selectedIdx];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 overflow-visible" role="img" aria-label="Trend over the last weeks">
      <path d={d} fill="none" stroke="#2a78d6" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {sel ? <circle cx={sel[0]} cy={sel[1]} r={4} fill="#2a78d6" stroke="#ffffff" strokeWidth={2} /> : null}
      {pts.map((pt, i) => (pt ? (
        <circle key={i} cx={pt[0]} cy={pt[1]} r={7} fill="transparent">
          <title>{`${labels[i]}: ${format(series[i]!)}`}</title>
        </circle>
      ) : null))}
    </svg>
  );
}
