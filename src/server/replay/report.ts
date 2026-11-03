import type { Decision } from "@prisma/client";
import type { OrgDb } from "../db/dal";

export const DECISIONS: Decision[] = ["approve", "reject", "escalate"];
type Col = Decision | "no_answer";

export interface WorstError {
  invoiceId: string;
  vendor: string;
  amountMinor: bigint;
  currency: string;
  expected: Decision;
  agentDecision: Decision | null;
  kind: "mis_approved" | "wrongly_rejected" | "unnecessary_escalation" | "missed_rejection" | "no_answer" | "other";
  agentReason: string | null;
  whatTheRulesFound: string[];
  caughtByRules: boolean;
  caseId: string;
}

export interface RunReport {
  runId: string;
  agent: { id: string; name: string; vendorName: string | null; version: string; kind: string };
  status: string;
  processed: number;
  total: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  accuracy: number | null;
  glAccuracy: number | null;
  agentErrors: number;
  byDecision: Record<Decision, { total: number; correct: number; accuracy: number | null }>;
  confusion: Record<Decision, Record<Col, number>>;
  money: {
    currency: string;
    totalMinor: bigint;
    misApprovedMinor: bigint;      // agent approved, should not have
    misApprovedCount: number;
    wronglyBlockedMinor: bigint;   // should have been approved, agent rejected
    wronglyBlockedCount: number;
    unnecessaryEscalationMinor: bigint;
    unnecessaryEscalationCount: number;
    misApprovedAfterRulesMinor: bigint; // mis-approvals your rules would still have let through
    misApprovedAfterRulesCount: number;
    caughtByRulesMinor: bigint;
    caughtByRulesCount: number;
  };
  avgLatencyMs: number | null;
  estimatedCostMinor: bigint;
  worstErrors: WorstError[];
}

const SEVERITY: Record<WorstError["kind"], number> = {
  mis_approved: 5, missed_rejection: 4, wrongly_rejected: 3, no_answer: 2, unnecessary_escalation: 1, other: 0,
};

export async function computeRunReport(db: OrgDb, runId: string, worstN = 20): Promise<RunReport> {
  const run = await db.replayRun.findFirstOrThrow({ where: { id: runId }, include: { agent: true } });
  const rows = await db.replayResult.findMany({
    where: { runId },
    include: { case: { select: { id: true, externalRef: true, counterpartyName: true, amountMinor: true, currency: true, expectedDecision: true } } },
  });
  const confusion = Object.fromEntries(DECISIONS.map((d) => [d, { approve: 0, reject: 0, escalate: 0, no_answer: 0 }])) as RunReport["confusion"];
  const byDecision = Object.fromEntries(DECISIONS.map((d) => [d, { total: 0, correct: 0, accuracy: null as number | null }])) as RunReport["byDecision"];
  const m = {
    currency: rows[0]?.case.currency ?? "USD", totalMinor: 0n,
    misApprovedMinor: 0n, misApprovedCount: 0, wronglyBlockedMinor: 0n, wronglyBlockedCount: 0,
    unnecessaryEscalationMinor: 0n, unnecessaryEscalationCount: 0,
    misApprovedAfterRulesMinor: 0n, misApprovedAfterRulesCount: 0, caughtByRulesMinor: 0n, caughtByRulesCount: 0,
  };
  let correct = 0, glTotal = 0, glCorrect = 0, latency = 0, errors = 0;
  const wrong: WorstError[] = [];

  for (const r of rows) {
    const exp = r.case.expectedDecision;
    const got = r.agentDecision;
    const amt = r.case.amountMinor;
    m.totalMinor += amt;
    confusion[exp][got ?? "no_answer"]++;
    byDecision[exp].total++;
    latency += r.latencyMs;
    if (r.error) errors++;
    if (r.decisionCorrect) { correct++; byDecision[exp].correct++; }
    if (r.glCorrect !== null) { glTotal++; if (r.glCorrect) glCorrect++; }
    if (r.decisionCorrect) continue;

    let kind: WorstError["kind"] = "other";
    if (!got) kind = "no_answer";
    else if (got === "approve") kind = "mis_approved";
    else if (exp === "approve" && got === "reject") kind = "wrongly_rejected";
    else if (exp === "approve" && got === "escalate") kind = "unnecessary_escalation";
    else if (exp === "reject" && got === "escalate") kind = "missed_rejection";

    const caught = kind === "mis_approved" && r.gatedOutcome !== "auto_approve";
    if (kind === "mis_approved") {
      m.misApprovedMinor += amt; m.misApprovedCount++;
      if (caught) { m.caughtByRulesMinor += amt; m.caughtByRulesCount++; }
      else { m.misApprovedAfterRulesMinor += amt; m.misApprovedAfterRulesCount++; }
    }
    if (kind === "wrongly_rejected") { m.wronglyBlockedMinor += amt; m.wronglyBlockedCount++; }
    if (kind === "unnecessary_escalation") { m.unnecessaryEscalationMinor += amt; m.unnecessaryEscalationCount++; }
    // missed_rejection (escalated when it should have been rejected) is a safe error: a person still sees it.
    if (kind === "missed_rejection") kind = "other";

    wrong.push({
      caseId: r.case.id, invoiceId: r.case.externalRef, vendor: r.case.counterpartyName, amountMinor: amt, currency: r.case.currency,
      expected: exp, agentDecision: got, kind, agentReason: r.error ?? r.agentReason,
      whatTheRulesFound: (r.failedRules as { explanation: string }[]).map((f) => f.explanation),
      caughtByRules: caught,
    });
  }
  for (const d of DECISIONS) byDecision[d].accuracy = byDecision[d].total ? byDecision[d].correct / byDecision[d].total : null;
  wrong.sort((a, b) => SEVERITY[b.kind] - SEVERITY[a.kind] || (b.amountMinor > a.amountMinor ? 1 : b.amountMinor < a.amountMinor ? -1 : 0));

  return {
    runId,
    agent: { id: run.agent.id, name: run.agent.name, vendorName: run.agent.vendorName, version: run.agentVersion, kind: run.agent.kind },
    status: run.status,
    processed: run.processedCases,
    total: run.totalCases,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    accuracy: rows.length ? correct / rows.length : null,
    glAccuracy: glTotal ? glCorrect / glTotal : null,
    agentErrors: errors,
    byDecision,
    confusion,
    money: m,
    avgLatencyMs: rows.length ? Math.round(latency / rows.length) : null,
    estimatedCostMinor: run.agent.costPerActionMinor * BigInt(rows.length),
    worstErrors: wrong.slice(0, worstN),
  };
}

export async function computeComparison(db: OrgDb, comparisonId: string) {
  const comparison = await db.replayComparison.findFirst({
    where: { id: comparisonId },
    include: { dataset: true, runs: { orderBy: { createdAt: "asc" } } },
  });
  if (!comparison) return null;
  const reports = await Promise.all(comparison.runs.map((r) => computeRunReport(db, r.id)));
  const done = reports.every((r) => r.status === "completed" || r.status === "failed");
  return { comparison, reports, done };
}
