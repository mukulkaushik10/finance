import { z } from "zod";
import { Prisma, type InvoiceStatus } from "@prisma/client";
import { forVendor } from "../db/vendor-dal";
import { forOrg } from "../db/dal";
import { appendAudit } from "../audit/chain";
import { badRequest, conflict, notFound } from "../errors";
import { formatMoney } from "@/lib/money";
import { getActiveConnection } from "./profile";
import { addInvoiceEvent } from "./sync";
import { processSubmittedInvoice } from "./pipeline";
import { OUTSTANDING } from "./labels";
import type { VendorCtx } from "./session";

// Supplier side: create, check and send invoices and credit notes; follow their progress.

const DAY = 86_400_000;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Not a real date");
const asDate = (s: string) => new Date(s + "T00:00:00Z");

export const LineSchema = z.object({
  description: z.string().trim().min(1, "Describe what you're billing for").max(300),
  quantity: z.number().int().min(1).max(1_000_000),
  unitPriceMinor: z.number().int().min(0).max(1e13),
  taxRateBps: z.number().int().min(0).max(3000).default(0),
});

export const DraftSchema = z.object({
  connectionId: z.string().min(1),
  kind: z.enum(["invoice", "credit_note"]).default("invoice"),
  creditForInvoiceId: z.string().optional(),
  invoiceNumber: z.string().trim().min(1, "Enter your invoice number").max(40).regex(/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/, "Use letters, numbers and - _ / . only"),
  invoiceDate: isoDate,
  dueDate: isoDate.optional(),
  poNumber: z.string().trim().max(40).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(LineSchema).min(1, "Add at least one line").max(100),
});
export type DraftInput = z.input<typeof DraftSchema>;

export function computeTotals(lines: z.infer<typeof LineSchema>[]) {
  let subtotal = 0n;
  let tax = 0n;
  const out = lines.map((l, i) => {
    const amount = BigInt(l.quantity) * BigInt(l.unitPriceMinor);
    const lineTax = (amount * BigInt(l.taxRateBps) + 5000n) / 10000n; // round half up to the cent
    subtotal += amount;
    tax += lineTax;
    return { position: i + 1, description: l.description, quantity: l.quantity, unitPriceMinor: BigInt(l.unitPriceMinor), taxRateBps: l.taxRateBps, amountMinor: amount };
  });
  return { lines: out, subtotalMinor: subtotal, taxMinor: tax, totalMinor: subtotal + tax };
}

/** Purchase orders the buyer has raised with this supplier, with what's been delivered and billed so far. */
export async function listOpenPurchaseOrders(ctx: VendorCtx, connectionId: string, opts: { excludeInvoiceId?: string } = {}) {
  const c = await getActiveConnection(ctx, connectionId);
  const db = forOrg(c.organisationId);
  const pos = await db.purchaseOrder.findMany({ where: { vendorCode: c.vendor.code, closedAt: null }, orderBy: { createdAt: "desc" }, take: 200 });
  if (!pos.length) return [];
  const numbers = pos.map((p) => p.poNumber);
  const [grns, invoiced, actions] = await Promise.all([
    db.goodsReceipt.findMany({ where: { poNumber: { in: numbers } }, orderBy: { receivedAt: "asc" } }),
    db.invoice.findMany({ where: { connectionId: c.id, kind: "invoice", poNumber: { in: numbers }, status: { notIn: ["cancelled", "rejected", "draft"] }, ...(opts.excludeInvoiceId ? { id: { not: opts.excludeInvoiceId } } : {}) }, select: { poNumber: true, totalMinor: true, lines: { select: { quantity: true } } } }),
    // Invoices for these POs that reached the buyer some other way (email, EDI) also count as billed.
    db.action.findMany({ where: { counterpartyKey: c.vendor.code, source: "live", status: { notIn: ["rejected", "blocked"] } }, select: { payload: true, amountMinor: true, externalRef: true } }),
  ]);
  const portalIds = new Set((await db.invoice.findMany({ where: { connectionId: c.id }, select: { id: true } })).map((i) => i.id));
  return pos.map((p) => {
    const received = grns.filter((g) => g.poNumber === p.poNumber);
    const qtyReceived = received.reduce((s, g) => s + g.quantityReceived, 0);
    const portal = invoiced.filter((i) => i.poNumber === p.poNumber);
    const other = actions.filter((a) => !portalIds.has(a.externalRef) && (a.payload as { po_number?: string } | null)?.po_number === p.poNumber);
    const billedMinor = portal.reduce((s, i) => s + i.totalMinor, 0n) + other.reduce((s, a) => s + a.amountMinor, 0n);
    const qtyBilled = portal.reduce((s, i) => s + i.lines.reduce((q, l) => q + l.quantity, 0), 0) + (other.length ? Math.round(Number(other.reduce((s, a) => s + a.amountMinor, 0n)) / Math.max(1, Number(p.unitPriceMinor))) : 0);
    return {
      poNumber: p.poNumber, currency: p.currency, amountMinor: p.amountMinor, quantity: p.quantity, unitPriceMinor: p.unitPriceMinor,
      quantityReceived: qtyReceived, quantityBilled: Math.min(qtyBilled, p.quantity), billedMinor,
      remainingMinor: p.amountMinor > billedMinor ? p.amountMinor - billedMinor : 0n,
      latestReceipt: received.at(-1)?.grnNumber ?? null,
      raisedOn: p.createdAt,
    };
  }).filter((p) => p.remainingMinor > 0n);
}

/** A ready-to-edit draft for billing what's been delivered against a PO. */
export async function suggestFromPurchaseOrder(ctx: VendorCtx, connectionId: string, poNumber: string) {
  const c = await getActiveConnection(ctx, connectionId);
  const po = (await listOpenPurchaseOrders(ctx, connectionId)).find((p) => p.poNumber === poNumber);
  if (!po) throw notFound(`Open purchase order ${poNumber}`);
  const deliveredNotBilled = Math.max(0, po.quantityReceived - po.quantityBilled);
  const today = new Date().toISOString().slice(0, 10);
  return {
    connectionId, kind: "invoice" as const, invoiceNumber: "", invoiceDate: today,
    dueDate: new Date(Date.parse(today) + c.paymentTermsDays * DAY).toISOString().slice(0, 10),
    poNumber, notes: "",
    lines: [{ description: `${c.vendor.category} as ordered on ${poNumber}`, quantity: deliveredNotBilled || Math.max(1, po.quantity - po.quantityBilled), unitPriceMinor: Number(po.unitPriceMinor), taxRateBps: 0 }],
    po,
  };
}

async function loadOwnInvoice(ctx: VendorCtx, invoiceId: string) {
  const inv = await forVendor(ctx.vendorAccountId).invoice.findFirst({
    where: { id: invoiceId },
    include: { lines: { orderBy: { position: "asc" } }, connection: { include: { organisation: { select: { name: true } } } } },
  });
  if (!inv) throw notFound("Invoice");
  return inv;
}

const EDITABLE: InvoiceStatus[] = ["draft", "needs_changes"];

async function checkCreditFor(ctx: VendorCtx, connectionId: string, d: z.infer<typeof DraftSchema>) {
  if (d.kind !== "credit_note") return null;
  if (!d.creditForInvoiceId) throw badRequest("Choose the invoice this credit note is for");
  const orig = await forVendor(ctx.vendorAccountId).invoice.findFirst({ where: { id: d.creditForInvoiceId, connectionId, kind: "invoice" } });
  if (!orig) throw badRequest("Choose one of your invoices to this buyer");
  return orig;
}

export async function createDraft(ctx: VendorCtx, input: unknown, opts: { now?: Date } = {}) {
  const d = DraftSchema.parse(input);
  const c = await getActiveConnection(ctx, d.connectionId);
  const orig = await checkCreditFor(ctx, c.id, d);
  const t = computeTotals(d.lines);
  const dueDate = d.dueDate ?? new Date(Date.parse(d.invoiceDate) + c.paymentTermsDays * DAY).toISOString().slice(0, 10);
  try {
    return await forOrg(c.organisationId).$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          organisationId: c.organisationId, vendorAccountId: ctx.vendorAccountId, connectionId: c.id, vendorId: c.vendorId,
          kind: d.kind, creditForInvoiceId: orig?.id ?? null, invoiceNumber: d.invoiceNumber, status: "draft", currency: "USD",
          poNumber: d.kind === "credit_note" ? orig?.poNumber ?? null : d.poNumber ?? null,
          invoiceDate: asDate(d.invoiceDate), dueDate: asDate(dueDate), notes: d.notes || null,
          subtotalMinor: t.subtotalMinor, taxMinor: t.taxMinor, totalMinor: t.totalMinor,
          ...(opts.now ? { createdAt: opts.now } : {}),
        },
      });
      await tx.invoiceLine.createMany({ data: t.lines.map((l) => ({ ...l, organisationId: c.organisationId, vendorAccountId: ctx.vendorAccountId, invoiceId: inv.id })) });
      await addInvoiceEvent(tx, inv, "draft", null, { type: "supplier", name: ctx.user.name }, opts.now);
      return inv;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`You've already used number ${d.invoiceNumber} with ${c.organisation.name}. Each invoice needs its own number.`);
    throw e;
  }
}

export async function updateDraft(ctx: VendorCtx, invoiceId: string, input: unknown) {
  const inv = await loadOwnInvoice(ctx, invoiceId);
  if (!EDITABLE.includes(inv.status)) throw conflict("Only drafts and invoices sent back for changes can be edited");
  const d = DraftSchema.parse({ ...(input as object), connectionId: inv.connectionId, kind: inv.kind, creditForInvoiceId: inv.creditForInvoiceId ?? undefined });
  const c = await getActiveConnection(ctx, inv.connectionId);
  const t = computeTotals(d.lines);
  const dueDate = d.dueDate ?? new Date(Date.parse(d.invoiceDate) + c.paymentTermsDays * DAY).toISOString().slice(0, 10);
  if (inv.revision > 0 && d.invoiceNumber !== inv.invoiceNumber) throw badRequest("You can't change the number of an invoice you've already sent");
  try {
    return await forOrg(c.organisationId).$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: inv.id } });
      await tx.invoiceLine.createMany({ data: t.lines.map((l) => ({ ...l, organisationId: c.organisationId, vendorAccountId: ctx.vendorAccountId, invoiceId: inv.id })) });
      return tx.invoice.update({
        where: { id: inv.id },
        data: {
          invoiceNumber: d.invoiceNumber, invoiceDate: asDate(d.invoiceDate), dueDate: asDate(dueDate),
          poNumber: inv.kind === "credit_note" ? inv.poNumber : d.poNumber ?? null, notes: d.notes || null,
          subtotalMinor: t.subtotalMinor, taxMinor: t.taxMinor, totalMinor: t.totalMinor,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw conflict(`You've already used number ${d.invoiceNumber} with ${c.organisation.name}`);
    throw e;
  }
}

export interface Check { level: "error" | "warning" | "ok"; message: string }

/** Friendly checks before sending. Errors stop the invoice going out; warnings explain likely delays. */
export async function checkBeforeSending(ctx: VendorCtx, invoiceId: string): Promise<Check[]> {
  const inv = await loadOwnInvoice(ctx, invoiceId);
  const c = await getActiveConnection(ctx, inv.connectionId);
  const checks: Check[] = [];
  const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
  if (!c.bankAccount) checks.push({ level: "error", message: `${c.organisation.name} hasn't approved your bank details yet. Add them under Bank details; you can send once they approve.` });
  else checks.push({ level: "ok", message: `Payment will go to ${c.bankAccount.bankName} account ending ${c.bankAccount.accountLast4}` });
  if (inv.invoiceDate.getTime() > today.getTime() + DAY) checks.push({ level: "error", message: "The invoice date is in the future" });
  if (inv.dueDate < inv.invoiceDate) checks.push({ level: "error", message: "The due date is before the invoice date" });
  if (inv.totalMinor <= 0n) checks.push({ level: "error", message: "The total must be more than zero" });

  if (inv.kind === "credit_note") {
    const orig = inv.creditForInvoiceId ? await forVendor(ctx.vendorAccountId).invoice.findFirst({ where: { id: inv.creditForInvoiceId } }) : null;
    if (orig && inv.totalMinor > orig.totalMinor) checks.push({ level: "error", message: `The credit is more than invoice ${orig.invoiceNumber} (${formatMoney(orig.totalMinor, orig.currency)})` });
    return checks;
  }

  const dupe = await forVendor(ctx.vendorAccountId).invoice.findFirst({
    where: { connectionId: c.id, kind: "invoice", id: { not: inv.id }, totalMinor: inv.totalMinor, status: { notIn: ["draft", "cancelled", "rejected"] } },
  });
  if (dupe) checks.push({ level: "warning", message: `You already sent invoice ${dupe.invoiceNumber} for the same amount. If this is a copy, don't send it; the buyer will hold it as a possible duplicate.` });

  if (!inv.poNumber) {
    checks.push({ level: "warning", message: "There's no purchase order number. Invoices without one usually take longer to approve." });
    return checks;
  }
  const po = (await listOpenPurchaseOrders(ctx, c.id, { excludeInvoiceId: inv.id })).find((p) => p.poNumber === inv.poNumber);
  const anyPo = await forOrg(c.organisationId).purchaseOrder.findFirst({ where: { poNumber: inv.poNumber, vendorCode: c.vendor.code } });
  if (!anyPo) {
    checks.push({ level: "warning", message: `${c.organisation.name} has no purchase order ${inv.poNumber} for you. Check the number with your contact.` });
    return checks;
  }
  if (!po) {
    checks.push({ level: "warning", message: `${inv.poNumber} has already been billed in full` });
    return checks;
  }
  const qty = inv.lines.reduce((s, l) => s + l.quantity, 0);
  if (inv.subtotalMinor > po.remainingMinor) checks.push({ level: "warning", message: `This is more than what's left on ${po.poNumber} (${formatMoney(po.remainingMinor, po.currency)}). It will need extra approval.` });
  else checks.push({ level: "ok", message: `Within what's left on ${po.poNumber}` });
  if (qty > po.quantityReceived - po.quantityBilled && qty > 0) {
    const open = Math.max(0, po.quantityReceived - po.quantityBilled);
    checks.push({ level: "warning", message: po.quantityReceived === 0 ? `${c.organisation.name} hasn't recorded a delivery for ${po.poNumber} yet` : `${c.organisation.name} has recorded ${open} unbilled unit${open === 1 ? "" : "s"} delivered on ${po.poNumber}, and this invoice bills ${qty}` });
  } else checks.push({ level: "ok", message: "Matches what was delivered" });
  return checks;
}

/** Send (or re-send) an invoice to the buyer. It then goes through the buyer's approval checks. */
export async function submitInvoice(ctx: VendorCtx, invoiceId: string, opts: { now?: Date } = {}) {
  const inv = await loadOwnInvoice(ctx, invoiceId);
  if (!EDITABLE.includes(inv.status)) throw conflict("This invoice has already been sent");
  const checks = await checkBeforeSending(ctx, invoiceId);
  const errors = checks.filter((c) => c.level === "error");
  if (errors.length) throw badRequest(errors.map((e) => e.message).join(" "), { checks });
  const c = await getActiveConnection(ctx, inv.connectionId);
  const now = opts.now ?? new Date();
  // Attach the latest delivery record for the PO, so the buyer's three-way match can use it.
  const grn = inv.poNumber ? await forOrg(c.organisationId).goodsReceipt.findFirst({ where: { poNumber: inv.poNumber }, orderBy: { receivedAt: "desc" } }) : null;
  const resubmit = inv.revision > 0;
  await forOrg(c.organisationId).$transaction(async (tx) => {
    const updated = await tx.invoice.update({
      where: { id: inv.id },
      data: { status: "submitted", revision: { increment: 1 }, submittedAt: now, decidedAt: null, supplierNote: null, bankFingerprint: c.bankAccount!.fingerprint, grnNumber: grn?.grnNumber ?? null },
    });
    await addInvoiceEvent(tx, inv, "submitted", resubmit ? "Corrected and sent again" : null, { type: "supplier", name: ctx.user.name }, now);
    await appendAudit(tx, c.organisationId, {
      eventType: "invoice.submitted", entityType: "invoice", entityId: inv.id, actorType: "supplier", actorId: ctx.user.id, occurredAt: now,
      payload: {
        supplier: { accountId: ctx.vendorAccountId, user: ctx.user.name }, vendor: { code: c.vendor.code, name: c.vendor.name },
        kind: inv.kind, invoiceNumber: inv.invoiceNumber, revision: updated.revision, poNumber: inv.poNumber, grnNumber: grn?.grnNumber ?? null,
        totals: { subtotalMinor: inv.subtotalMinor, taxMinor: inv.taxMinor, totalMinor: inv.totalMinor, currency: inv.currency },
        lines: inv.lines.map((l) => ({ description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps })),
        bankFingerprint: c.bankAccount!.fingerprint, checks,
      },
    });
  });
  const result = await processSubmittedInvoice(c.organisationId, inv.id, { now });
  return { invoice: await getSupplierInvoice(ctx, inv.id), checks, processing: { status: result.status } };
}

export async function cancelInvoice(ctx: VendorCtx, invoiceId: string) {
  const inv = await loadOwnInvoice(ctx, invoiceId);
  if (!EDITABLE.includes(inv.status)) throw conflict("Only drafts and invoices sent back for changes can be cancelled");
  const db = forOrg(inv.organisationId);
  if (inv.status === "draft" && inv.revision === 0) {
    await db.invoice.delete({ where: { id: inv.id } });
    return { deleted: true };
  }
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "cancelled" } });
    await addInvoiceEvent(tx, inv, "cancelled", "Cancelled by the supplier", { type: "supplier", name: ctx.user.name });
    await appendAudit(tx, inv.organisationId, {
      eventType: "invoice.cancelled", entityType: "invoice", entityId: inv.id, actorType: "supplier", actorId: ctx.user.id,
      payload: { invoiceNumber: inv.invoiceNumber, by: ctx.user.name },
    });
  });
  return { deleted: false };
}

export async function postSupplierMessage(ctx: VendorCtx, invoiceId: string, input: unknown) {
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(input);
  const inv = await loadOwnInvoice(ctx, invoiceId);
  if (inv.status === "draft") throw badRequest("Send the invoice before messaging the buyer about it");
  return forOrg(inv.organisationId).$transaction(async (tx) => {
    const m = await tx.invoiceMessage.create({ data: { organisationId: inv.organisationId, vendorAccountId: ctx.vendorAccountId, invoiceId: inv.id, authorType: "supplier", authorName: ctx.user.name, body } });
    await appendAudit(tx, inv.organisationId, {
      eventType: "invoice.message", entityType: "invoice", entityId: inv.id, actorType: "supplier", actorId: ctx.user.id,
      payload: { from: "supplier", author: ctx.user.name, body },
    });
    return m;
  });
}

// ---------------------------------------------------------------- reading

export async function listSupplierInvoices(ctx: VendorCtx, filter: { status?: string; connectionId?: string } = {}) {
  const rows = await forVendor(ctx.vendorAccountId).invoice.findMany({
    where: {
      ...(filter.status ? { status: filter.status as InvoiceStatus } : { status: { not: "cancelled" } }),
      ...(filter.connectionId ? { connectionId: filter.connectionId } : {}),
    },
    include: { connection: { include: { organisation: { select: { name: true } } } } },
    orderBy: [{ updatedAt: "desc" }],
    take: 300,
  });
  return rows.map((i) => ({
    id: i.id, kind: i.kind, invoiceNumber: i.invoiceNumber, status: i.status, buyerName: i.connection.organisation.name,
    totalMinor: i.totalMinor, currency: i.currency, poNumber: i.poNumber, invoiceDate: i.invoiceDate, dueDate: i.dueDate,
    submittedAt: i.submittedAt, paidAt: i.paidAt, scheduledFor: i.scheduledFor, supplierNote: i.supplierNote,
  }));
}

export async function getSupplierInvoice(ctx: VendorCtx, invoiceId: string) {
  const inv = await forVendor(ctx.vendorAccountId).invoice.findFirst({
    where: { id: invoiceId },
    include: {
      lines: { orderBy: { position: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      connection: { include: { organisation: { select: { name: true, billingAddress: true } }, vendor: { select: { code: true } }, bankAccount: { select: { bankName: true, accountLast4: true } } } },
    },
  });
  if (!inv) throw notFound("Invoice");
  const credits = inv.kind === "invoice" ? await forVendor(ctx.vendorAccountId).invoice.findMany({ where: { creditForInvoiceId: inv.id, status: { notIn: ["cancelled", "draft"] } }, select: { id: true, invoiceNumber: true, totalMinor: true, status: true } }) : [];
  const creditFor = inv.creditForInvoiceId ? await forVendor(ctx.vendorAccountId).invoice.findFirst({ where: { id: inv.creditForInvoiceId }, select: { id: true, invoiceNumber: true } }) : null;
  return {
    id: inv.id, kind: inv.kind, invoiceNumber: inv.invoiceNumber, status: inv.status, currency: inv.currency,
    poNumber: inv.poNumber, invoiceDate: inv.invoiceDate, dueDate: inv.dueDate, notes: inv.notes,
    subtotalMinor: inv.subtotalMinor, taxMinor: inv.taxMinor, totalMinor: inv.totalMinor, revision: inv.revision,
    submittedAt: inv.submittedAt, scheduledFor: inv.scheduledFor, paidAt: inv.paidAt, paymentReference: inv.paymentReference,
    supplierNote: inv.supplierNote, connectionId: inv.connectionId, buyerName: inv.connection.organisation.name,
    billingAddress: inv.connection.organisation.billingAddress, yourVendorCode: inv.connection.vendor.code,
    payTo: inv.connection.bankAccount, creditFor, credits,
    lines: inv.lines.map((l) => ({ id: l.id, position: l.position, description: l.description, quantity: l.quantity, unitPriceMinor: l.unitPriceMinor, taxRateBps: l.taxRateBps, amountMinor: l.amountMinor })),
    events: inv.events.map((e) => ({ id: e.id, status: e.status, note: e.note, actorType: e.actorType, actorName: e.actorType === "supplier" ? e.actorName : null, at: e.createdAt })),
    messages: inv.messages.map((m) => ({ id: m.id, authorType: m.authorType, authorName: m.authorName, body: m.body, at: m.createdAt })),
  };
}

/** Supplier home: what you're owed, how fast you get paid, and what needs your attention. */
export async function getSupplierHome(ctx: VendorCtx, now = new Date()) {
  const v = forVendor(ctx.vendorAccountId);
  const all = await v.invoice.findMany({
    where: { status: { not: "cancelled" } },
    select: { id: true, kind: true, status: true, totalMinor: true, currency: true, submittedAt: true, paidAt: true, invoiceNumber: true, dueDate: true, connection: { select: { organisation: { select: { name: true } } } } },
  });
  const invoices = all.filter((i) => i.kind === "invoice");
  const sum = (xs: typeof all) => xs.reduce((s, i) => s + i.totalMinor, 0n);
  const outstanding = invoices.filter((i) => OUTSTANDING.includes(i.status));
  const since90 = now.getTime() - 90 * DAY;
  const paid90 = invoices.filter((i) => i.status === "paid" && i.paidAt && i.paidAt.getTime() >= since90);
  const paidWithDates = invoices.filter((i) => i.status === "paid" && i.paidAt && i.submittedAt);
  const avgDays = paidWithDates.length ? paidWithDates.reduce((s, i) => s + (i.paidAt!.getTime() - i.submittedAt!.getTime()) / DAY, 0) / paidWithDates.length : null;
  const overdue = outstanding.filter((i) => i.dueDate.getTime() < now.getTime() && i.status !== "scheduled");
  const attention = all
    .filter((i) => i.status === "needs_changes" || i.status === "draft")
    .map((i) => ({ id: i.id, invoiceNumber: i.invoiceNumber, status: i.status, buyerName: i.connection.organisation.name, totalMinor: i.totalMinor, currency: i.currency }));
  return {
    outstandingMinor: sum(outstanding), outstandingCount: outstanding.length,
    scheduledMinor: sum(invoices.filter((i) => i.status === "scheduled")),
    paid90Minor: sum(paid90), paid90Count: paid90.length,
    avgDaysToPay: avgDays === null ? null : Math.round(avgDays * 10) / 10,
    overdueMinor: sum(overdue), overdueCount: overdue.length,
    attention,
  };
}
