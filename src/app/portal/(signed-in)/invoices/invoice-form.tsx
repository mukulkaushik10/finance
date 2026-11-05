"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Textarea } from "@/components/ui";
import { formatMoney, parseMoney } from "@/lib/money";
import { send } from "@/lib/send";

export interface FormLine { description: string; quantity: string; unitPrice: string; taxPct: string }
export interface FormValues { connectionId: string; invoiceNumber: string; invoiceDate: string; dueDate: string; poNumber: string; notes: string; lines: FormLine[] }

const money = (s: string) => { try { return parseMoney(s || "0", "USD"); } catch { return null; } };
const pctToBps = (s: string) => { const n = Number(s || "0"); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export function InvoiceForm({ mode, invoiceId, kind, creditForInvoiceId, buyers, initial, lockNumber }: {
  mode: "create" | "edit"; invoiceId?: string; kind: "invoice" | "credit_note"; creditForInvoiceId?: string;
  buyers: { connectionId: string; buyerName: string; paymentTermsDays: number }[]; initial: FormValues; lockNumber?: boolean;
}) {
  const router = useRouter();
  const [v, setV] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLine = (i: number, k: keyof FormLine, val: string) => setV({ ...v, lines: v.lines.map((l, j) => (j === i ? { ...l, [k]: val } : l)) });

  const totals = useMemo(() => {
    let sub = 0n, tax = 0n, bad = false;
    for (const l of v.lines) {
      const unit = money(l.unitPrice); const q = Number(l.quantity); const bps = pctToBps(l.taxPct);
      if (unit === null || !Number.isInteger(q) || q < 1 || Number.isNaN(bps)) { bad = true; continue; }
      const amt = unit * BigInt(q); sub += amt; tax += (amt * BigInt(bps) + 5000n) / 10000n;
    }
    return { sub, tax, total: sub + tax, bad };
  }, [v.lines]);

  async function save() {
    setBusy(true); setError(null);
    try {
      const lines = v.lines.map((l) => {
        const unit = money(l.unitPrice);
        if (unit === null) throw new Error(`"${l.unitPrice}" isn't a valid price`);
        return { description: l.description, quantity: Number(l.quantity), unitPriceMinor: Number(unit), taxRateBps: pctToBps(l.taxPct) };
      });
      const body = { connectionId: v.connectionId, kind, creditForInvoiceId, invoiceNumber: v.invoiceNumber, invoiceDate: v.invoiceDate, dueDate: kind === "invoice" && v.dueDate ? v.dueDate : undefined, poNumber: v.poNumber || undefined, notes: v.notes || undefined, lines };
      const r = mode === "create" ? await send("/api/portal/invoices", "POST", body) : await send(`/api/portal/invoices/${invoiceId}`, "PATCH", body);
      router.push(`/portal/invoices/${r.invoice.id}`);
      router.refresh();
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={kind === "credit_note" ? "Credit note details" : "Invoice details"} />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          <Field label="Bill to">
            <Select value={v.connectionId} onChange={(e) => setV({ ...v, connectionId: e.target.value })} disabled={mode === "edit" || kind === "credit_note"} data-testid="form-buyer">
              {buyers.map((b) => <option key={b.connectionId} value={b.connectionId}>{b.buyerName}</option>)}
            </Select>
          </Field>
          <Field label={kind === "credit_note" ? "Credit note number" : "Invoice number"} hint={lockNumber ? "Can't change after sending" : "Your own numbering, unique per buyer"}>
            <Input value={v.invoiceNumber} onChange={(e) => setV({ ...v, invoiceNumber: e.target.value })} disabled={lockNumber} placeholder={kind === "credit_note" ? "CN-001" : "INV-1042"} data-testid="form-number" />
          </Field>
          {kind === "invoice" ? (
            <Field label="Purchase order" hint="Invoices with a PO are approved faster"><Input value={v.poNumber} onChange={(e) => setV({ ...v, poNumber: e.target.value })} placeholder="PO-90002" data-testid="form-po" /></Field>
          ) : <Field label="Credit for PO"><Input value={v.poNumber || "-"} disabled /></Field>}
          <Field label="Date"><Input type="date" value={v.invoiceDate} onChange={(e) => setV({ ...v, invoiceDate: e.target.value })} data-testid="form-date" /></Field>
          {kind === "invoice" ? <Field label="Due date" hint={`Leave as is to use the buyer's terms`}><Input type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lines" />
        <CardBody className="space-y-2">
          <div className="hidden grid-cols-[minmax(0,1fr)_90px_130px_90px_120px_36px] gap-2 text-xs font-medium uppercase tracking-wide text-muted sm:grid">
            <div>Description</div><div className="text-right">Qty</div><div className="text-right">Unit price ($)</div><div className="text-right">Tax %</div><div className="text-right">Amount</div><div />
          </div>
          {v.lines.map((l, i) => {
            const unit = money(l.unitPrice); const q = Number(l.quantity);
            return (
              <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_90px_130px_90px_120px_36px] sm:items-center" data-testid="form-line">
                <Input className="col-span-2 sm:col-span-1" value={l.description} onChange={(e) => setLine(i, "description", e.target.value)} placeholder="What you're billing for" />
                <Input className="text-right" inputMode="numeric" value={l.quantity} onChange={(e) => setLine(i, "quantity", e.target.value)} aria-label="Quantity" />
                <Input className="text-right" inputMode="decimal" value={l.unitPrice} onChange={(e) => setLine(i, "unitPrice", e.target.value)} aria-label="Unit price" />
                <Input className="text-right" inputMode="decimal" value={l.taxPct} onChange={(e) => setLine(i, "taxPct", e.target.value)} aria-label="Tax percent" />
                <div className="text-right text-sm tabular">{unit !== null && Number.isInteger(q) && q > 0 ? formatMoney(unit * BigInt(q), "USD") : "-"}</div>
                <Button variant="ghost" size="sm" aria-label="Remove line" disabled={v.lines.length === 1} onClick={() => setV({ ...v, lines: v.lines.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" onClick={() => setV({ ...v, lines: [...v.lines, { description: "", quantity: "1", unitPrice: "", taxPct: "0" }] })}><Plus className="h-4 w-4" /> Add line</Button>
          <div className="ml-auto w-full max-w-xs space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span className="tabular">{formatMoney(totals.sub, "USD")}</span></div>
            <div className="flex justify-between"><span className="text-muted">Tax</span><span className="tabular">{formatMoney(totals.tax, "USD")}</span></div>
            <div className="flex justify-between text-base font-semibold"><span>{kind === "credit_note" ? "Total credit" : "Total"}</span><span className="tabular" data-testid="form-total">{formatMoney(totals.total, "USD")}</span></div>
          </div>
        </CardBody>
      </Card>

      <Card><CardBody><Field label="Notes for the buyer (optional)"><Textarea rows={2} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field></CardBody></Card>
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={busy || totals.bad || !v.invoiceNumber} data-testid="form-save">{busy ? "Saving…" : "Save and review"}</Button>
        <span className="text-sm text-muted">Nothing is sent yet. You’ll see the checks before sending.</span>
      </div>
    </div>
  );
}
