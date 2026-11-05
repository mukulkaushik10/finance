import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { getSupplierHome } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json(await getSupplierHome(await requireVendorCtx(req))));
