import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { listOpenPurchaseOrders } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => json({ purchaseOrders: await listOpenPurchaseOrders(await requireVendorCtx(req), id) }));
