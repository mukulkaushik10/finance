"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { send } from "@/lib/send";

export function DecisionPanel({ invoiceId, blocked, failedCount }: { invoiceId: string; blocked: boolean; failedCount: number }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "approve" | "send_back" | "reject") {
    setBusy(decision); setError(null);
    try { await send(`/api/supplier-invoices/${invoiceId}/decision`, "POST", { decision, reason, messageToSupplier: message || undefined }); router.refresh(); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  }
  const short = reason.trim().length < 10;
  const noMsg = message.trim().length < 5;
  return (
    <Card className="border-brand/40 ring-1 ring-brand/10" data-testid="invoice-decision">
      <CardHeader title="Your decision" />
      <CardBody className="space-y-4">
        {blocked ? <Alert tone="bad">A control blocked this invoice, so it can’t be approved. Send it back or reject it.</Alert> : failedCount ? <Alert tone="warn">{failedCount} check{failedCount > 1 ? "s" : ""} failed. Approving overrides {failedCount > 1 ? "them" : "it"} and counts as money at risk.</Alert> : null}
        <Field label="Reason" hint="Required. Kept internal; the auditor sees it.">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Matches the PO and delivery note" data-testid="decision-reason" />
        </Field>
        <Field label="Message to the supplier" hint="Required to send back or reject. The supplier sees this.">
          <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Please add the PO number and send it again" data-testid="decision-message" />
        </Field>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <div className="grid gap-2">
          {!blocked ? <Button variant="good" disabled={short || busy !== null} onClick={() => decide("approve")} data-testid="invoice-approve">{busy === "approve" ? "Saving…" : "Approve"}</Button> : null}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={short || noMsg || busy !== null} onClick={() => decide("send_back")} data-testid="invoice-send-back">Send back for changes</Button>
            <Button variant="danger" disabled={short || noMsg || busy !== null} onClick={() => decide("reject")}>Reject</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

export function PaymentPanel({ invoiceId, status, amount, accounts, payTo, blockedReason }: {
  invoiceId: string; status: string; amount: string; accounts: { id: string; nickname: string; bankName: string; accountLast4: string; isDefault: boolean }[]; payTo: string | null; blockedReason: string | null;
}) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(accounts.find((a) => a.isDefault)?.id ?? accounts[0]?.id ?? "");
  const [payOn, setPayOn] = useState(today);
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go(url: string, body: unknown) {
    setBusy(true); setError(null);
    try { await send(url, "POST", body); router.refresh(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <Card data-testid="payment-panel">
      <CardHeader title={status === "scheduled" ? "Payment scheduled" : "Pay this invoice"} description={`${amount} to ${payTo ?? "no approved account"}`} />
      <CardBody className="space-y-3">
        {blockedReason ? <Alert tone="warn">{blockedReason}</Alert> : null}
        {accounts.length === 0 ? <Alert tone="info">Add a bank account under Settings → Bank accounts first.</Alert> : null}
        <Field label="Pay from">
          <Select value={from} onChange={(e) => setFrom(e.target.value)} data-testid="pay-from">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.nickname} · {a.bankName} ••{a.accountLast4}</option>)}
          </Select>
        </Field>
        <Field label={status === "scheduled" ? "Move payment date to" : "Payment date"}><Input type="date" min={today} value={payOn} onChange={(e) => setPayOn(e.target.value)} /></Field>
        <Button className="w-full" disabled={busy || !from || Boolean(blockedReason)} onClick={() => go(`/api/supplier-invoices/${invoiceId}/schedule`, { payFromAccountId: from, payOn })} data-testid="schedule-payment">
          {status === "scheduled" ? "Reschedule" : "Schedule payment"}
        </Button>
        {status === "scheduled" ? (
          <div className="space-y-3 border-t border-border pt-3">
            <div className="text-sm font-medium">Record the payment</div>
            <p className="text-xs text-muted">Control Room doesn’t move money. After your bank sends the payment, record it here so the supplier sees it.</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Paid on"><Input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></Field>
              <Field label="Bank reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="ACH-12345" data-testid="payment-reference" /></Field>
            </div>
            <Button variant="good" className="w-full" disabled={busy || reference.trim().length < 3} onClick={() => go(`/api/supplier-invoices/${invoiceId}/paid`, { paidOn, reference })} data-testid="mark-paid">Mark as paid</Button>
          </div>
        ) : null}
        {error ? <Alert tone="bad">{error}</Alert> : null}
      </CardBody>
    </Card>
  );
}
