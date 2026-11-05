"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, UserPlus } from "lucide-react";
import { Alert, Button, Field, Input, Select, Textarea } from "@/components/ui";
import { send } from "@/lib/send";

export function BankChangeDecision({ id }: { id: string }) {
  const router = useRouter();
  const [verification, setVerification] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function decide(decision: "approve" | "reject") {
    setBusy(true); setError(null);
    try { await send(`/api/bank-changes/${id}/decision`, "POST", { decision, verification: verification || undefined, note: note || undefined }); router.refresh(); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return (
    <div className="mt-3 space-y-3">
      <Field label="How did you confirm this with the supplier?" hint="Required to approve. For example: called Marco Diaz on (206) 555-0187 from our vendor file; he confirmed the new account.">
        <Textarea rows={2} value={verification} onChange={(e) => setVerification(e.target.value)} data-testid="bank-verification" />
      </Field>
      <Field label="Note to the supplier (if rejecting)"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button variant="good" disabled={busy || verification.trim().length < 10} onClick={() => decide("approve")} data-testid="approve-bank-change">Approve new bank details</Button>
        <Button variant="secondary" disabled={busy || note.trim().length < 5} onClick={() => decide("reject")}>Reject</Button>
      </div>
      <p className="text-xs text-muted">Approving updates the vendor record. The bank-change rule then sends this supplier’s next payments to a person as an extra check.</p>
    </div>
  );
}

export function InviteSupplier({ vendors }: { vendors: { id: string; code: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [email, setEmail] = useState("");
  const [terms, setTerms] = useState("30");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; name: string; email: string } | null>(null);
  const shown = vendors.filter((v) => !q || `${v.name} ${v.code}`.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  async function invite() {
    setBusy(true); setError(null);
    try {
      const r = await send("/api/suppliers/invite", "POST", { vendorId, email, paymentTermsDays: Number(terms) });
      setLink({ url: r.inviteUrl, name: r.vendor.name, email: r.email }); setOpen(false); router.refresh();
    } catch (e) { setError((e as Error).message); }
    setBusy(false);
  }
  return (
    <div className="text-left">
      {!open ? <Button size="sm" onClick={() => { setOpen(true); setLink(null); }} data-testid="invite-open"><UserPlus className="h-4 w-4" /> Invite a supplier</Button> : null}
      {link ? (
        <div className="mt-3 max-w-xl rounded-md border border-good/40 bg-good-soft/40 p-3 text-sm" data-testid="invite-link">
          <div className="font-medium">Invitation created for {link.name}</div>
          <p className="text-muted">Email delivery isn’t connected in this demo, so copy this link and send it to {link.email}. It works once and expires in 14 days.</p>
          <div className="mt-2 flex gap-2"><code className="flex-1 break-all rounded bg-surface px-2 py-1 text-xs">{link.url}</code><Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(link.url)}><Copy className="h-3.5 w-3.5" /> Copy</Button></div>
        </div>
      ) : null}
      {open ? (
        <div className="mt-3 w-full max-w-xl space-y-3 rounded-md border border-border p-3">
          <Field label="Vendor" hint="From your vendor list. Blocked vendors can't be invited.">
            <Input placeholder="Search by name or code" value={q} onChange={(e) => setQ(e.target.value)} className="mb-2" />
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)} data-testid="invite-vendor">
              <option value="">Choose a vendor…</option>
              {shown.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.code})</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-[1fr_140px] gap-2">
            <Field label="Supplier's email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accounts@supplier.com" data-testid="invite-email" /></Field>
            <Field label="Payment terms"><Select value={terms} onChange={(e) => setTerms(e.target.value)}>{[15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}</Select></Field>
          </div>
          {error ? <Alert tone="bad">{error}</Alert> : null}
          <div className="flex gap-2"><Button disabled={busy || !vendorId || !email} onClick={invite} data-testid="invite-send">Create invitation</Button><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </div>
      ) : null}
    </div>
  );
}

export function ConnectionActions({ connection }: { connection: { id: string; status: string; vendor: { id: string; name: string }; inviteEmail: string; paymentTermsDays: number } }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (connection.status === "invited") {
    return (
      <div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = await send("/api/suppliers/invite", "POST", { vendorId: connection.vendor.id, email: connection.inviteEmail, paymentTermsDays: connection.paymentTermsDays }); setMsg(r.inviteUrl); router.refresh(); } catch (e) { setMsg((e as Error).message); }
          setBusy(false);
        }}>Resend</Button>
        {msg ? <code className="mt-1 block max-w-[220px] break-all text-left text-[11px] text-muted">{msg}</code> : null}
      </div>
    );
  }
  const suspend = connection.status === "active";
  return (
    <Button size="sm" variant="ghost" disabled={busy} onClick={async () => {
      const reason = window.prompt(suspend ? `Why suspend ${connection.vendor.name}'s portal access?` : `Why restore ${connection.vendor.name}'s access?`);
      if (!reason) return;
      setBusy(true);
      try { await send(`/api/suppliers/${connection.id}`, "PATCH", { suspended: suspend, reason }); router.refresh(); } catch (e) { alert((e as Error).message); }
      setBusy(false);
    }}>{suspend ? "Suspend" : "Restore"}</Button>
  );
}
