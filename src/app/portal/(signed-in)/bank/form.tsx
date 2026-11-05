"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { send } from "@/lib/send";

export function BankChangeForm({ buyers, canEdit }: { buyers: { connectionId: string; buyerName: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = useState({ holderName: "", bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "", password: "" });
  const [chosen, setChosen] = useState<string[]>(buyers.map((b) => b.connectionId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function submit() {
    setBusy(true); setError(null); setDone(null);
    try {
      const r = await send("/api/portal/bank-accounts", "POST", { ...f, connectionIds: chosen });
      setDone(r.requested.length ? `Sent to ${r.requested.map((x: { buyerName: string }) => x.buyerName).join(", ")} for approval. They'll contact you to confirm.` : "Your buyers already pay into this account.");
      setF({ holderName: "", bankName: "", routingNumber: "", accountNumber: "", confirmAccountNumber: "", password: "" });
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  if (!canEdit) return <Alert tone="info">Only your account owner can change bank details.</Alert>;
  return (
    <Card data-testid="bank-form">
      <CardHeader title="Add or change bank account" description="US bank accounts (ACH)." />
      <CardBody className="space-y-3">
        <Field label="Account holder name"><Input value={f.holderName} onChange={set("holderName")} data-testid="sb-holder" /></Field>
        <Field label="Bank name"><Input value={f.bankName} onChange={set("bankName")} data-testid="sb-bank" /></Field>
        <Field label="Routing number" hint="9 digits, on your checks or bank statement"><Input inputMode="numeric" value={f.routingNumber} onChange={set("routingNumber")} data-testid="sb-routing" /></Field>
        <Field label="Account number"><Input inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={set("accountNumber")} data-testid="sb-account" /></Field>
        <Field label="Confirm account number"><Input inputMode="numeric" autoComplete="off" value={f.confirmAccountNumber} onChange={set("confirmAccountNumber")} data-testid="sb-confirm" /></Field>
        {buyers.length > 1 ? (
          <Field label="Use for">
            <div className="space-y-1">{buyers.map((b) => (
              <label key={b.connectionId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={chosen.includes(b.connectionId)} onChange={(e) => setChosen(e.target.checked ? [...chosen, b.connectionId] : chosen.filter((c) => c !== b.connectionId))} /> {b.buyerName}</label>
            ))}</div>
          </Field>
        ) : null}
        <Field label="Your password" hint="To confirm it's really you"><Input type="password" value={f.password} onChange={set("password")} data-testid="sb-password" /></Field>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        {done ? <Alert tone="good">{done}</Alert> : null}
        <Button className="w-full" disabled={busy || !chosen.length} onClick={submit} data-testid="sb-submit">{busy ? "Sending…" : "Send for approval"}</Button>
        <p className="text-xs text-muted">Until a buyer approves, they keep paying you into the account they already have.</p>
      </CardBody>
    </Card>
  );
}
