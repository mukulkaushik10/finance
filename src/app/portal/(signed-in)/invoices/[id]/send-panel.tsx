"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, LinkButton } from "@/components/ui";
import { send } from "@/lib/send";

export function SendPanel({ invoiceId, checks, resend, isDraft }: { invoiceId: string; checks: { level: string; message: string }[]; resend: boolean; isDraft: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = checks.filter((c) => c.level === "error");
  async function submit() {
    setBusy(true); setError(null);
    try { await send(`/api/portal/invoices/${invoiceId}/submit`, "POST"); router.refresh(); } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  async function cancel() {
    if (!confirm(isDraft && !resend ? "Delete this draft?" : "Cancel this invoice? The buyer will see it as cancelled.")) return;
    setBusy(true);
    try { const r = await send(`/api/portal/invoices/${invoiceId}`, "DELETE"); router.push(r.deleted ? "/portal/invoices" : `/portal/invoices/${invoiceId}`); router.refresh(); } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <Card className="border-brand/40 ring-1 ring-brand/10" data-testid="send-panel">
      <CardHeader title="Before you send" description="We check the invoice against the buyer's records so it doesn't get held up." />
      <CardBody className="space-y-3">
        <ul className="space-y-2" data-testid="checks">
          {checks.map((c, i) => (
            <li key={i} className="flex gap-2 text-sm">
              {c.level === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-bad" /> : c.level === "warning" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" />}
              <span>{c.message}</span>
            </li>
          ))}
        </ul>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Button className="w-full" disabled={busy || errors.length > 0} onClick={submit} data-testid="send-invoice">{busy ? "Sending…" : resend ? "Send again" : "Send to buyer"}</Button>
        <div className="flex gap-2">
          <LinkButton href={`/portal/invoices/${invoiceId}/edit`} size="sm" className="flex-1">Edit</LinkButton>
          <Button variant="ghost" size="sm" className="flex-1" disabled={busy} onClick={cancel}>{isDraft && !resend ? "Delete draft" : "Cancel invoice"}</Button>
        </div>
      </CardBody>
    </Card>
  );
}
