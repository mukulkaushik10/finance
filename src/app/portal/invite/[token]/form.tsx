"use client";

import { useState } from "react";
import { Alert, Button, Field, Input, LinkButton } from "@/components/ui";
import { send } from "@/lib/send";

export function AcceptInviteForm({ token, email, supplierName, hasAccount, signedInAs }: { token: string; email: string; supplierName: string; hasAccount: boolean; signedInAs: string | null }) {
  const [f, setF] = useState({ name: "", legalName: supplierName, taxId: "", phone: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function accept(existing: boolean) {
    setBusy(true); setError(null);
    try { await send(`/api/portal/invites/${token}/accept`, "POST", existing ? { existing: true } : f); window.location.href = existing ? "/portal" : "/portal/bank?welcome=1"; }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  if (hasAccount) {
    return signedInAs?.toLowerCase() === email.toLowerCase() ? (
      <div className="space-y-3">
        <p className="text-sm">You’re signed in as {signedInAs}. Connect this buyer to your existing supplier account.</p>
        {error ? <Alert tone="bad">{error}</Alert> : null}
        <Button onClick={() => accept(true)} disabled={busy} data-testid="accept-existing">Accept invitation</Button>
      </div>
    ) : (
      <div className="space-y-3">
        <p className="text-sm">You already have a supplier account for {email}. Sign in to accept.</p>
        <LinkButton href={`/portal/login?next=/portal/invite/${token}`} variant="primary">Sign in to accept</LinkButton>
      </div>
    );
  }
  return (
    <div className="space-y-3" data-testid="accept-form">
      <Field label="Your email" hint="The invitation was sent here; it becomes your sign-in."><Input value={email} disabled /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Your name"><Input value={f.name} onChange={set("name")} data-testid="accept-name" /></Field>
        <Field label="Phone (optional)"><Input value={f.phone} onChange={set("phone")} /></Field>
      </div>
      <Field label="Company legal name" hint="As it should appear on your invoices"><Input value={f.legalName} onChange={set("legalName")} data-testid="accept-legal" /></Field>
      <Field label="EIN (optional)" hint="US employer identification number, like 12-3456789"><Input value={f.taxId} onChange={set("taxId")} /></Field>
      <Field label="Choose a password" hint="At least 8 characters"><Input type="password" value={f.password} onChange={set("password")} data-testid="accept-password" /></Field>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <Button className="w-full" onClick={() => accept(false)} disabled={busy} data-testid="accept-new">{busy ? "Setting up…" : "Create account and accept"}</Button>
      <p className="text-xs text-muted">Next you’ll add the bank account you want to be paid into. {supplierName}’s buyer checks it with you before it’s used.</p>
    </div>
  );
}
