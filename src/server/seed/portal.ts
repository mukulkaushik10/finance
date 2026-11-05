import { rawPrisma } from "../db/client";
import { forOrg } from "../db/dal";
import { hashPassword } from "../auth/password";
import { hashToken, sealBankAccount } from "../crypto/secrets";
import { addBankAccount } from "../banking/service";
import { createDraft, submitInvoice } from "../portal/invoices";
import { decidePortalInvoice, markInvoicePaid, schedulePayment } from "../portal/buyer-invoices";
import { requestBankChange } from "../portal/profile";
import type { VendorCtx } from "../portal/session";
import type { Ctx } from "../auth/session";
import { DEMO } from "./demo";

// Supplier portal demo data: the buyer's bank accounts, two connected suppliers with invoices at
// every stage, a pending bank detail change, and one invitation waiting to be accepted.

const DAY = 86_400_000;
const d10 = (d: Date) => d.toISOString().slice(0, 10);

export const PORTAL_DEMO = {
  billingAddress: "Harbor & Pine Manufacturing\n400 Dockside Ave, Suite 210\nPortland, OR 97209",
  suppliers: {
    main: { vendorCode: "V-0002", userId: "vus_priya", email: "priya@supplier.example", name: "Priya Raman", bank: { holderName: "", bankName: "First Cascade Bank", routing: "121000358", account: "4402119876" } },
    second: { vendorCode: "V-0005", userId: "vus_marco", email: "marco@supplier.example", name: "Marco Diaz", bank: { holderName: "", bankName: "Summit Trust", routing: "021000021", account: "7781203344" } },
  },
  invite: { vendorCode: "V-0009", email: "accounts@newsupplier.example", token: "demo-invite-harbor-pine" },
};

const ctxOf = (u: (typeof DEMO.users)[keyof typeof DEMO.users]): Ctx => ({ organisationId: DEMO.orgId, user: { id: u.id, name: u.name, email: u.email, role: u.role } });

export async function seedPortal(opts: { now?: Date } = {}) {
  const now = opts.now ?? new Date();
  const orgId = DEMO.orgId;
  const db = forOrg(orgId);
  const admin = ctxOf(DEMO.users.admin);
  const controller = ctxOf(DEMO.users.controller);
  await rawPrisma.organisation.update({ where: { id: orgId }, data: { billingAddress: PORTAL_DEMO.billingAddress } });

  // Buyer bank accounts
  const operating = await addBankAccount(admin, { nickname: "Operating account", holderName: "Harbor & Pine Manufacturing Inc.", bankName: "Pacific Commerce Bank", routingNumber: "123000848", accountNumber: "000123456789", isDefault: true });
  await addBankAccount(admin, { nickname: "Supplier payments", holderName: "Harbor & Pine Manufacturing Inc.", bankName: "Columbia Business Bank", routingNumber: "121000358", accountNumber: "550099887766" });

  // Two connected suppliers
  const connect = async (key: "main" | "second", acceptedDaysAgo: number) => {
    const s = PORTAL_DEMO.suppliers[key];
    const vendor = await db.vendor.findFirstOrThrow({ where: { code: s.vendorCode } });
    const sealed = sealBankAccount(s.bank.routing, s.bank.account);
    const account = await rawPrisma.vendorAccount.create({
      data: {
        legalName: `${vendor.name} LLC`, taxId: key === "main" ? "84-2210937" : "47-1188203", email: s.email, phone: key === "main" ? "(503) 555-0142" : "(206) 555-0187",
        addressLine1: key === "main" ? "1180 Industrial Way" : "92 Harbor Loop", city: key === "main" ? "Tacoma" : "Seattle", region: "WA", postalCode: key === "main" ? "98421" : "98121",
        users: { create: { id: s.userId, email: s.email, name: s.name, passwordHash: hashPassword(DEMO.password), role: "owner" } },
        bankAccounts: { create: { holderName: `${vendor.name} LLC`, bankName: s.bank.bankName, ...sealed } },
      },
      include: { bankAccounts: true },
    });
    const acceptedAt = new Date(now.getTime() - acceptedDaysAgo * DAY);
    const conn = await db.vendorConnection.create({
      data: {
        organisationId: orgId, vendorId: vendor.id, vendorAccountId: account.id, status: "active", inviteEmail: s.email,
        invitedById: DEMO.users.controller.id, invitedAt: new Date(acceptedAt.getTime() - 2 * DAY), acceptedAt, bankAccountId: account.bankAccounts[0].id, paymentTermsDays: 30,
      },
    });
    // Onboarding: the buyer verified these details when the supplier joined, so the vendor record matches.
    await db.vendor.update({ where: { id: vendor.id }, data: { bankFingerprint: sealed.fingerprint } });
    const vctx: VendorCtx = { vendorAccountId: account.id, accountName: account.legalName, user: { id: s.userId, name: s.name, email: s.email, role: "owner" } };
    return { vendor, account, conn, vctx };
  };
  const main = await connect("main", 40);
  const second = await connect("second", 25);

  // Fresh purchase orders and deliveries for the main supplier
  const po = async (n: string, qty: number, unit: bigint, received: number | null, daysAgo: number) => {
    await db.purchaseOrder.create({ data: { organisationId: orgId, poNumber: n, vendorCode: main.vendor.code, amountMinor: unit * BigInt(qty), currency: "USD", quantity: qty, unitPriceMinor: unit, createdAt: new Date(now.getTime() - daysAgo * DAY) } });
    if (received !== null) await db.goodsReceipt.create({ data: { organisationId: orgId, grnNumber: n.replace("PO", "GRN"), poNumber: n, quantityReceived: received, receivedAt: new Date(now.getTime() - (daysAgo - 4) * DAY) } });
  };
  await po("PO-90001", 40, 8_500n, 40, 30);
  await po("PO-90002", 120, 6_250n, 80, 14);
  await po("PO-90003", 10, 120_000n, 10, 6);
  await po("PO-90004", 25, 4_000n, null, 3);
  await po("PO-90005", 200, 1_850n, 200, 5);

  const at = (daysAgo: number, hour = 10) => new Date(Math.floor((now.getTime() - daysAgo * DAY) / DAY) * DAY + hour * 3600_000);
  const draft = (number: string, poNumber: string | undefined, daysAgo: number, lines: { description: string; quantity: number; unitPriceMinor: number; taxRateBps?: number }[], notes?: string) =>
    createDraft(main.vctx, { connectionId: main.conn.id, invoiceNumber: number, invoiceDate: d10(at(daysAgo)), poNumber, lines, notes }, { now: at(daysAgo, 9) });
  const desc = `${main.vendor.category}`;

  // 1. Paid three weeks after sending
  const i1 = await draft("BP-1001", "PO-90001", 28, [{ description: `${desc}, 40 units as ordered`, quantity: 40, unitPriceMinor: 8_500 }]);
  await submitInvoice(main.vctx, i1.id, { now: at(28, 11) });
  // 2. Approved and scheduled
  const i2 = await draft("BP-1002", "PO-90002", 9, [{ description: `${desc}, first delivery (60 of 120 units)`, quantity: 60, unitPriceMinor: 6_250 }]);
  await submitInvoice(main.vctx, i2.id, { now: at(9, 14) });
  // 3. Large invoice waiting for a controller
  const i3 = await draft("BP-1003", "PO-90003", 1, [{ description: `${desc}, 10 units, installed`, quantity: 10, unitPriceMinor: 120_000 }], "Installation completed on site; sign-off attached to delivery note.");
  await submitInvoice(main.vctx, i3.id, { now: at(1, 10) });
  // 4. Sent without a PO, sent back for changes
  const i4 = await draft("BP-0998", undefined, 6, [{ description: "Rush freight surcharge", quantity: 1, unitPriceMinor: 64_000 }]);
  await submitInvoice(main.vctx, i4.id, { now: at(6, 16) });
  // 5. A draft waiting to be sent (no delivery recorded yet)
  await draft("BP-1004", "PO-90004", 0, [{ description: `${desc}, 25 units`, quantity: 25, unitPriceMinor: 4_000 }]);

  // Buyer actions on those invoices
  const invById = (id: string) => db.invoice.findFirstOrThrow({ where: { id } });
  for (const id of [i1.id, i2.id]) {
    const inv = await invById(id);
    if (inv.status === "under_review") await decidePortalInvoice(controller, id, { decision: "approve", reason: "Matches the PO and the goods received note" });
  }
  await schedulePayment(controller, i1.id, { payFromAccountId: operating.id, payOn: d10(now) });
  await markInvoicePaid(controller, i1.id, { paidOn: d10(at(7)), reference: "ACH-55102" });
  await schedulePayment(controller, i2.id, { payFromAccountId: operating.id, payOn: d10(new Date(now.getTime() + 2 * DAY)) });
  const i4now = await invById(i4.id);
  if (i4now.status === "under_review") {
    await decidePortalInvoice(controller, i4.id, { decision: "send_back", reason: "No purchase order; freight should be billed against the PO", messageToSupplier: "Please add the PO number this freight relates to (it should be PO-90002) and send it again." });
  }
  // Make the supplier-facing timeline read naturally for invoice 1
  const ev1 = await db.invoiceEvent.findMany({ where: { invoiceId: i1.id }, orderBy: { createdAt: "asc" } });
  const sched = ev1.find((e) => e.status === "scheduled");
  const paid = ev1.find((e) => e.status === "paid");
  if (sched) await db.invoiceEvent.update({ where: { id: sched.id }, data: { createdAt: at(10, 15) } });
  if (paid) await db.invoiceEvent.update({ where: { id: paid.id }, data: { createdAt: at(7, 9) } });
  await db.invoice.update({ where: { id: i1.id }, data: { scheduledFor: at(7, 0) } });

  // Second supplier asks to change bank details (waiting for the buyer)
  await requestBankChange(second.vctx, {
    holderName: `${second.vendor.name} LLC`, bankName: "Evergreen Federal Credit Union", routingNumber: "123000848", accountNumber: "991200457781",
    confirmAccountNumber: "991200457781", password: DEMO.password,
  });

  // An invitation waiting to be accepted (fixed token so the demo link always works)
  const invited = await db.vendor.findFirstOrThrow({ where: { code: PORTAL_DEMO.invite.vendorCode } });
  await db.vendorConnection.create({
    data: {
      organisationId: orgId, vendorId: invited.id, status: "invited", inviteEmail: PORTAL_DEMO.invite.email,
      inviteTokenHash: hashToken(PORTAL_DEMO.invite.token), inviteExpiresAt: new Date(now.getTime() + 14 * DAY), invitedById: DEMO.users.controller.id,
    },
  });

  return {
    suppliers: 2, supplierInvoices: await db.invoice.count(), buyerBankAccounts: 2,
    pendingBankChanges: await db.bankDetailChange.count({ where: { status: "pending" } }),
  };
}
