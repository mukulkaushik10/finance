import { z } from "zod";
import { rawPrisma } from "../db/client";
import { forOrg } from "../db/dal";
import { hashPassword, verifyPassword } from "../auth/password";
import { appendAudit } from "../audit/chain";
import { hashToken } from "../crypto/secrets";
import { badRequest, conflict, notFound, unauthorized } from "../errors";
import { createVendorSessionToken, type VendorCtx } from "./session";

// Supplier sign-in and invitation acceptance. Suppliers only join through a buyer's invitation.

export const VendorLoginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function vendorLogin(input: unknown) {
  const { email, password } = VendorLoginSchema.parse(input);
  const user = await rawPrisma.vendorUser.findUnique({ where: { email: email.toLowerCase() }, include: { vendorAccount: true } });
  if (!user || !user.active || !verifyPassword(password, user.passwordHash)) throw unauthorized("Email or password is incorrect");
  return { token: await createVendorSessionToken(user.id), user: { id: user.id, name: user.name, accountName: user.vendorAccount.legalName } };
}

/** Re-check the signed-in supplier's password before a sensitive change (bank details). */
export async function confirmVendorPassword(ctx: VendorCtx, password: string) {
  const user = await rawPrisma.vendorUser.findUnique({ where: { id: ctx.user.id } });
  if (!user || !verifyPassword(password, user.passwordHash)) throw badRequest("Your password is incorrect");
}

async function findInvite(token: string) {
  const conn = await rawPrisma.vendorConnection.findUnique({
    where: { inviteTokenHash: hashToken(token) },
    include: { organisation: { select: { name: true } }, vendor: { select: { name: true, code: true } } },
  });
  if (!conn || conn.status !== "invited") throw notFound("Invitation");
  if (conn.inviteExpiresAt && conn.inviteExpiresAt < new Date()) throw badRequest("This invitation has expired. Ask the buyer to send a new one.");
  return conn;
}

export async function getInvitePreview(token: string) {
  const conn = await findInvite(token);
  const existing = await rawPrisma.vendorUser.findUnique({ where: { email: conn.inviteEmail.toLowerCase() }, select: { id: true } });
  return { buyerName: conn.organisation.name, supplierName: conn.vendor.name, email: conn.inviteEmail, hasAccount: Boolean(existing), paymentTermsDays: conn.paymentTermsDays };
}

export const AcceptInviteSchema = z.object({
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  legalName: z.string().trim().min(2).max(160),
  taxId: z.string().trim().regex(/^\d{2}-?\d{7}$/, "Enter a US EIN like 12-3456789").optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
});

async function connect(connId: string, organisationId: string, vendorAccountId: string, actor: { id: string; name: string }, mode: "new_account" | "existing_account") {
  return forOrg(organisationId).$transaction(async (tx) => {
    const now = new Date();
    const c = await tx.vendorConnection.update({
      where: { id: connId },
      data: { status: "active", vendorAccountId, acceptedAt: now, inviteTokenHash: null, inviteExpiresAt: null },
      include: { vendor: { select: { code: true, name: true } } },
    });
    await appendAudit(tx, organisationId, {
      eventType: "supplier.connected", entityType: "vendor", entityId: c.vendorId, actorType: "supplier", actorId: actor.id,
      payload: { vendor: c.vendor, supplierAccountId: vendorAccountId, acceptedBy: actor.name, mode },
    });
    return c;
  });
}

/** A new supplier accepts an invitation: creates their portal account and first user. */
export async function acceptInviteNew(token: string, input: unknown) {
  const d = AcceptInviteSchema.parse(input);
  const conn = await findInvite(token);
  const email = conn.inviteEmail.toLowerCase();
  if (await rawPrisma.vendorUser.findUnique({ where: { email } })) throw conflict("You already have a supplier account. Sign in to accept this invitation.");
  const account = await rawPrisma.vendorAccount.create({
    data: {
      legalName: d.legalName, taxId: d.taxId ? d.taxId.replace(/^(\d{2})-?(\d{7})$/, "$1-$2") : null, email, phone: d.phone || null,
      users: { create: { email, name: d.name, passwordHash: hashPassword(d.password), role: "owner" } },
    },
    include: { users: true },
  });
  const user = account.users[0];
  await connect(conn.id, conn.organisationId, account.id, { id: user.id, name: user.name }, "new_account");
  return { token: await createVendorSessionToken(user.id), accountId: account.id };
}

/** A supplier who already uses the portal (for another buyer) accepts a new buyer's invitation. */
export async function acceptInviteExisting(ctx: VendorCtx, token: string) {
  const conn = await findInvite(token);
  if (conn.inviteEmail.toLowerCase() !== ctx.user.email.toLowerCase()) {
    throw badRequest(`This invitation was sent to ${conn.inviteEmail}. Sign in with that email to accept it.`);
  }
  const other = await rawPrisma.vendorConnection.findFirst({ where: { organisationId: conn.organisationId, vendorAccountId: ctx.vendorAccountId, status: { not: "invited" } } });
  if (other) throw conflict(`Your account is already connected to ${conn.organisation.name}`);
  await connect(conn.id, conn.organisationId, ctx.vendorAccountId, { id: ctx.user.id, name: ctx.user.name }, "existing_account");
  return { ok: true, buyerName: conn.organisation.name };
}
