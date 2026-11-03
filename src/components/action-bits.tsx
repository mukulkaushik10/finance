import { CheckCircle2, CircleSlash, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/ui";

export const STATUS: Record<string, { label: string; tone: Tone }> = {
  logged: { label: "Recorded (shadow)", tone: "neutral" },
  auto_approved: { label: "Approved automatically", tone: "good" },
  pending_review: { label: "Waiting for review", tone: "warn" },
  approved: { label: "Approved by a person", tone: "good" },
  rejected: { label: "Rejected", tone: "neutral" },
  blocked: { label: "Blocked", tone: "bad" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export const DECISION_TEXT: Record<string, string> = { approve: "Approve", reject: "Reject", escalate: "Send to a person" };

export const APPROVER_TEXT: Record<string, string> = { reviewer: "Any reviewer", controller: "Controller or above", admin: "CFO / admin" };

export function RuleResultIcon({ result }: { result: string }) {
  if (result === "pass") return <CheckCircle2 className="h-4 w-4 shrink-0 text-good" aria-label="Passed" />;
  if (result === "fail") return <XCircle className="h-4 w-4 shrink-0 text-bad" aria-label="Failed" />;
  return <CircleSlash className="h-4 w-4 shrink-0 text-muted" aria-label="Not applicable" />;
}

export function RuleResultList({ results }: { results: { id: string; ruleName: string; result: string; explanation: string; severity: string; ruleVersion?: { version: number } | null }[] }) {
  return (
    <ul className="divide-y divide-border">
      {results.map((r) => (
        <li key={r.id} className="flex gap-3 py-2.5" data-testid={`rule-result-${r.result}`}>
          <RuleResultIcon result={r.result} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium text-ink">{r.ruleName}</span>
              {r.result === "fail" ? <Badge tone={r.severity === "block" ? "bad" : "warn"}>{r.severity === "block" ? "Stops the invoice" : "Needs a person"}</Badge> : null}
              {r.ruleVersion ? <span className="text-xs text-muted">v{r.ruleVersion.version}</span> : null}
            </div>
            <div className="text-sm text-ink-2">{r.explanation}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}
