import { z } from "zod";
import { forVendor } from "../db/vendor-dal";
import { forOrg } from "../db/dal";
import { appendAudit } from "../audit/chain";
import { sealBankAccount } from "../crypto/secrets";
import { accountNumberSchema, routingNumberSchema } from "../banking/service";
import { badRequest, forbidden, notFound } from "../errors";
import { confirmVendorPassword } from "./auth";
import { notify } from "./notify";
import type { VendorCtx } from "./session";

// Supplier side: company profile, the buyers they're connected to, and their bank accounts.

export async function getSupplierProfile(ctx: VendorCtx) {
  const v = forVendor(ctx.vendorAccountId);
  const account = await v.vendorAccount.findFirst({ where: {} });
  if (!account) throw notFound("Supplier account");
  return account;
}

export const UpdateProfileSchema = z.object({
  legalName: z.string().trim().min(2).max(160).optional(),
  taxId: z.string().trim().regex(/^\d{2}-?\d{7}$/, "Enter a US EIN like 12-3456789").optional(),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  addressLine1: z.string().trim().max(160).optional(),
  addressLine2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(80).optional(),
  region: z.string().trim().max(40).optional(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a ZIP code like 94107").optional().or(z.literal("")),
});

export async function updateSupplierProfile(ctx: VendorCtx, input: unknown) {
  if (ctx.user.role !== "owner") throw forbidden("Only the account owner can change company details");
  const d = UpdateProfileSchema.parse(input);
  return forVendor(ctx.vendorAccountId).vendorAccount.update({
    where: { id: ctx.vendorAccountId },
    data: { ...d, taxId: d.taxId ? d.taxId.replace(/^(\d{2})-?(\d{7})$/, "$1-$2") : d.taxId },
  });
}

/** The buyers this supplier is connected to, with which bank account each has approved. */
export async function listBuyers(ctx: VendorCtx) {
  const rows = await forVendor(ctx.vendorAccountId).vendorConnection.findMany({
    where: { status: { in: ["active", "suspended"] } },
    include: {
      organisation: { select: { name: true, billingAddress: true } },
      vendor: { select: { code: true, name: true } },
      bankAccount: { select: { id: true, bankName: true, accountLast4: true } },
      bankChanges: { where: { status: "pending" }, select: { id: true, requestedAt: true, newBankAccount: { select: { bankName: true, accountLast4: true } } } },
    },
    orderBy: { acceptedAt: "asc" },
  });
  return rows.map((c) => ({
    connectionId: c.id, status: c.status, buyerName: c.organisation.name, billingAddress: c.organisation.billingAddress,
    yourVendorCode: c.vendor.code, paymentTermsDays: c.paymentTermsDays, bankAccount: c.bankAccount,
    pendingBankChange: c.bankChanges[0] ?? null,
  }));
}

export async function getActiveConnection(ctx: VendorCtx, connectionId: string) {
  const c = await forVendor(ctx.vendorAccountId).vendorConnection.findFirst({
    where: { id: connectionId },
    include: { organisation: { select: { id: true, name: true, billingAddress: true } }, vendor: true, bankAccount: true },
  });
  if (!c) throw notFound("Buyer");
  if (c.status !== "active") throw forbidden(`Your access to ${c.organisation.name} is suspended. Contact their accounts payable team.`);
  return c;
}

export async function listSupplierBankAccounts(ctx: VendorCtx) {
  const rows = await forVendor(ctx.vendorAccountId).vendorBankAccount.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((b) => ({ id: b.id, holderName: b.holderName, bankName: b.bankName, routingNumber: b.routingNumber, accountLast4: b.accountLast4, createdAt: b.createdAt }));
}

export const RequestBankChangeSchema = z.object({
  holderName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  routingNumber: routingNumberSchema,
  accountNumber: accountNumberSchema,
  confirmAccountNumber: z.string().trim().transform((s) => s.replace(/[\s-]/g, "")),
  /** Which buyers should pay into this account. Defaults to all connected buyers. */
  connectionIds: z.array(z.string()).optional(),
  password: z.string().min(1, "Enter your password to confirm"),
}).refine((d) => d.accountNumber === d.confirmAccountNumber, { path: ["confirmAccountNumber"], message: "The account numbers don't match" });

/**
 * Ask to be paid into a new account. Nothing changes until each buyer approves; until then
 * invoices keep using the account the buyer already approved.
 */
export async function requestBankChange(ctx: VendorCtx, input: unknown) {
  if (ctx.user.role !== "owner") throw forbidden("Only the account owner can change bank details");
  const d = RequestBankChangeSchema.parse(input);
  await confirmVendorPassword(ctx, d.password);
  const v = forVendor(ctx.vendorAccountId);
  const sealed = sealBankAccount(d.routingNumber, d.accountNumber);
  const conns = await v.vendorConnection.findMany({
    where: { status: "active", ...(d.connectionIds ? { id: { in: d.connectionIds } } : {}) },
    include: { organisation: { select: { name: true } }, vendor: { select: { code: true, name: true } }, bankAccount: { select: { fingerprint: true } } },
  });
  if (d.connectionIds && conns.length !== d.connectionIds.length) throw badRequest("Choose buyers you're connected to");
  if (!conns.length) throw badRequest("You aren't connected to any buyers yet");

  const bank = (await v.vendorBankAccount.findFirst({ where: { fingerprint: sealed.fingerprint } }))
    ?? (await v.vendorBankAccount.create({ data: { vendorAccountId: ctx.vendorAccountId, holderName: d.holderName, bankName: d.bankName, ...sealed } }));

  const requested: { buyerName: string; changeId: string }[] = [];
  const unchanged: string[] = [];
  for (const c of conns) {
    if (c.bankAccount?.fingerprint === sealed.fingerprint) { unchanged.push(c.organisation.name); continue; }
    const change = await forOrg(c.organisationId).$transaction(async (tx) => {
      await tx.bankDetailChange.updateMany({ where: { connectionId: c.id, status: "pending" }, data: { status: "withdrawn" } });
      const ch = await tx.bankDetailChange.create({
        data: {
          organisationId: c.organisationId, vendorAccountId: ctx.vendorAccountId, connectionId: c.id,
          newBankAccountId: bank.id, previousBankAccountId: c.bankAccountId, requestedByName: ctx.user.name,
        },
      });
      await appendAudit(tx, c.organisationId, {
        eventType: "supplier.bank_change_requested", entityType: "vendor", entityId: c.vendorId, actorType: "supplier", actorId: ctx.user.id,
        payload: { vendor: c.vendor, changeId: ch.id, requestedBy: ctx.user.name, newAccount: { bankName: bank.bankName, routingNumber: bank.routingNumber, accountLast4: bank.accountLast4, fingerprint: bank.fingerprint } },
      });
      return ch;
    });
    requested.push({ buyerName: c.organisation.name, changeId: change.id });
  }
  await notify({ to: ctx.user.email, subject: "Bank detail change requested", body: `If you didn't ask for this, contact your buyers now. Requested for: ${requested.map((r) => r.buyerName).join(", ") || "none"}` });
  return { bankAccount: { id: bank.id, bankName: bank.bankName, accountLast4: bank.accountLast4 }, requested, unchanged };
}
