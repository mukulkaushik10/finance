import { requireVendorCtx } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";
import { cancelInvoice, getSupplierInvoice, updateDraft } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => json({ invoice: await getSupplierInvoice(await requireVendorCtx(req), id) }));
export const PATCH = route<{ id: string }>(async (req, { id }) => json({ invoice: await updateDraft(await requireVendorCtx(req), id, await readJson(req)) }));
export const DELETE = route<{ id: string }>(async (req, { id }) => json(await cancelInvoice(await requireVendorCtx(req), id)));
