import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { suggestFromPurchaseOrder } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

/** A suggested invoice for what's been delivered against this PO (not saved). */
export const GET = route<{ id: string; po: string }>(async (req, { id, po }) => json({ draft: await suggestFromPurchaseOrder(await requireVendorCtx(req), id, decodeURIComponent(po)) }));
