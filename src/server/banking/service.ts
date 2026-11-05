import { z } from "zod";
import { forOrg } from "../db/dal";
import { requirePermission, type Ctx } from "../auth/session";
import { can } from "../auth/permissions";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { isValidRoutingNumber, sealBankAccount } from "../crypto/secrets";

// The organisation's own bank accounts: where supplier payments are made from.
// Admins add and change them; controllers can see them and choose one when scheduling payments.
// Full account numbers are encrypted at rest and never returned by the API.

export const publicBankAccount = (a: { id: string; nickname: string; holderName: string; bankName: string; routingNumber: string; accountLast4: string; currency: string; isDefault: boolean; state: string; createdAt: Date }) => ({
  id: a.id, nickname: a.nickname, holderName: a.holderName, bankName: a.bankName,
  routingNumber: a.routingNumber, accountLast4: a.accountLast4, currency: a.currency,
  isDefault: a.isDefault, state: a.state, createdAt: a.createdAt,
});

export const routingNumberSchema = z.string().trim().refine(isValidRoutingNumber, "Enter a valid 9-digit US routing number");
export const accountNumberSchema = z.string().trim().transform((s) => s.replace(/[\s-]/g, "")).refine((s) => /^\d{4,17}$/.test(s), "Account numbers are 4 to 17 digits");

export const AddBankAccountSchema = z.object({
  nickname: z.string().trim().min(2).max(60),
  holderName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  routingNumber: routingNumberSchema,
  accountNumber: accountNumberSchema,
  currency: z.string().length(3).default("USD").transform((c) => c.toUpperCase()),
  isDefault: z.boolean().default(false),
});

export async function listBankAccounts(ctx: Ctx, opts: { includeArchived?: boolean } = {}) {
  if (!can(ctx.user.role, "settings:view") && !can(ctx.user.role, "payments:manage")) throw forbidden();
  const rows = await forOrg(ctx.organisationId).organisationBankAccount.findMany({
    where: opts.includeArchived ? {} : { state: "active" },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(publicBankAccount);
}

export async function addBankAccount(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = AddBankAccountSchema.parse(input);
  const sealed = sealBankAccount(d.routingNumber, d.accountNumber);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const dup = await tx.organisationBankAccount.findFirst({ where: { fingerprint: sealed.fingerprint, state: "active" } });
    if (dup) throw conflict(`This account is already set up as "${dup.nickname}"`);
    const count = await tx.organisationBankAccount.count({ where: { state: "active" } });
    const makeDefault = d.isDefault || count === 0;
    if (makeDefault) await tx.organisationBankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const a = await tx.organisationBankAccount.create({
      data: {
        organisationId: ctx.organisationId, nickname: d.nickname, holderName: d.holderName, bankName: d.bankName,
        currency: d.currency, isDefault: makeDefault, createdById: ctx.user.id, ...sealed,
      },
    });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "bank_account.added", entityType: "bank_account", entityId: a.id, actorType: "user", actorId: ctx.user.id,
      payload: { account: publicBankAccount(a), by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return publicBankAccount(a);
  });
}

export const UpdateBankAccountSchema = z.object({
  nickname: z.string().trim().min(2).max(60).optional(),
  isDefault: z.literal(true).optional(),
  archived: z.boolean().optional(),
  reason: z.string().trim().min(5, "Say briefly why").max(500),
});

export async function updateBankAccount(ctx: Ctx, accountId: string, input: unknown) {
  requirePermission(ctx, "settings:edit");
  const d = UpdateBankAccountSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  return db.$transaction(async (tx) => {
    const before = await tx.organisationBankAccount.findFirst({ where: { id: accountId } });
    if (!before) throw notFound("Bank account");
    if (d.archived && before.isDefault) throw badRequest("Choose another default account before archiving this one");
    if (d.isDefault && before.state === "archived") throw badRequest("An archived account can't be the default");
    if (d.archived) {
      const scheduled = await tx.invoice.count({ where: { payFromAccountId: accountId, status: "scheduled" } });
      if (scheduled) throw conflict(`${scheduled} scheduled payment${scheduled === 1 ? "" : "s"} will be paid from this account. Move them first.`);
    }
    if (d.isDefault) await tx.organisationBankAccount.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const a = await tx.organisationBankAccount.update({
      where: { id: accountId },
      data: {
        ...(d.nickname ? { nickname: d.nickname } : {}),
        ...(d.isDefault ? { isDefault: true } : {}),
        ...(d.archived !== undefined ? { state: d.archived ? "archived" : "active" } : {}),
      },
    });
    await appendAudit(tx, ctx.organisationId, {
      eventType: "bank_account.changed", entityType: "bank_account", entityId: a.id, actorType: "user", actorId: ctx.user.id,
      payload: { before: publicBankAccount(before), after: publicBankAccount(a), reason: d.reason, by: { name: ctx.user.name, role: ctx.user.role } },
    });
    return publicBankAccount(a);
  });
}
