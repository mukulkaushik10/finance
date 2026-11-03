import { createSessionToken, SESSION_COOKIE, type Ctx } from "@/server/auth/session";
import { DEMO } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import type { EvaluateRequest } from "@/server/gate/schemas";

type RouteFn = (req: Request, ctx: { params: Promise<any> }) => Promise<Response>;

export async function call(
  fn: RouteFn,
  opts: { method?: string; path?: string; body?: unknown; user?: keyof typeof DEMO.users | null; apiKey?: string; headers?: Record<string, string>; params?: Record<string, string>; rawBody?: BodyInit } = {},
) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.user) headers.cookie = `${SESSION_COOKIE}=${await createSessionToken(DEMO.users[opts.user].id)}`;
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  let body: BodyInit | undefined = opts.rawBody;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const req = new Request(`http://localhost${opts.path ?? "/"}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  const res = await fn(req, { params: Promise.resolve(opts.params ?? {}) });
  const text = await res.text();
  let data: any = text;
  try { data = JSON.parse(text); } catch { /* binary or text */ }
  return { status: res.status, data, headers: res.headers };
}

export function ctxFor(user: keyof typeof DEMO.users): Ctx {
  const u = DEMO.users[user];
  return { organisationId: DEMO.orgId, user: { id: u.id, name: u.name, email: u.email, role: u.role } };
}

/** A clean invoice built from real seeded PO/GRN data, so every rule passes. */
export async function cleanInvoice(over: { amountMinor?: number; invoiceId?: string } = {}) {
  const db = forOrg(DEMO.orgId);
  const vendor = await db.vendor.findFirstOrThrow({ where: { blocked: false, bankChangedAt: null }, orderBy: { code: "asc" } });
  const po = await db.purchaseOrder.create({
    data: {
      organisationId: DEMO.orgId, poNumber: `PO-T${Math.floor(Math.random() * 1e9)}`, vendorCode: vendor.code,
      amountMinor: BigInt(over.amountMinor ?? 120_000), currency: "USD", quantity: 1, unitPriceMinor: BigInt(over.amountMinor ?? 120_000),
    },
  });
  const grn = await db.goodsReceipt.create({
    data: { organisationId: DEMO.orgId, grnNumber: `GRN-${po.poNumber}`, poNumber: po.poNumber, quantityReceived: 1, receivedAt: new Date() },
  });
  const id = over.invoiceId ?? `T-${Math.floor(Math.random() * 1e9)}`;
  const body: EvaluateRequest = {
    workflow_id: DEMO.workflowId,
    agent_version: "2.3.0",
    proposed: { decision: "approve", gl_code: vendor.defaultGlCode, reason: "Matches PO and goods received", confidence: 0.95 },
    subject: {
      type: "invoice", invoice_id: id, invoice_number: id, vendor_id: vendor.code, vendor_name: vendor.name,
      amount: { minor: Number(po.amountMinor), currency: "USD" }, po_number: po.poNumber, grn_number: grn.grnNumber,
      invoice_date: new Date().toISOString().slice(0, 10), bank_account: { fingerprint: vendor.bankFingerprint },
    },
  };
  return { body, vendor, po };
}
