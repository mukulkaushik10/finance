import { z } from "zod";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { badRequest, conflict, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { hashToken, newToken } from "../crypto/secrets";
import { notify } from "./notify";

// Buyer side of the supplier portal: invite suppliers from the vendor list, see who is
// connected, and approve or reject requests to change where a supplier is paid.

const INVITE_DAYS = 14;

export const InviteSchema = z.object({
  vendorId: z.string().min(1),
  email: z.string().trim().email("Enter the supplier's email address").transform((e) => e.toLowerCase()),
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
});

export function inviteUrl(token: string) {
  return `${process.env.APP_URL ?? ""}/portal/invite/${token}`;
}

/** Invite (or re-invite) a supplier. Returns the invitation link once; only its hash is stored. */
export async function inviteSupplier(ctx: Ctx, input: unknown, opts: { token?: string } = {}) {
  requirePermission(ctx, "suppliers:manage");
  const d = InviteSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const token = opts.token ?? newToken();
  const result = await db.$transaction(async (tx) => {
    const vendor = await tx.vendor.findFirst({ where: { id: d.vendorId } });
    if (!vendor) throw notFound("Vendor");
    if (vendor.blocked) throw badRequest(`${vendor.name} is blocked (${vendor.blockedReason}). Unblock it before inviting.`);
    const existing = await tx.vendorConnection.findFirst({ where: { vendorId: vendor.id } });
    if (existing && existing.status !== "invited") throw conflict(`${vendor.name} is already connected to the supplier portal`);
    const data = {
      inviteEmail: d.email, inviteTokenHash: hashToken(token), inviteExpiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000),
      invitedById: ctx.user.id, invitedAt: new Date(), paymentTermsDays: d.paymentTermsDays,
    };
    const conn = existing
      ? await tx.vendorConnection.update({ where: { id: existing.id }, data })
      : await tx.vendorConnection.create({ data: { organisationId: ctx.organisationId, vendorId: vendor.id, status: "invited", ...data } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "supplier.invited", entityType: "vendor", entityId: vendor.id, actorType: "user", actorId: ctx.user.id,
      payload: { vendor: { code: vendor.code, name: vendor.name }, email: d.email, paymentTermsDays: d.paymentTermsDays, resent: Boolean(existing), by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return { conn, vendor };
  });
  const url = inviteUrl(token);
  await notify({ to: d.email, subject: `${ctx.user.name} invited you to send invoices`, body: `Accept the invitation: ${url}` });
  return { connectionId: result.conn.id, vendor: { id: result.vendor.id, name: result.vendor.name, code: result.vendor.code }, email: d.email, inviteUrl: url, expiresAt: result.conn.inviteExpiresAt };
}

export async function listSupplierConnections(ctx: Ctx) {
  requirePermission(ctx, "suppliers:view");
  const db = forOrg(ctx.organisationId);
  const rows = await db.vendorConnection.findMany({
    include: {
      vendor: { select: { id: true, code: true, name: true, category: true } },
      vendorAccount: { select: { legalName: true, taxId: true, email: true } },
      bankAccount: { select: { bankName: true, accountLast4: true } },
      _count: { select: { invoices: true } },
    },
    orderBy: [{ status: "asc" }, { invitedAt: "desc" }],
  });
  return rows.map((c) => ({
    id: c.id, status: c.status, vendor: c.vendor, inviteEmail: c.inviteEmail, invitedAt: c.invitedAt, acceptedAt: c.acceptedAt,
    inviteExpired: c.status === "invited" && Boolean(c.inviteExpiresAt && c.inviteExpiresAt < new Date()),
    paymentTermsDays: c.paymentTermsDays, supplier: c.vendorAccount, bankAccount: c.bankAccount, invoiceCount: c._count.invoices,
  }));
}

export async function setConnectionSuspended(ctx: Ctx, connectionId: string, input: unknown) {
  requirePermission(ctx, "suppliers:manage");
  const d = z.object({ suspended: z.boolean(), reason: z.string().trim().min(5, "Say briefly why").max(500) }).parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const c = await tx.vendorConnection.findFirst({ where: { id: connectionId }, include: { vendor: true } });
    if (!c) throw notFound("Supplier connection");
    if (c.status === "invited") throw badRequest("This supplier hasn't accepted the invitation yet");
    const updated = await tx.vendorConnection.update({ where: { id: c.id }, data: { status: d.suspended ? "suspended" : "active" } });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "vendor.changed", entityType: "vendor", entityId: c.vendorId, actorType: "user", actorId: ctx.user.id,
      payload: { vendor: { code: c.vendor.code, name: c.vendor.name }, change: d.suspended ? "supplier portal access suspended" : "supplier portal access restored", reason: d.reason, by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return { id: updated.id, status: updated.status };
  });
}

// ---------------------------------------------------------------- bank detail changes

export async function listBankChanges(ctx: Ctx, opts: { status?: "pending" | "all" } = {}) {
  requirePermission(ctx, "suppliers:view");
  const rows = await forOrg(ctx.organisationId).bankDetailChange.findMany({
    where: opts.status === "all" ? {} : { status: "pending" },
    include: {
      connection: { include: { vendor: { select: { id: true, code: true, name: true } } } },
      vendorAccount: { select: { legalName: true, email: true, phone: true } },
      newBankAccount: { select: { holderName: true, bankName: true, routingNumber: true, accountLast4: true } },
      previousBankAccount: { select: { holderName: true, bankName: true, routingNumber: true, accountLast4: true } },
    },
    orderBy: { requestedAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id, status: r.status, requestedAt: r.requestedAt, requestedByName: r.requestedByName,
    vendor: r.connection.vendor, supplier: r.vendorAccount, newAccount: r.newBankAccount, previousAccount: r.previousBankAccount,
    decidedByName: r.decidedByName, decidedAt: r.decidedAt, verification: r.verification, decisionNote: r.decisionNote,
  }));
}

export const DecideBankChangeSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  verification: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
}).superRefine((d, c) => {
  if (d.decision === "approve" && (!d.verification || d.verification.length < 10)) {
    c.addIssue({ code: "custom", path: ["verification"], message: "Say how you confirmed the change with the supplier (for example, who you called and on which number from your records)" });
  }
  if (d.decision === "reject" && (!d.note || d.note.length < 5)) c.addIssue({ code: "custom", path: ["note"], message: "Give a reason the supplier will see" });
});

/**
 * Approving updates the vendor record's bank details, so future invoices match. The change date is
 * recorded too, so the bank-change rule sends the next payments to a person as an extra safeguard.
 */
export async function decideBankChange(ctx: Ctx, changeId: string, input: unknown) {
  requirePermission(ctx, "suppliers:manage");
  const d = DecideBankChangeSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bankchange:" + changeId}))`;
    const ch = await tx.bankDetailChange.findFirst({ where: { id: changeId }, include: { connection: { include: { vendor: true } }, newBankAccount: true } });
    if (!ch) throw notFound("Bank detail change");
    if (ch.status !== "pending") throw conflict("This request has already been decided");
    const now = new Date();
    const updated = await tx.bankDetailChange.update({
      where: { id: ch.id },
      data: { status: d.decision === "approve" ? "approved" : "rejected", decidedById: ctx.user.id, decidedByName: ctx.user.name, decidedAt: now, verification: d.verification ?? null, decisionNote: d.note ?? null },
    });
    const v = ch.connection.vendor;
    if (d.decision === "approve") {
      await tx.vendorConnection.update({ where: { id: ch.connectionId }, data: { bankAccountId: ch.newBankAccountId } });
      await tx.vendor.update({ where: { id: v.id }, data: { bankFingerprint: ch.newBankAccount.fingerprint, bankChangedAt: now } });
    }
    await appendAudit(tx, ctx.organisationId, {
      eventType: "supplier.bank_change_decided", entityType: "vendor", entityId: v.id, actorType: "user", actorId: ctx.user.id,
      payload: {
        vendor: { code: v.code, name: v.name }, changeId: ch.id, decision: d.decision, verification: d.verification ?? null, note: d.note ?? null,
        newAccount: { bankName: ch.newBankAccount.bankName, routingNumber: ch.newBankAccount.routingNumber, accountLast4: ch.newBankAccount.accountLast4, fingerprint: ch.newBankAccount.fingerprint },
        previousFingerprint: v.bankFingerprint, by: { name: ctx.user.name, role: ctx.user.role },
      },
    });
    return { id: updated.id, status: updated.status };
  });
}
