import { beforeAll, describe, expect, it } from "vitest";
import { GET as listBank, POST as addBank } from "@/app/api/bank-accounts/route";
import { PATCH as patchBank } from "@/app/api/bank-accounts/[id]/route";
import { GET as listSuppliers } from "@/app/api/suppliers/route";
import { POST as invite } from "@/app/api/suppliers/invite/route";
import { GET as listChanges } from "@/app/api/bank-changes/route";
import { POST as decideChange } from "@/app/api/bank-changes/[id]/decision/route";
import { GET as buyerList } from "@/app/api/supplier-invoices/route";
import { GET as buyerGet } from "@/app/api/supplier-invoices/[id]/route";
import { POST as buyerDecide } from "@/app/api/supplier-invoices/[id]/decision/route";
import { POST as buyerSchedule } from "@/app/api/supplier-invoices/[id]/schedule/route";
import { POST as buyerPaid } from "@/app/api/supplier-invoices/[id]/paid/route";
import { POST as buyerMessage } from "@/app/api/supplier-invoices/[id]/messages/route";
import { GET as buyerPdf } from "@/app/api/supplier-invoices/[id]/pdf/route";
import { POST as review } from "@/app/api/actions/[id]/review/route";
import { POST as vLogin } from "@/app/api/portal/auth/login/route";
import { GET as invitePreview } from "@/app/api/portal/invites/[token]/route";
import { POST as acceptInvite } from "@/app/api/portal/invites/[token]/accept/route";
import { GET as vHome } from "@/app/api/portal/home/route";
import { GET as vBuyers } from "@/app/api/portal/buyers/route";
import { GET as vPos } from "@/app/api/portal/buyers/[id]/purchase-orders/route";
import { GET as vSuggest } from "@/app/api/portal/buyers/[id]/purchase-orders/[po]/draft/route";
import { POST as vBank } from "@/app/api/portal/bank-accounts/route";
import { GET as vList, POST as vCreate } from "@/app/api/portal/invoices/route";
import { DELETE as vCancel, GET as vGet, PATCH as vPatch } from "@/app/api/portal/invoices/[id]/route";
import { GET as vChecks } from "@/app/api/portal/invoices/[id]/checks/route";
import { POST as vSubmit } from "@/app/api/portal/invoices/[id]/submit/route";
import { POST as vMessage } from "@/app/api/portal/invoices/[id]/messages/route";
import { GET as vPdf } from "@/app/api/portal/invoices/[id]/pdf/route";
import { GET as staffActions } from "@/app/api/actions/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { PORTAL_DEMO, seedPortal } from "@/server/seed/portal";
import { forOrg } from "@/server/db/dal";
import { forVendor } from "@/server/db/vendor-dal";
import { createSessionToken, SESSION_COOKIE } from "@/server/auth/session";
import { createVendorSessionToken, VENDOR_SESSION_COOKIE } from "@/server/portal/session";
import { verifyChain } from "@/server/audit/chain";
import { bankFingerprint, decryptSecret, encryptSecret, isValidRoutingNumber } from "@/server/crypto/secrets";
import { computeTotals } from "@/server/portal/invoices";
import { call } from "../helpers/api";

const db = forOrg(DEMO.orgId);
const S = PORTAL_DEMO.suppliers;
const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

let priya = "";   // supplier cookie (main supplier)
let marco = "";   // supplier cookie (second supplier)
let mainConn = "";
let secondConn = "";
let operatingId = "";

const vcookie = async (userId: string) => `${VENDOR_SESSION_COOKIE}=${await createVendorSessionToken(userId)}`;
const as = (cookie: string) => ({ headers: { cookie } });

async function newDraft(cookie: string, connectionId: string, over: Record<string, unknown> = {}) {
  const res = await call(vCreate, {
    ...as(cookie),
    body: { connectionId, invoiceNumber: `T-${Math.floor(Math.random() * 1e9)}`, invoiceDate: today(), poNumber: "PO-90005", lines: [{ description: "Widgets", quantity: 10, unitPriceMinor: 1_850 }], ...over },
  });
  expect(res.status, JSON.stringify(res.data)).toBe(201);
  return res.data.invoice.id as string;
}

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed", level: 2 });
  await seedPortal();
  priya = await vcookie(S.main.userId);
  marco = await vcookie(S.second.userId);
  const buyers = await call(vBuyers, as(priya));
  mainConn = buyers.data.buyers[0].connectionId;
  secondConn = (await call(vBuyers, as(marco))).data.buyers[0].connectionId;
  operatingId = (await call(listBank, { user: "controller" })).data.accounts.find((a: { isDefault: boolean }) => a.isDefault).id;
});

describe("bank account helpers", () => {
  it("validates US routing numbers, encrypts account numbers and fingerprints them stably", () => {
    expect(isValidRoutingNumber("021000021")).toBe(true);
    expect(isValidRoutingNumber("021000022")).toBe(false);
    expect(isValidRoutingNumber("12345")).toBe(false);
    const sealed = encryptSecret("000123456789");
    expect(sealed).not.toContain("123456789");
    expect(decryptSecret(sealed)).toBe("000123456789");
    expect(bankFingerprint("021000021", "12-34 56")).toBe(bankFingerprint("021000021", "123456"));
    expect(bankFingerprint("021000021", "123456")).toMatch(/^sha256:[0-9a-f]{32}$/);
  });

  it("computes line amounts and tax in cents, rounding half up", () => {
    const t = computeTotals([{ description: "a", quantity: 3, unitPriceMinor: 333, taxRateBps: 825 }, { description: "b", quantity: 1, unitPriceMinor: 1000, taxRateBps: 0 }]);
    expect(t.subtotalMinor).toBe(1999n);
    expect(t.taxMinor).toBe(82n); // 999 * 8.25% = 82.42 cents
    expect(t.totalMinor).toBe(2081n);
  });
});

describe("buyer bank accounts", () => {
  it("admins add accounts; responses never include the full account number", async () => {
    const res = await call(addBank, { user: "admin", body: { nickname: "Payroll", holderName: "Harbor & Pine", bankName: "Pacific Commerce Bank", routingNumber: "021000021", accountNumber: "9988776655" } });
    expect(res.status).toBe(201);
    expect(res.data.account.accountLast4).toBe("6655");
    expect(JSON.stringify(res.data)).not.toContain("9988776655");
    const stored = await db.organisationBankAccount.findFirstOrThrow({ where: { id: res.data.account.id } });
    expect(stored.accountNumberEnc).not.toContain("9988776655");
    expect(decryptSecret(stored.accountNumberEnc)).toBe("9988776655");
    const list = await call(listBank, { user: "controller" });
    expect(JSON.stringify(list.data)).not.toContain("accountNumberEnc");
  });

  it("controllers can't add accounts, bad routing numbers are refused, and duplicates are caught", async () => {
    expect((await call(addBank, { user: "controller", body: { nickname: "X", holderName: "X Co", bankName: "Bank", routingNumber: "021000021", accountNumber: "11112222" } })).status).toBe(403);
    const bad = await call(addBank, { user: "admin", body: { nickname: "X", holderName: "X Co", bankName: "Bank", routingNumber: "021000022", accountNumber: "11112222" } });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.data)).toContain("routing number");
    const dup = await call(addBank, { user: "admin", body: { nickname: "Again", holderName: "Harbor", bankName: "Pacific Commerce Bank", routingNumber: "123000848", accountNumber: "000123456789" } });
    expect(dup.status).toBe(409);
  });

  it("the default account can't be archived, and changes are audited", async () => {
    const res = await call(patchBank, { user: "admin", params: { id: operatingId }, body: { archived: true, reason: "Closing this account" } });
    expect(res.status).toBe(400);
    const n = await db.auditRecord.count({ where: { eventType: { in: ["bank_account.added", "bank_account.changed"] } } });
    expect(n).toBeGreaterThanOrEqual(3);
  });
});

describe("supplier sessions and data separation", () => {
  it("a supplier token can't open staff APIs, and a staff token can't open supplier APIs", async () => {
    expect((await call(staffActions, as(priya))).status).toBe(401);
    const staff = `${SESSION_COOKIE}=${await createSessionToken(DEMO.users.admin.id)}`;
    expect((await call(vList, as(staff))).status).toBe(401);
    // Even with the supplier token placed in the staff cookie name:
    const swapped = `${SESSION_COOKIE}=${await createVendorSessionToken(S.main.userId)}`;
    expect((await call(staffActions, as(swapped))).status).toBe(401);
  });

  it("forVendor refuses buyer-only data and other suppliers' rows; forOrg refuses supplier-only tables", async () => {
    const v = forVendor("some-supplier");
    await expect(v.action.findMany()).rejects.toThrow(/can't access Action/);
    await expect(v.invoice.findMany({ where: { vendorAccountId: "another" } })).rejects.toThrow(/Cross-supplier/);
    await expect(db.vendorAccount.findMany()).rejects.toThrow(/belongs to a supplier account/);
  });

  it("one supplier can't read another supplier's invoice", async () => {
    const mine = (await call(vList, as(priya))).data.invoices[0].id;
    expect((await call(vGet, { ...as(marco), params: { id: mine } })).status).toBe(404);
    expect((await call(vPdf, { ...as(marco), params: { id: mine } })).status).toBe(404);
    expect((await call(vPos, { ...as(marco), params: { id: mainConn } })).status).toBe(404);
  });

  it("signs in with email and password", async () => {
    const ok = await call(vLogin, { body: { email: S.main.email, password: DEMO.password } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("set-cookie")).toContain(VENDOR_SESSION_COOKIE);
    expect((await call(vLogin, { body: { email: S.main.email, password: "nope" } })).status).toBe(401);
  });
});

describe("invitations", () => {
  it("a buyer invites a vendor; the supplier accepts and their account is connected", async () => {
    const vendor = await db.vendor.findFirstOrThrow({ where: { code: "V-0011" } });
    const inv = await call(invite, { user: "controller", body: { vendorId: vendor.id, email: "Owner@Fresh.example", paymentTermsDays: 45 } });
    expect(inv.status).toBe(201);
    const token = inv.data.inviteUrl.split("/portal/invite/")[1];
    const stored = await db.vendorConnection.findFirstOrThrow({ where: { vendorId: vendor.id } });
    expect(stored.inviteTokenHash).not.toBe(token); // only the hash is stored

    const preview = await call(invitePreview, { params: { token } });
    expect(preview.data.invite).toMatchObject({ buyerName: "Harbor & Pine Manufacturing", email: "owner@fresh.example", hasAccount: false, paymentTermsDays: 45 });

    const acc = await call(acceptInvite, { params: { token }, body: { name: "Olu Owner", password: "longpassword", legalName: `${vendor.name} Inc.`, taxId: "123456789" } });
    expect(acc.status, JSON.stringify(acc.data)).toBe(201);
    expect(acc.headers.get("set-cookie")).toContain(VENDOR_SESSION_COOKIE);
    const conn = await db.vendorConnection.findFirstOrThrow({ where: { vendorId: vendor.id }, include: { vendorAccount: true } });
    expect(conn.status).toBe("active");
    expect(conn.inviteTokenHash).toBeNull();
    expect(conn.vendorAccount?.taxId).toBe("12-3456789");
    expect(await db.auditRecord.count({ where: { eventType: { in: ["supplier.invited", "supplier.connected"] }, entityId: vendor.id } })).toBe(2);

    // The link can't be used twice, and an already-connected vendor can't be invited again.
    expect((await call(invitePreview, { params: { token } })).status).toBe(404);
    expect((await call(invite, { user: "controller", body: { vendorId: vendor.id, email: "x@y.example" } })).status).toBe(409);
  });

  it("reviewers and auditors can't invite; blocked vendors can't be invited", async () => {
    const blocked = await db.vendor.findFirstOrThrow({ where: { blocked: true } });
    expect((await call(invite, { user: "auditor", body: { vendorId: blocked.id, email: "a@b.example" } })).status).toBe(403);
    const res = await call(invite, { user: "controller", body: { vendorId: blocked.id, email: "a@b.example" } });
    expect(res.status).toBe(400);
  });

  it("lists connected and invited suppliers for the buyer", async () => {
    const res = await call(listSuppliers, { user: "auditor" });
    const statuses = res.data.suppliers.map((s: { status: string }) => s.status);
    expect(statuses).toContain("active");
    expect(statuses).toContain("invited");
  });
});

describe("creating and sending invoices", () => {
  it("lists open POs with deliveries, and suggests a draft from one", async () => {
    const pos = (await call(vPos, { ...as(priya), params: { id: mainConn } })).data.purchaseOrders;
    const p2 = pos.find((p: { poNumber: string }) => p.poNumber === "PO-90002");
    expect(p2).toMatchObject({ quantity: 120, quantityReceived: 80, quantityBilled: 60 });
    expect(pos.find((p: { poNumber: string }) => p.poNumber === "PO-90001")).toBeUndefined(); // billed in full
    const s = await call(vSuggest, { ...as(priya), params: { id: mainConn, po: "PO-90002" } });
    expect(s.data.draft.lines[0]).toMatchObject({ quantity: 20, unitPriceMinor: 6_250 }); // 80 delivered - 60 billed
  });

  it("a small clean invoice is approved automatically and the supplier sees it as Approved", async () => {
    await db.purchaseOrder.create({ data: { organisationId: DEMO.orgId, poNumber: "PO-T-SMALL", vendorCode: S.main.vendorCode, amountMinor: 18_500n, currency: "USD", quantity: 10, unitPriceMinor: 1_850n } });
    await db.goodsReceipt.create({ data: { organisationId: DEMO.orgId, grnNumber: "GRN-T-SMALL", poNumber: "PO-T-SMALL", quantityReceived: 10, receivedAt: new Date() } });
    const id = await newDraft(priya, mainConn, { poNumber: "PO-T-SMALL" });
    const checks = (await call(vChecks, { ...as(priya), params: { id } })).data.checks;
    expect(checks.filter((c: { level: string }) => c.level === "error")).toEqual([]);
    const res = await call(vSubmit, { ...as(priya), params: { id } });
    expect(res.status, JSON.stringify(res.data)).toBe(200);
    expect(res.data.invoice.status).toBe("approved");
    const inv = await db.invoice.findFirstOrThrow({ where: { id } });
    const action = await db.action.findFirstOrThrow({ where: { id: inv.actionId! } });
    expect(action).toMatchObject({ status: "auto_approved", externalRef: id, counterpartyKey: S.main.vendorCode, amountMinor: 18_500n });
    // The supplier view never exposes the AI or the rules.
    const view = JSON.stringify((await call(vGet, { ...as(priya), params: { id } })).data);
    for (const secret of ["confidence", "ruleName", "gateOutcome", "agent", "Three-way", "actionId"]) expect(view).not.toContain(secret);
  });

  it("refuses a reused invoice number with a clear message", async () => {
    const num = `DUP-${Date.now()}`;
    await newDraft(priya, mainConn, { invoiceNumber: num });
    const again = await call(vCreate, { ...as(priya), body: { connectionId: mainConn, invoiceNumber: num, invoiceDate: today(), lines: [{ description: "x", quantity: 1, unitPriceMinor: 100 }] } });
    expect(again.status).toBe(409);
    expect(again.data.error.message).toContain("already used number");
  });

  it("warns about missing POs, over-billing and undelivered goods, and blocks future dates", async () => {
    const id = await newDraft(priya, mainConn, { poNumber: "PO-90004", lines: [{ description: "Widgets", quantity: 30, unitPriceMinor: 4_000 }] });
    const checks = (await call(vChecks, { ...as(priya), params: { id } })).data.checks.map((c: { level: string; message: string }) => `${c.level}: ${c.message}`).join("\n");
    expect(checks).toMatch(/warning: This is more than what's left on PO-90004/);
    expect(checks).toMatch(/warning: .*hasn't recorded a delivery for PO-90004/);
    const noPo = await newDraft(priya, mainConn, { poNumber: "" });
    expect(JSON.stringify((await call(vChecks, { ...as(priya), params: { id: noPo } })).data)).toContain("no purchase order number");
    const future = await newDraft(priya, mainConn, { invoiceDate: plusDays(10) });
    const res = await call(vSubmit, { ...as(priya), params: { id: future } });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toContain("in the future");
  });

  it("drafts can be edited and deleted; sent invoices can't be edited", async () => {
    const id = await newDraft(priya, mainConn);
    const upd = await call(vPatch, { ...as(priya), params: { id }, body: { invoiceNumber: "EDITED-1", invoiceDate: today(), lines: [{ description: "Two lines", quantity: 2, unitPriceMinor: 500, taxRateBps: 1000 }] } });
    expect(upd.status).toBe(200);
    expect(upd.data.invoice.totalMinor).toBe(1100);
    expect((await call(vCancel, { ...as(priya), params: { id } })).data).toEqual({ deleted: true });
    const sent = (await call(vList, { ...as(priya) })).data.invoices.find((i: { status: string }) => i.status === "paid").id;
    expect((await call(vPatch, { ...as(priya), params: { id: sent }, body: { invoiceNumber: "X", invoiceDate: today(), lines: [{ description: "x", quantity: 1, unitPriceMinor: 1 }] } })).status).toBe(409);
  });
});

describe("buyer decisions and payment", () => {
  it("a large invoice waits for a controller; approving records a review, then it can be scheduled and paid", async () => {
    await db.purchaseOrder.create({ data: { organisationId: DEMO.orgId, poNumber: "PO-T-BIG", vendorCode: S.main.vendorCode, amountMinor: 1_200_000n, currency: "USD", quantity: 10, unitPriceMinor: 120_000n } });
    await db.goodsReceipt.create({ data: { organisationId: DEMO.orgId, grnNumber: "GRN-T-BIG", poNumber: "PO-T-BIG", quantityReceived: 10, receivedAt: new Date() } });
    const id = await newDraft(priya, mainConn, { poNumber: "PO-T-BIG", lines: [{ description: "Press brake", quantity: 10, unitPriceMinor: 120_000 }], invoiceNumber: `BIG-${Date.now()}` });
    const sent = await call(vSubmit, { ...as(priya), params: { id } });
    expect(sent.data.invoice.status).toBe("under_review"); // $12,000 needs a controller
    const inv = await db.invoice.findFirstOrThrow({ where: { id } });
    const action = await db.action.findFirstOrThrow({ where: { id: inv.actionId! } });
    expect(action.status).toBe("pending_review");

    const listed = (await call(buyerList, { user: "controller", path: "/api/supplier-invoices?status=under_review" })).data.invoices.map((i: { id: string }) => i.id);
    expect(listed).toContain(id);

    const ok = await call(buyerDecide, { user: "controller", params: { id }, body: { decision: "approve", reason: "Goods received in full; checked with stores" } });
    expect(ok.status, JSON.stringify(ok.data)).toBe(200);
    expect(await db.review.count({ where: { actionId: action.id } })).toBe(1);

    expect((await call(buyerSchedule, { user: "auditor", params: { id }, body: { payFromAccountId: operatingId, payOn: plusDays(3) } })).status).toBe(403);
    const sch = await call(buyerSchedule, { user: "controller", params: { id }, body: { payFromAccountId: operatingId, payOn: plusDays(3) } });
    expect(sch.status, JSON.stringify(sch.data)).toBe(200);
    const paid = await call(buyerPaid, { user: "controller", params: { id }, body: { paidOn: plusDays(3), reference: "ACH-777" } });
    expect(paid.status).toBe(200);

    const view = (await call(vGet, { ...as(priya), params: { id } })).data.invoice;
    expect(view.status).toBe("paid");
    expect(view.events.map((e: { status: string }) => e.status), JSON.stringify(view.events)).toEqual(["draft", "submitted", "under_review", "approved", "scheduled", "paid"]);
    expect(view.events.at(-1).note).toContain("ACH-777");
    expect(await db.auditRecord.count({ where: { entityId: id, eventType: { in: ["invoice.submitted", "invoice.decided", "invoice.payment_scheduled", "invoice.paid"] } } })).toBe(4);
  });

  it("a reviewer can't approve above their limit", async () => {
    const big = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-1003" } });
    const reviewer = await db.user.create({ data: { organisationId: DEMO.orgId, email: "rev2@harborpine.example", name: "Riley", role: "reviewer", passwordHash: "x" } });
    const cookie = `${SESSION_COOKIE}=${await createSessionToken(reviewer.id)}`;
    const res = await call(buyerDecide, { ...as(cookie), params: { id: big.id }, body: { decision: "approve", reason: "Looks right to me" } });
    expect(res.status).toBe(403);
  });

  it("sending back lets the supplier fix and resend; the resubmission gets a fresh check", async () => {
    const back = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-0998" } });
    expect(back.status).toBe("needs_changes");
    const firstAction = back.actionId;
    const view = (await call(vGet, { ...as(priya), params: { id: back.id } })).data.invoice;
    expect(view.supplierNote).toContain("PO-90002");
    expect(view.messages[0]).toMatchObject({ authorType: "buyer" });

    await call(vMessage, { ...as(priya), params: { id: back.id }, body: { body: "Sorry, adding it now." } });
    const fix = await call(vPatch, { ...as(priya), params: { id: back.id }, body: { invoiceNumber: "BP-0998", invoiceDate: today(), poNumber: "PO-90002", lines: [{ description: "Rush freight surcharge", quantity: 1, unitPriceMinor: 64_000 }] } });
    expect(fix.status).toBe(200);
    const re = await call(vSubmit, { ...as(priya), params: { id: back.id } });
    expect(re.status).toBe(200);
    const after = await db.invoice.findFirstOrThrow({ where: { id: back.id } });
    expect(after.revision).toBe(2);
    expect(after.actionId).not.toBe(firstAction);
    expect(after.status).not.toBe("needs_changes");
    // The earlier attempt doesn't count as a duplicate of itself.
    const rr = await db.ruleResult.findMany({ where: { actionId: after.actionId!, ruleType: "duplicate_invoice" } });
    expect(rr[0].result).toBe("pass");
  });

  it("a decision made in the review queue updates the supplier's invoice", async () => {
    const id = await newDraft(priya, mainConn, { poNumber: "PO-90005", lines: [{ description: "Big", quantity: 10, unitPriceMinor: 99_000 }], invoiceNumber: `RQ-${Date.now()}` });
    await call(vSubmit, { ...as(priya), params: { id } });
    const inv = await db.invoice.findFirstOrThrow({ where: { id } });
    expect(inv.status).toBe("under_review");
    const res = await call(review, { user: "controller", params: { id: inv.actionId! }, body: { decision: "reject", reason: "Price doesn't match the PO at all" } });
    expect(res.status).toBe(201);
    const after = await db.invoice.findFirstOrThrow({ where: { id } });
    expect(after.status).toBe("needs_changes");
  });

  it("messages from the buyer reach the supplier; auditors can't post", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-1003" } });
    expect((await call(buyerMessage, { user: "auditor", params: { id: inv.id }, body: { body: "hi" } })).status).toBe(403);
    expect((await call(buyerMessage, { user: "controller", params: { id: inv.id }, body: { body: "We're checking the installation sign-off." } })).status).toBe(201);
    const v = (await call(vGet, { ...as(priya), params: { id: inv.id } })).data.invoice;
    expect(v.messages.at(-1)).toMatchObject({ authorType: "buyer", body: "We're checking the installation sign-off." });
  });

  it("credit notes go to a person, not the AI check", async () => {
    const paid = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-1001" } });
    const res = await call(vCreate, { ...as(priya), body: { connectionId: mainConn, kind: "credit_note", creditForInvoiceId: paid.id, invoiceNumber: "CN-1", invoiceDate: today(), lines: [{ description: "2 damaged units", quantity: 2, unitPriceMinor: 8_500 }] } });
    expect(res.status).toBe(201);
    const sent = await call(vSubmit, { ...as(priya), params: { id: res.data.invoice.id } });
    expect(sent.data.invoice.status).toBe("under_review");
    const cn = await db.invoice.findFirstOrThrow({ where: { id: res.data.invoice.id } });
    expect(cn.actionId).toBeNull();
    expect(cn.poNumber).toBe("PO-90001");
    const ok = await call(buyerDecide, { user: "controller", params: { id: cn.id }, body: { decision: "approve", reason: "Damage confirmed by warehouse" } });
    expect(ok.data.status).toBe("approved");
    expect((await call(buyerSchedule, { user: "controller", params: { id: cn.id }, body: { payFromAccountId: operatingId, payOn: today() } })).status).toBe(400);
  });

  it("renders a PDF for both sides", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-1003" } });
    const a = await call(vPdf, { ...as(priya), params: { id: inv.id } });
    const b = await call(buyerPdf, { user: "auditor", params: { id: inv.id } });
    expect(a.status).toBe(200);
    expect(String(a.data).startsWith("%PDF")).toBe(true);
    expect(b.headers.get("content-type")).toBe("application/pdf");
  });

  it("the buyer detail shows the AI check and rules; the supplier home sums what's owed", async () => {
    const inv = await db.invoice.findFirstOrThrow({ where: { invoiceNumber: "BP-1003" } });
    const d = (await call(buyerGet, { user: "controller", params: { id: inv.id } })).data.invoice;
    expect(d.action.status).toBe("pending_review");
    expect(d.action.ruleResults.length).toBeGreaterThan(3);
    expect(d.payTo.accountLast4).toBe("9876");
    const home = (await call(vHome, as(priya))).data;
    expect(home.outstandingCount).toBeGreaterThan(0);
    expect(home.paid90Count).toBeGreaterThanOrEqual(1);
    expect(home.avgDaysToPay).toBeGreaterThan(0);
  });
});

describe("bank detail changes", () => {
  it("needs the supplier's password, and a pending change blocks scheduling payments", async () => {
    const bad = await call(vBank, { ...as(priya), body: { holderName: "Priya R", bankName: "New Bank", routingNumber: "021000021", accountNumber: "123123123", confirmAccountNumber: "123123123", password: "wrong" } });
    expect(bad.status).toBe(400);
    const mismatch = await call(vBank, { ...as(priya), body: { holderName: "Priya R", bankName: "New Bank", routingNumber: "021000021", accountNumber: "123123123", confirmAccountNumber: "123123124", password: DEMO.password } });
    expect(mismatch.status).toBe(422);

    // Marco's pending change (seeded) blocks paying Marco until it's decided.
    const changes = (await call(listChanges, { user: "controller" })).data.changes;
    expect(changes).toHaveLength(1);
    expect(changes[0].newAccount.accountLast4).toBe("7781");
    expect(JSON.stringify(changes)).not.toContain("991200457781");
    const id = await newDraft(marco, secondConn, { poNumber: "" , lines: [{ description: "Service", quantity: 1, unitPriceMinor: 10_000 }] });
    await call(vSubmit, { ...as(marco), params: { id } });
    const inv = await db.invoice.findFirstOrThrow({ where: { id } });
    if (inv.status === "under_review") await call(buyerDecide, { user: "controller", params: { id }, body: { decision: "approve", reason: "Service delivered as agreed" } });
    const sch = await call(buyerSchedule, { user: "controller", params: { id }, body: { payFromAccountId: operatingId, payOn: today() } });
    expect(sch.status).toBe(409);
    expect(sch.data.error.message).toContain("bank detail change");
  });

  it("approving needs a verification note; it updates the vendor record and the next invoice goes to a person", async () => {
    const ch = (await call(listChanges, { user: "controller" })).data.changes[0];
    const noNote = await call(decideChange, { user: "controller", params: { id: ch.id }, body: { decision: "approve" } });
    expect(noNote.status).toBe(422);
    const ok = await call(decideChange, { user: "controller", params: { id: ch.id }, body: { decision: "approve", verification: "Called Marco on the number in our vendor file, confirmed new account" } });
    expect(ok.status).toBe(200);
    expect((await call(decideChange, { user: "controller", params: { id: ch.id }, body: { decision: "reject", note: "again" } })).status).toBe(409);

    const vendor = await db.vendor.findFirstOrThrow({ where: { code: S.second.vendorCode } });
    expect(vendor.bankFingerprint).toBe(bankFingerprint("123000848", "991200457781"));
    expect(vendor.bankChangedAt).not.toBeNull();

    const id = await newDraft(marco, secondConn, { poNumber: "", lines: [{ description: "Service", quantity: 1, unitPriceMinor: 5_000 }] });
    await call(vSubmit, { ...as(marco), params: { id } });
    const inv = await db.invoice.findFirstOrThrow({ where: { id } });
    expect(inv.bankFingerprint).toBe(vendor.bankFingerprint);
    const rr = await db.ruleResult.findFirstOrThrow({ where: { actionId: inv.actionId!, ruleType: "bank_details_change" } });
    expect(rr.result).toBe("fail"); // changed recently: a person checks the first payments
    expect(inv.status).toBe("under_review");
  });

  it("the audit chain still verifies after all portal activity", async () => {
    const v = await verifyChain(DEMO.orgId);
    expect(v.problems).toEqual([]);
    expect(v.ok).toBe(true);
  });
});
