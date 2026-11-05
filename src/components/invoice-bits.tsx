import { Badge } from "@/components/ui";
import { BUYER_STATUS, SUPPLIER_STATUS } from "@/server/portal/labels";
import { formatMoney, formatBps } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export function InvoiceStatus({ status, side }: { status: string; side: "buyer" | "supplier" }) {
  const s = (side === "buyer" ? BUYER_STATUS : SUPPLIER_STATUS)[status as keyof typeof SUPPLIER_STATUS] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={s.tone} data-testid="invoice-status">{s.label}</Badge>;
}

export function KindTag({ kind }: { kind: string }) {
  return kind === "credit_note" ? <Badge tone="info">Credit note</Badge> : null;
}

interface Line { id?: string; description: string; quantity: number; unitPriceMinor: number | bigint; taxRateBps: number; amountMinor: number | bigint }

export function LinesTable({ lines, currency, subtotalMinor, taxMinor, totalMinor, kind }: { lines: Line[]; currency: string; subtotalMinor: number | bigint; taxMinor: number | bigint; totalMinor: number | bigint; kind: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
            <th className="py-2 pr-3 font-medium">Description</th>
            <th className="py-2 px-3 text-right font-medium">Qty</th>
            <th className="py-2 px-3 text-right font-medium">Unit price</th>
            <th className="py-2 px-3 text-right font-medium">Tax</th>
            <th className="py-2 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.id ?? i} className="border-b border-border/60">
              <td className="py-2 pr-3">{l.description}</td>
              <td className="py-2 px-3 text-right tabular">{l.quantity}</td>
              <td className="py-2 px-3 text-right tabular">{formatMoney(l.unitPriceMinor, currency)}</td>
              <td className="py-2 px-3 text-right tabular text-muted">{l.taxRateBps ? formatBps(l.taxRateBps, 2) : "-"}</td>
              <td className="py-2 pl-3 text-right tabular">{formatMoney(l.amountMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="text-sm">
          <tr><td colSpan={4} className="pt-3 pr-3 text-right text-muted">Subtotal</td><td className="pt-3 pl-3 text-right tabular">{formatMoney(subtotalMinor, currency)}</td></tr>
          <tr><td colSpan={4} className="pr-3 text-right text-muted">Tax</td><td className="pl-3 text-right tabular">{formatMoney(taxMinor, currency)}</td></tr>
          <tr><td colSpan={4} className="pr-3 pt-1 text-right font-semibold">{kind === "credit_note" ? "Total credit" : "Total"}</td><td className="pl-3 pt-1 text-right text-base font-semibold tabular" data-testid="invoice-total">{formatMoney(totalMinor, currency)}</td></tr>
        </tfoot>
      </table>
    </div>
  );
}

export function Timeline({ events, side }: { events: { id: string; status: string; note: string | null; actorType: string; actorName: string | null; at: string | Date }[]; side: "buyer" | "supplier" }) {
  const labels = side === "buyer" ? BUYER_STATUS : SUPPLIER_STATUS;
  return (
    <ol className="space-y-3" data-testid="timeline">
      {events.map((e, i) => {
        const s = labels[e.status as keyof typeof labels];
        const last = i === events.length - 1;
        return (
          <li key={e.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1 h-2.5 w-2.5 rounded-full", last ? "bg-brand" : "bg-border-strong")} />
              {!last ? <span className="mt-1 w-px flex-1 bg-border" /> : null}
            </div>
            <div className="min-w-0 pb-1">
              <div className="text-sm font-medium">{s?.label ?? e.status}</div>
              {e.note ? <div className="text-sm text-ink-2">{e.note}</div> : null}
              <div className="text-xs text-muted">{formatDateTime(e.at)}{e.actorName ? ` · ${e.actorName}` : ""}</div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function InvoiceMeta({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="break-words font-medium">{v ?? "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export { formatDate };
