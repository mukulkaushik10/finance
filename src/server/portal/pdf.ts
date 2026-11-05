import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { formatMoney, formatBps } from "@/lib/money";

// Renders a supplier invoice or credit note as a PDF. The same document is offered to the
// supplier (to keep) and to the buyer (alongside the structured data they already have).

export interface PdfInvoice {
  kind: "invoice" | "credit_note";
  invoiceNumber: string;
  status: string;
  currency: string;
  invoiceDate: Date;
  dueDate: Date;
  poNumber: string | null;
  notes: string | null;
  subtotalMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  creditForNumber?: string | null;
  supplier: { legalName: string; taxId: string | null; email: string; phone: string | null; addressLine1: string | null; addressLine2: string | null; city: string | null; region: string | null; postalCode: string | null };
  buyer: { name: string; billingAddress: string | null; vendorCode: string };
  payTo: { bankName: string; accountLast4: string } | null;
  lines: { description: string; quantity: number; unitPriceMinor: bigint; taxRateBps: number; amountMinor: bigint }[];
}

const ink = rgb(0.07, 0.16, 0.17);
const muted = rgb(0.38, 0.45, 0.46);
const brand = rgb(0.05, 0.42, 0.44);
const line = rgb(0.84, 0.88, 0.89);
const d10 = (d: Date) => d.toISOString().slice(0, 10);

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\n/)) {
    let cur = "";
    for (const word of para.split(/\s+/)) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && cur) { out.push(cur); cur = word; } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

export async function renderInvoicePdf(inv: PdfInvoice): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const title = inv.kind === "credit_note" ? "CREDIT NOTE" : "INVOICE";
  doc.setTitle(`${title} ${inv.invoiceNumber}`);
  doc.setAuthor(inv.supplier.legalName);
  doc.setCreator("Control Room supplier portal");

  let page: PDFPage = doc.addPage([612, 792]); // US Letter
  const M = 48;
  const W = 612 - 2 * M;
  let y = 792 - M;
  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    page.drawText(s, { x, y: yy, font: o.font ?? regular, size: o.size ?? 9.5, color: o.color ?? ink });
  const right = (s: string, xr: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {}) =>
    text(s, xr - (o.font ?? regular).widthOfTextAtSize(s, o.size ?? 9.5), yy, o);

  // Supplier block
  text(inv.supplier.legalName, M, y, { font: bold, size: 15 });
  right(title, M + W, y, { font: bold, size: 18, color: brand });
  y -= 16;
  const addr = [inv.supplier.addressLine1, inv.supplier.addressLine2, [inv.supplier.city, inv.supplier.region, inv.supplier.postalCode].filter(Boolean).join(", ") || null].filter(Boolean) as string[];
  const supplierLines = [...addr, inv.supplier.email, inv.supplier.phone, inv.supplier.taxId ? `EIN ${inv.supplier.taxId}` : null].filter(Boolean) as string[];
  const meta: [string, string][] = [
    [inv.kind === "credit_note" ? "Credit note no." : "Invoice no.", inv.invoiceNumber],
    ["Date", d10(inv.invoiceDate)],
    ...(inv.kind === "invoice" ? [["Due", d10(inv.dueDate)] as [string, string]] : []),
    ...(inv.poNumber ? [["PO number", inv.poNumber] as [string, string]] : []),
    ...(inv.creditForNumber ? [["Credit for invoice", inv.creditForNumber] as [string, string]] : []),
  ];
  const top = y;
  supplierLines.forEach((s, i) => text(s, M, top - i * 12, { color: muted }));
  meta.forEach(([k, v], i) => { text(k, M + W - 190, top - i * 13, { color: muted }); right(v, M + W, top - i * 13, { font: bold }); });
  y = top - Math.max(supplierLines.length * 12, meta.length * 13) - 18;

  // Bill to
  text("BILL TO", M, y, { font: bold, size: 8, color: muted });
  y -= 13;
  text(inv.buyer.name, M, y, { font: bold, size: 11 });
  y -= 13;
  for (const l of (inv.buyer.billingAddress ?? "").split(/\n|, (?=\D)/).filter(Boolean)) { text(l, M, y, { color: muted }); y -= 12; }
  text(`Your vendor code for us: ${inv.buyer.vendorCode}`, M, y, { color: muted });
  y -= 26;

  // Lines
  const cols = { desc: M, qty: M + W - 230, unit: M + W - 160, tax: M + W - 80, amt: M + W };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 5, width: W, height: 18, color: rgb(0.93, 0.96, 0.96) });
    text("Description", cols.desc + 6, y, { font: bold, size: 8.5 });
    right("Qty", cols.qty + 20, y, { font: bold, size: 8.5 });
    right("Unit price", cols.unit + 50, y, { font: bold, size: 8.5 });
    right("Tax", cols.tax + 30, y, { font: bold, size: 8.5 });
    right("Amount", cols.amt - 6, y, { font: bold, size: 8.5 });
    y -= 20;
  };
  header();
  for (const l of inv.lines) {
    const desc = wrap(l.description, regular, 9.5, cols.qty - cols.desc - 40);
    if (y - desc.length * 12 < M + 140) { page = doc.addPage([612, 792]); y = 792 - M; header(); }
    desc.forEach((d, i) => text(d, cols.desc + 6, y - i * 12));
    right(String(l.quantity), cols.qty + 20, y);
    right(formatMoney(l.unitPriceMinor, inv.currency), cols.unit + 50, y);
    right(l.taxRateBps ? formatBps(l.taxRateBps, 2) : "-", cols.tax + 30, y);
    right(formatMoney(l.amountMinor, inv.currency), cols.amt - 6, y);
    y -= desc.length * 12 + 6;
    page.drawLine({ start: { x: M, y: y + 2 }, end: { x: M + W, y: y + 2 }, thickness: 0.5, color: line });
    y -= 8;
  }

  // Totals
  y -= 4;
  const tot = (k: string, v: string, b = false) => { text(k, M + W - 190, y, { font: b ? bold : regular, color: b ? ink : muted, size: b ? 11 : 9.5 }); right(v, M + W - 6, y, { font: b ? bold : regular, size: b ? 11 : 9.5 }); y -= b ? 18 : 14; };
  tot("Subtotal", formatMoney(inv.subtotalMinor, inv.currency));
  tot("Tax", formatMoney(inv.taxMinor, inv.currency));
  tot(inv.kind === "credit_note" ? "Total credit" : "Total due", formatMoney(inv.totalMinor, inv.currency), true);
  y -= 10;

  if (inv.kind === "invoice" && inv.payTo) {
    text("PAYMENT", M, y, { font: bold, size: 8, color: muted });
    y -= 13;
    text(`Pay by bank transfer to ${inv.payTo.bankName}, account ending ${inv.payTo.accountLast4}, as approved in your supplier records.`, M, y);
    y -= 12;
    text("We will never ask you to change our bank details by email or phone.", M, y, { color: muted });
    y -= 20;
  }
  if (inv.notes) {
    text("NOTES", M, y, { font: bold, size: 8, color: muted });
    y -= 13;
    for (const l of wrap(inv.notes, regular, 9.5, W)) { text(l, M, y); y -= 12; }
  }
  page.drawText(`Sent through the Control Room supplier portal${inv.status === "draft" ? " · DRAFT, not yet sent" : ""}`, { x: M, y: M - 16, font: regular, size: 8, color: muted });
  return doc.save();
}
