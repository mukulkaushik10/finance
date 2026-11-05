import { z } from "zod";
import type { InvoiceStatus } from "@prisma/client";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { can } from "../auth/permissions";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { reviewAction } from "../review/service";
import { formatMoney } from "@/lib/money";
import { addInvoiceEvent, DEFAULT_NOTES } from "./sync";
import { notify } from "./notify";

// Buyer side: invoices that suppliers sent through the portal. Decisions on invoices that went
// through the AI check are recorded as reviews of that action, so accuracy tracking and the
// audit trail stay complete.

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine((s) => !Number.isNaN(Date.parse(s + "T00:00:00Z")), "Not a real date");

export async function listPortalInvoices(ctx: Ctx, filter: { status?: string; q?: string } = {}) {
  requirePermission(ctx, "suppliers:view");
  const q = filter.q?.trim();
  const rows = await forOrg(ctx.organisationId).invoice.findMany({
    where: {
      status: filter.status ? (filter.status as InvoiceStatus) : { notIn: ["draft"] },
      ...(q ? { OR: [{ invoiceNumber: { contains: q, mode: "insensitive" } }, { vendor: { name: { contains: q, mode: "insensitive" } } }, { poNumber: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: { vendor: { select: { code: true, name: true } } },
    orderBy: [{ submittedAt: { sort: "desc", nulls: "last" } }],
    take: 300,
  });
  const actionIds = rows.map((r) => r.actionId).filter((x): x is string => Boolean(x));
  const actions = actionIds.length ? await forOrg(ctx.organisationId).action.findMany({ where: { id: { in: actionIds } }, select: { id: true, status: true, gateOutcome: true } }) : [];
  const byId = new Map(actions.map((a) => [a.id, a]));
  return rows.map((r) => ({
    id: r.id, kind: r.kind, invoiceNumber: r.invoiceNumber, status: r.status, vendor: r.vendor, poNumber: r.poNumber,
    totalMinor: r.totalMinor, currency: r.currency, invoiceDate: r.invoiceDate, dueDate: r.dueDate, submittedAt: r.submittedAt,
    scheduledFor: r.scheduledFor, paidAt: r.paidAt, revision: r.revision,
    check: r.actionId ? byId.get(r.actionId) ?? null : null,
  }));
}

export async function getPortalInvoice(ctx: Ctx, invoiceId: string) {
  requirePermission(ctx, "suppliers:view");
  const db = forOrg(ctx.organisationId);
  const inv = await db.invoice.findFirst({
    where: { id: invoiceId },
    include: {
      vendor: true,
      lines: { orderBy: { position: "asc" } },
      events: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" } },
      payFrom: { select: { id: true, nickname: true, bankName: true, accountLast4: true } },
      vendorAccount: { select: { legalName: true, taxId: true, email: true, phone: true, addressLine1: true, city: true, region: true, postalCode: true } },
      connection: { include: { bankAccount: { select: { bankName: true, accountLast4: true, routingNumber: true, fingerprint: true } } } },
    },
  });
  if (!inv) throw notFound("Invoice");
  const action = inv.actionId
    ? await db.action.findFirst({ where: { id: inv.actionId }, include: { ruleResults: { include: { ruleVersion: { select: { version: true } } } }, review: { include: { reviewer: { select: { name: true } } } }, agent: { select: { name: true } } } })
    : null;
  const pendingBankChange = await db.bankDetailChange.findFirst({ where: { connectionId: inv.connectionId, status: "pending" }, select: { id: true, requestedAt: true } });
  const creditFor = inv.creditForInvoiceId ? await db.invoice.findFirst({ where: { id: inv.creditForInvoiceId }, select: { id: true, invoiceNumber: true, totalMinor: true } }) : null;
  return { ...inv, action, pendingBankChange, creditFor, payToChangedSinceSent: Boolean(inv.bankFingerprint && inv.connection.bankAccount && inv.bankFingerprint !== inv.connection.bankAccount.fingerprint) };
}

export const DecideInvoiceSchema = z.object({
  decision: z.enum(["approve", "send_back", "reject"]),
  reason: z.string().trim().min(10, "Please give a reason of at least a few words").max(2000),
  messageToSupplier: z.string().trim().max(2000).optional(),
}).refine((d) => d.decision === "approve" || (d.messageToSupplier && d.messageToSupplier.length >= 5), { path: ["messageToSupplier"], message: "Tell the supplier what to fix or why" });

const NEXT: Record<"approve" | "send_back" | "reject", InvoiceStatus> = { approve: "approved", send_back: "needs_changes", reject: "rejected" };

export async function decidePortalInvoice(ctx: Ctx, invoiceId: string, input: unknown) {
  requirePermission(ctx, "actions:review");
  const d = DecideInvoiceSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId }, include: { vendor: true, vendorAccount: { select: { email: true } } } });
  if (!inv) throw notFound("Invoice");
  if (inv.status !== "under_review") throw conflict("This invoice isn't waiting for a decision");

  if (inv.actionId) {
    const action = await db.action.findFirst({ where: { id: inv.actionId }, include: { review: true } });
    if (action?.status === "blocked" && d.decision === "approve") throw badRequest("A control blocked this invoice, so it can't be approved. Send it back to the supplier or reject it.");
    if (action && !action.review && (action.status === "pending_review" || action.status === "logged")) {
      await reviewAction(ctx, action.id, { decision: d.decision === "approve" ? "approve" : "reject", reason: d.reason }, { skipInvoiceSync: true });
    }
  }
  const next = NEXT[d.decision];
  const note = d.messageToSupplier || DEFAULT_NOTES[next as "approved" | "needs_changes" | "rejected"];
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: next, supplierNote: note, decidedAt: new Date() } });
    await addInvoiceEvent(tx, inv, next, note, { type: "buyer", name: ctx.user.name });
    if (d.messageToSupplier) {
      await tx.invoiceMessage.create({ data: { organisationId: ctx.organisationId, vendorAccountId: inv.vendorAccountId, invoiceId: inv.id, authorType: "buyer", authorName: ctx.user.name, body: d.messageToSupplier } });
    }
    await appendAudit(tx, ctx.organisationId, {
      eventType: "invoice.decided", entityType: "invoice", entityId: inv.id, actorType: "user", actorId: ctx.user.id,
      payload: { invoiceNumber: inv.invoiceNumber, vendor: { code: inv.vendor.code, name: inv.vendor.name }, decision: d.decision, newStatus: next, reason: d.reason, messageToSupplier: d.messageToSupplier ?? null, actionId: inv.actionId, totalMinor: inv.totalMinor, currency: inv.currency, by: { name: ctx.user.name, role: ctx.user.role } },
    });
  });
  await notify({ to: inv.vendorAccount.email, subject: `Invoice ${inv.invoiceNumber}: ${next.replace("_", " ")}`, body: note });
  return { status: next };
}

export const SchedulePaymentSchema = z.object({ payFromAccountId: z.string().min(1, "Choose the account to pay from"), payOn: isoDate });

export async function schedulePayment(ctx: Ctx, invoiceId: string, input: unknown) {
  requirePermission(ctx, "payments:manage");
  const d = SchedulePaymentSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invoice:" + invoiceId}))`;
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId }, include: { vendor: true, connection: { include: { bankAccount: true } } } });
    if (!inv) throw notFound("Invoice");
    if (inv.kind !== "invoice") throw badRequest("Credit notes aren't paid; they reduce what you owe");
    if (inv.status !== "approved" && inv.status !== "scheduled") throw conflict("Only approved invoices can be scheduled for payment");
    if (inv.vendor.blocked) throw badRequest(`${inv.vendor.name} is blocked (${inv.vendor.blockedReason}). Payments can't be scheduled.`);
    const payTo = inv.connection.bankAccount;
    if (!payTo) throw badRequest("The supplier has no approved bank account");
    if (inv.bankFingerprint && payTo.fingerprint !== inv.bankFingerprint) throw conflict("The supplier's bank details changed after this invoice was sent. Ask them to confirm, then send it again.");
    const pending = await tx.bankDetailChange.findFirst({ where: { connectionId: inv.connectionId, status: "pending" } });
    if (pending) throw conflict("This supplier has a bank detail change waiting for approval. Decide it first.");
    const from = await tx.organisationBankAccount.findFirst({ where: { id: d.payFromAccountId, state: "active" } });
    if (!from) throw badRequest("Choose one of your active bank accounts");
    if (from.currency !== inv.currency) throw badRequest(`${from.nickname} holds ${from.currency}; this invoice is in ${inv.currency}`);
    const payOn = new Date(d.payOn + "T00:00:00Z");
    if (payOn.getTime() < Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z")) throw badRequest("Choose today or a later date");
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "scheduled", scheduledFor: payOn, payFromAccountId: from.id } });
    const note = `Payment of ${formatMoney(inv.totalMinor, inv.currency)} scheduled for ${d.payOn} to your account ending ${payTo.accountLast4}`;
    await addInvoiceEvent(tx, inv, "scheduled", note, { type: "buyer", name: ctx.user.name });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "invoice.payment_scheduled", entityType: "invoice", entityId: inv.id, actorType: "user", actorId: ctx.user.id,
      payload: { invoiceNumber: inv.invoiceNumber, vendor: { code: inv.vendor.code, name: inv.vendor.name }, amountMinor: inv.totalMinor, currency: inv.currency, payOn: d.payOn, payFrom: { id: from.id, nickname: from.nickname, accountLast4: from.accountLast4 }, payTo: { bankName: payTo.bankName, accountLast4: payTo.accountLast4, fingerprint: payTo.fingerprint }, rescheduled: inv.status === "scheduled", by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return { status: "scheduled" as const, scheduledFor: payOn };
  });
}

export const MarkPaidSchema = z.object({ paidOn: isoDate, reference: z.string().trim().min(3, "Enter the payment reference from your bank").max(80) });

export async function markInvoicePaid(ctx: Ctx, invoiceId: string, input: unknown) {
  requirePermission(ctx, "payments:manage");
  const d = MarkPaidSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const res = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"invoice:" + invoiceId}))`;
    const inv = await tx.invoice.findFirst({ where: { id: invoiceId }, include: { vendor: true, vendorAccount: { select: { email: true } }, payFrom: true } });
    if (!inv) throw notFound("Invoice");
    if (inv.status !== "scheduled") throw conflict("Schedule the payment before recording it as paid");
    const paidAt = new Date(d.paidOn + "T12:00:00Z");
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "paid", paidAt, paymentReference: d.reference } });
    const note = `Paid ${formatMoney(inv.totalMinor, inv.currency)} on ${d.paidOn}. Payment reference ${d.reference}`;
    await addInvoiceEvent(tx, inv, "paid", note, { type: "buyer", name: ctx.user.name });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "invoice.paid", entityType: "invoice", entityId: inv.id, actorType: "user", actorId: ctx.user.id,
      payload: { invoiceNumber: inv.invoiceNumber, vendor: { code: inv.vendor.code, name: inv.vendor.name }, amountMinor: inv.totalMinor, currency: inv.currency, paidOn: d.paidOn, reference: d.reference, payFrom: inv.payFrom ? { nickname: inv.payFrom.nickname, accountLast4: inv.payFrom.accountLast4 } : null, by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return { inv, note };
  });
  await notify({ to: res.inv.vendorAccount.email, subject: `Invoice ${res.inv.invoiceNumber} paid`, body: res.note });
  return { status: "paid" as const };
}

export async function postBuyerMessage(ctx: Ctx, invoiceId: string, input: unknown) {
  if (!can(ctx.user.role, "actions:review") && !can(ctx.user.role, "suppliers:manage")) throw forbidden();
  const { body } = z.object({ body: z.string().trim().min(1).max(4000) }).parse(input);
  const db = forOrg(ctx.organisationId);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId }, include: { vendorAccount: { select: { email: true } } } });
  if (!inv) throw notFound("Invoice");
  const m = await db.$transaction(async (tx) => {
    const msg = await tx.invoiceMessage.create({ data: { organisationId: ctx.organisationId, vendorAccountId: inv.vendorAccountId, invoiceId: inv.id, authorType: "buyer", authorName: ctx.user.name, body } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "invoice.message", entityType: "invoice", entityId: inv.id, actorType: "user", actorId: ctx.user.id,
      payload: { from: "buyer", author: ctx.user.name, body },
    });
    return msg;
  });
  await notify({ to: inv.vendorAccount.email, subject: `New message about invoice ${inv.invoiceNumber}`, body });
  return m;
}
