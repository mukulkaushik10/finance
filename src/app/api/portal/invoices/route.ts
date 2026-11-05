import { requireVendorCtx } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";
import { createDraft, listSupplierInvoices } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  return json({ invoices: await listSupplierInvoices(await requireVendorCtx(req), { status: sp.get("status") ?? undefined, connectionId: sp.get("buyer") ?? undefined }) });
});

/** Save a draft invoice or credit note. Nothing is sent until you submit it. */
export const POST = route(async (req) => json({ invoice: await createDraft(await requireVendorCtx(req), await readJson(req)) }, 201));
