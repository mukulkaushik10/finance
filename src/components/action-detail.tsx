import Link from "next/link";
import { ArrowLeft, Download, FileText } from "lucide-react";
import type { getActionDetail } from "@/server/review/service";
import { Alert, Badge, Card, CardBody, CardHeader, LinkButton } from "@/components/ui";
import { APPROVER_TEXT, DECISION_TEXT, RuleResultList, StatusBadge } from "@/components/action-bits";
import { formatMoney, formatBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { ReviewPanel } from "./review-panel";
import type { InvoiceSubject } from "@/server/workflows/ap_invoice/subject";

type Detail = Awaited<ReturnType<typeof getActionDetail>>;

const EVENT_TEXT: Record<string, string> = {
  "action.evaluated": "Checked by Control Room",
  "action.reviewed": "Decided by a person",
};

export function ActionDetail({ detail, back, nextId, canExport }: { detail: Detail; back: { href: string; label: string }; nextId?: string | null; canExport: boolean }) {
  const { action: a, audit } = detail;
  const s = a.payload as unknown as InvoiceSubject;
  const failed = a.ruleResults.filter((r) => r.result === "fail");
  const reviewable = (a.status === "pending_review" || a.status === "logged") && !a.review;
  const reasons = a.gateReasons as string[];

  return (
    <>
      <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="h-4 w-4" /> {back.label}</Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{a.externalRef}</h1>
            <StatusBadge status={a.status} />
          </div>
          <div className="mt-1 text-sm text-muted">{a.counterpartyName} · invoice dated {formatDate(s.invoice_date)} · received {formatDateTime(a.createdAt)}</div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold tabular" data-testid="action-amount">{formatMoney(a.amountMinor, a.currency)}</div>
          {canExport ? (
            <LinkButton href={`/api/audit/export?actionId=${a.id}`} size="sm" className="mt-2" data-testid="export-action"><Download className="h-4 w-4" /> Evidence pack</LinkButton>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="What the agent proposed" />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Fact label="Decision" value={DECISION_TEXT[a.proposedDecision]} />
              <Fact label="GL code" value={a.proposedGlCode ?? "—"} />
              <Fact label="Confidence" value={a.agentConfidenceBps === null ? "Not given" : formatBps(a.agentConfidenceBps, 0)} />
              <div className="sm:col-span-3">
                <div className="text-xs font-medium uppercase tracking-wide text-muted">Agent's reason</div>
                <div className="mt-0.5 text-sm text-ink">{a.agentReason ? `“${a.agentReason}”` : "No reason given"}</div>
                <div className="mt-1 text-xs text-muted">{a.agent.name}{a.agent.vendorName ? ` (${a.agent.vendorName})` : ""} · version {a.agentVersion}</div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Control Room's checks" description={`${failed.length} of ${a.ruleResults.length} checks failed · autonomy Level ${a.autonomyLevel}`} />
            <CardBody className="py-1">
              <RuleResultList results={a.ruleResults} />
            </CardBody>
            <div className="border-t border-border px-5 py-3 text-sm">
              <span className="font-medium">Outcome: </span>
              {reasons.join(" · ")}
              {a.requiredRole ? <> · <Badge tone="info">{APPROVER_TEXT[a.requiredRole]}</Badge></> : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Invoice details" />
            <CardBody className="grid gap-4 sm:grid-cols-3">
              <Fact label="Vendor" value={`${s.vendor_name}${s.vendor_id ? ` (${s.vendor_id})` : ""}`} />
              <Fact label="Invoice number" value={s.invoice_number ?? s.invoice_id} />
              <Fact label="Invoice date" value={formatDate(s.invoice_date)} />
              <Fact label="PO number" value={s.po_number ?? "None"} />
              <Fact label="Goods received note" value={s.grn_number ?? "None"} />
              <Fact label="Currency" value={a.currency} />
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          {a.review ? (
            <Card data-testid="review-record">
              <CardHeader title={a.status === "logged" ? "Spot check" : "Decision"} />
              <CardBody className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Badge tone={a.review.decision === "approve" ? "good" : "neutral"}>{a.review.decision === "approve" ? "Approved" : "Rejected"}</Badge>
                  <span>by <span className="font-medium">{a.review.reviewer.name}</span></span>
                </div>
                <div className="text-ink">“{a.review.reason}”</div>
                <div className="text-xs text-muted">{formatDateTime(a.review.createdAt)}</div>
                <div className="text-xs text-muted">
                  {a.review.agentWasCorrect ? "Counted as the agent being right." : `Counted as the agent being wrong (correct answer: ${DECISION_TEXT[a.review.correctDecision].toLowerCase()}).`}
                </div>
                {a.review.decision === "approve" && failed.length ? <Alert tone="warn">Approved even though {failed.length} check{failed.length > 1 ? "s" : ""} failed. This counts as money at risk.</Alert> : null}
              </CardBody>
            </Card>
          ) : reviewable ? (
            detail.canReview ? (
              <ReviewPanel actionId={a.id} escalated={a.proposedDecision === "escalate"} spotCheck={a.status === "logged"} failedCount={failed.length} nextId={nextId ?? null} />
            ) : (
              <Alert tone="info" title="You can't decide this one">
                {a.requiredRole ? `It needs ${APPROVER_TEXT[a.requiredRole].toLowerCase()}.` : "Your role is read-only."}
              </Alert>
            )
          ) : null}

          <Card>
            <CardHeader title="Audit trail" description="Tamper-evident record of this invoice" />
            <CardBody>
              <ol className="space-y-3">
                {audit.map((r) => (
                  <li key={r.id} className="text-sm">
                    <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted" /><span className="font-medium">{EVENT_TEXT[r.eventType] ?? r.eventType}</span></div>
                    <div className="ml-6 text-xs text-muted">Record #{r.seq} · {formatDateTime(r.occurredAt)}</div>
                    <div className="ml-6 font-mono text-[11px] text-muted" title={r.hash}>{r.hash.slice(0, 16)}…</div>
                  </li>
                ))}
              </ol>
              <Link href={`/audit?entity=${a.id}`} className="mt-3 inline-block text-sm text-brand hover:underline">Open in audit trail</Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  );
}
