"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, ShieldCheck } from "lucide-react";
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Alert, Badge, Card, CardBody, CardHeader, PageHeader, Table, Td, Th } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { formatCount, formatDateTime, formatPct } from "@/lib/format";
import { cn } from "@/lib/cn";

// Categorical series slots (validated: blue, orange, aqua). Aqua is under 3:1, so bars carry direct labels and a table view.
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a"];
const DECISION_LABEL: Record<string, string> = { approve: "Approve", reject: "Reject", escalate: "Escalate", no_answer: "No answer" };
const KIND_LABEL: Record<string, string> = {
  mis_approved: "Approved when it shouldn't have",
  wrongly_rejected: "Rejected a good invoice",
  unnecessary_escalation: "Escalated a good invoice",
  no_answer: "No answer",
  other: "Wrong decision",
};

type Report = any;

export function ComparisonReport({ id }: { id: string }) {
  const [data, setData] = useState<{ comparison: any; reports: Report[]; done: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const res = await fetch(`/api/replay/comparisons/${id}`, { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (stop) return;
      if (!res.ok) { setError(json?.error?.message ?? "Could not load replay"); return; }
      setData(json);
      if (!json.done) timer = setTimeout(load, 1000);
    };
    load();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  if (error) return <Alert tone="bad">{error}</Alert>;
  if (!data) return <div className="text-sm text-muted">Loading…</div>;
  const { comparison, reports, done } = data;
  const currency = reports[0]?.money.currency ?? "USD";

  return (
    <>
      <Link href="/replay" className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> Replay testing</Link>
      <PageHeader
        title={comparison.name}
        description={`Invoice set “${comparison.dataset.name}”: ${formatCount(comparison.dataset.rowCount)} past invoices with known correct outcomes · started ${formatDateTime(comparison.createdAt)}`}
      />

      {!done ? (
        <Card className="mb-6">
          <CardHeader title="Replaying invoices…" description="This page updates by itself." />
          <CardBody className="space-y-3">
            {reports.map((r: Report, i: number) => (
              <div key={r.runId}>
                <div className="mb-1 flex justify-between text-sm"><span className="font-medium">{r.agent.name}</span><span className="tabular text-muted">{formatCount(r.processed)} / {formatCount(r.total)}</span></div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full transition-all" style={{ width: `${(r.processed / Math.max(1, r.total)) * 100}%`, background: SERIES[i] }} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}

      {reports.some((r: Report) => r.status === "failed") ? <Alert tone="bad" className="mb-6">One of the runs failed. Results shown may be incomplete.</Alert> : null}

      {done ? (
        <>
          <SideBySide reports={reports} currency={currency} />
          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-3">
              <CardHeader title="Accuracy by decision type" description="Of the invoices that should have been approved, rejected or escalated, how many each agent got right." />
              <CardBody><AccuracyChart reports={reports} /></CardBody>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader title="Your rules as a safety net" description="Wrong approvals your current rules would have held back before payment." />
              <CardBody className="space-y-4">
                {reports.map((r: Report, i: number) => (
                  <div key={r.runId}>
                    <div className="flex items-center gap-2 text-sm font-medium"><Swatch i={i} />{r.agent.name}</div>
                    <div className="mt-1 text-sm text-ink-2">
                      {r.money.misApprovedCount === 0 ? "No wrong approvals." : (
                        <>
                          <span className="font-semibold text-ink">{formatCount(r.money.caughtByRulesCount)} of {formatCount(r.money.misApprovedCount)}</span> wrong approvals caught
                          ({formatMoney(r.money.caughtByRulesMinor, currency)}).{" "}
                          {r.money.misApprovedAfterRulesCount > 0
                            ? <span className="text-bad">{formatMoney(r.money.misApprovedAfterRulesMinor, currency)} would still have been paid.</span>
                            : <span className="text-good">Nothing would have been paid in error.</span>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card className="mt-6">
            <div className="flex gap-1 border-b border-border px-3 pt-2" role="tablist">
              {reports.map((r: Report, i: number) => (
                <button key={r.runId} role="tab" aria-selected={tab === i} onClick={() => setTab(i)}
                  className={cn("flex items-center gap-2 rounded-t-md px-3 py-2 text-sm font-medium", tab === i ? "border-b-2 border-brand text-ink" : "text-muted hover:text-ink")}>
                  <Swatch i={i} />{r.agent.name}
                </button>
              ))}
            </div>
            {reports[tab] ? <AgentDetail report={reports[tab]} currency={currency} /> : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

function Swatch({ i }: { i: number }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SERIES[i] }} aria-hidden />;
}

function SideBySide({ reports, currency }: { reports: Report[]; currency: string }) {
  type Row = { label: string; hint?: string; value: (r: Report) => number | null; show: (r: Report) => string; better: "high" | "low" };
  const rows: Row[] = [
    { label: "Overall accuracy", hint: "Decision matched the known correct outcome", value: (r) => r.accuracy, show: (r) => formatPct(r.accuracy), better: "high" },
    { label: "Money approved in error", hint: "Approved, but should have been rejected or escalated", value: (r) => r.money.misApprovedMinor, show: (r) => `${formatMoney(r.money.misApprovedMinor, currency)} (${formatCount(r.money.misApprovedCount)})`, better: "low" },
    { label: "…still paid with your rules on", value: (r) => r.money.misApprovedAfterRulesMinor, show: (r) => formatMoney(r.money.misApprovedAfterRulesMinor, currency), better: "low" },
    { label: "Money wrongly blocked", hint: "Good invoices the agent rejected", value: (r) => r.money.wronglyBlockedMinor, show: (r) => `${formatMoney(r.money.wronglyBlockedMinor, currency)} (${formatCount(r.money.wronglyBlockedCount)})`, better: "low" },
    { label: "Good invoices escalated", hint: "Extra work for your team", value: (r) => r.money.unnecessaryEscalationCount, show: (r) => formatCount(r.money.unnecessaryEscalationCount), better: "low" },
    { label: "GL code accuracy", hint: "On invoices correctly approved", value: (r) => r.glAccuracy, show: (r) => formatPct(r.glAccuracy), better: "high" },
    { label: "No answer / errors", value: (r) => r.agentErrors, show: (r) => formatCount(r.agentErrors), better: "low" },
    { label: "Average response time", value: (r) => r.avgLatencyMs, show: (r) => (r.avgLatencyMs === null ? "—" : r.avgLatencyMs < 1 ? "under 1 ms" : `${formatCount(r.avgLatencyMs)} ms`), better: "low" },
    { label: "Estimated cost for this set", value: (r) => r.estimatedCostMinor, show: (r) => formatMoney(r.estimatedCostMinor, currency), better: "low" },
  ];
  return (
    <Card data-testid="side-by-side">
      <CardHeader title="Side by side" description={reports.length > 1 ? "The better result in each row is marked." : undefined} />
      <Table>
        <thead>
          <tr>
            <Th className="w-[34%]">&nbsp;</Th>
            {reports.map((r: Report, i: number) => (
              <Th key={r.runId} className="normal-case tracking-normal">
                <div className="flex items-center gap-2 text-sm font-semibold text-ink"><Swatch i={i} />{r.agent.name}</div>
                <div className="text-xs font-normal text-muted">{r.agent.vendorName ?? ""} · v{r.agent.version}</div>
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const vals = reports.map(row.value).map((v: number | null) => (v === null ? null : Number(v)));
            const valid = vals.filter((v): v is number => v !== null);
            const best = valid.length > 1 ? (row.better === "high" ? Math.max(...valid) : Math.min(...valid)) : null;
            const tie = best !== null && valid.filter((v) => v === best).length > 1;
            return (
              <tr key={row.label}>
                <Td>
                  <div className="font-medium text-ink">{row.label}</div>
                  {row.hint ? <div className="text-xs text-muted">{row.hint}</div> : null}
                </Td>
                {reports.map((r: Report, i: number) => {
                  const isBest = best !== null && !tie && vals[i] === best;
                  return (
                    <Td key={r.runId} className="tabular">
                      <span className={cn(isBest && "font-semibold text-ink")}>{row.show(r)}</span>
                      {isBest ? <CheckCircle2 className="ml-1.5 inline h-4 w-4 text-good" aria-label="Better" /> : null}
                    </Td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function AccuracyChart({ reports }: { reports: Report[] }) {
  const data = ["approve", "reject", "escalate"].map((d) => {
    const row: Record<string, string | number> = { decision: `Should ${d}`, total: reports[0]?.byDecision[d].total ?? 0 };
    reports.forEach((r: Report, i: number) => { row[`a${i}`] = Math.round((r.byDecision[d].accuracy ?? 0) * 1000) / 10; });
    return row;
  });
  return (
    <div className="h-72" role="img" aria-label="Accuracy by decision type for each agent">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 22, right: 8, left: -12, bottom: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="#e8eaee" />
          <XAxis dataKey="decision" tickLine={false} axisLine={{ stroke: "#cdd2da" }} tick={{ fontSize: 12, fill: "#374151" }} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: "#6b7280" }} />
          <Tooltip
            cursor={{ fill: "rgba(17,24,39,0.04)" }}
            formatter={(v: number, key: string) => [`${v}%`, reports[Number(key.slice(1))]?.agent.name]}
            labelFormatter={(l, p) => `${l} (${p?.[0]?.payload?.total ?? 0} invoices)`}
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e5ea", fontSize: 12 }}
          />
          {reports.length > 1 ? <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12, color: "#374151" }} formatter={(_v, _e, i) => <span style={{ color: "#374151" }}>{reports[i]?.agent.name}</span>} /> : null}
          {reports.map((r: Report, i: number) => (
            <Bar key={r.runId} dataKey={`a${i}`} name={r.agent.name} fill={SERIES[i]} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
              <LabelList dataKey={`a${i}`} position="top" formatter={(v: number) => `${Math.round(v)}%`} style={{ fontSize: 11, fill: "#374151" }} />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function AgentDetail({ report, currency }: { report: Report; currency: string }) {
  const cols = ["approve", "reject", "escalate", "no_answer"];
  return (
    <div>
      <div className="grid gap-6 px-5 py-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <h3 className="text-sm font-semibold">What the agent decided vs. the correct outcome</h3>
          <p className="mb-3 text-xs text-muted">Rows are the correct outcome; columns are what the agent decided. The diagonal is right.</p>
          <table className="w-full text-sm" data-testid="confusion-matrix">
            <thead>
              <tr>
                <th className="pb-2 text-left text-xs font-medium text-muted">Correct ↓ / Agent →</th>
                {cols.map((c) => <th key={c} className="pb-2 text-right text-xs font-medium text-muted">{DECISION_LABEL[c]}</th>)}
              </tr>
            </thead>
            <tbody>
              {["approve", "reject", "escalate"].map((row) => {
                const total = report.byDecision[row].total || 1;
                return (
                  <tr key={row}>
                    <td className="py-1 pr-2 text-xs font-medium text-ink-2">{DECISION_LABEL[row]}</td>
                    {cols.map((c) => {
                      const n = report.confusion[row][c];
                      const share = n / total;
                      const diag = row === c;
                      return (
                        <td key={c} className="p-0.5">
                          <div
                            className={cn("rounded px-2 py-1.5 text-right tabular", diag ? "font-semibold" : "", share > 0.55 ? "text-white" : "text-ink")}
                            style={{ background: n === 0 ? "#f4f5f7" : diag ? rampGood(share) : rampBad(share) }}
                            title={`${formatCount(n)} of ${formatCount(total)} (${formatPct(share)})`}
                          >
                            {formatCount(n)}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:col-span-3">
          <Mini label="Accuracy" value={formatPct(report.accuracy)} />
          <Mini label="GL code accuracy" value={formatPct(report.glAccuracy)} />
          <Mini label="Approved in error" value={formatMoney(report.money.misApprovedMinor, currency)} sub={`${formatCount(report.money.misApprovedCount)} invoices`} tone={report.money.misApprovedCount ? "bad" : undefined} />
          <Mini label="Wrongly blocked" value={formatMoney(report.money.wronglyBlockedMinor, currency)} sub={`${formatCount(report.money.wronglyBlockedCount)} invoices`} tone={report.money.wronglyBlockedCount ? "warn" : undefined} />
        </div>
      </div>
      <div className="border-t border-border">
        <div className="px-5 pb-2 pt-4">
          <h3 className="text-sm font-semibold">The {Math.min(20, report.worstErrors.length)} worst mistakes</h3>
          <p className="text-xs text-muted">Wrong approvals first, then wrongly rejected invoices, largest amounts first.</p>
        </div>
        {report.worstErrors.length === 0 ? (
          <div className="px-5 pb-5 text-sm text-muted">No mistakes on this set.</div>
        ) : (
          <Table data-testid="worst-errors">
            <thead>
              <tr><Th>Invoice</Th><Th className="text-right">Amount</Th><Th>Should have</Th><Th>Agent</Th><Th>What went wrong</Th><Th>What the rules found</Th></tr>
            </thead>
            <tbody>
              {report.worstErrors.map((w: any) => (
                <tr key={w.caseId}>
                  <Td><div className="font-medium text-ink">{w.invoiceId}</div><div className="text-xs text-muted">{w.vendor}</div></Td>
                  <Td className="text-right tabular whitespace-nowrap">{formatMoney(w.amountMinor, w.currency)}</Td>
                  <Td>{DECISION_LABEL[w.expected]}</Td>
                  <Td>{w.agentDecision ? DECISION_LABEL[w.agentDecision] : "No answer"}</Td>
                  <Td>
                    <div className="font-medium text-ink">{KIND_LABEL[w.kind]}</div>
                    {w.agentReason ? <div className="text-xs text-muted">Agent said: “{w.agentReason}”</div> : null}
                  </Td>
                  <Td className="max-w-sm">
                    {w.whatTheRulesFound.length ? <div className="text-xs">{w.whatTheRulesFound[0]}{w.whatTheRulesFound.length > 1 ? ` (+${w.whatTheRulesFound.length - 1} more)` : ""}</div> : <div className="text-xs text-muted">All rules passed</div>}
                    {w.kind === "mis_approved" ? (
                      w.caughtByRules
                        ? <Badge tone="good" className="mt-1"><ShieldCheck className="h-3 w-3" /> Rules would have held it</Badge>
                        : <Badge tone="bad" className="mt-1">Would have been paid</Badge>
                    ) : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" | "warn" }) {
  return (
    <div className="rounded-lg border border-border px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular", tone === "bad" ? "text-bad" : tone === "warn" ? "text-warn" : "text-ink")}>{value}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

// Sequential single-hue ramps (light -> dark) for the matrix cells: blue for correct, red-orange for errors.
function rampGood(t: number) {
  const steps = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#1c5cab"];
  return steps[Math.min(steps.length - 1, Math.floor(t * steps.length))];
}
function rampBad(t: number) {
  const steps = ["#fde3d8", "#f9c3ad", "#f3a283", "#eb6834", "#c9501f", "#a33f17"];
  return steps[Math.min(steps.length - 1, Math.floor(Math.sqrt(t) * steps.length))];
}
