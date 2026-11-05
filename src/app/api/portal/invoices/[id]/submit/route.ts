import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { submitInvoice } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => json(await submitInvoice(await requireVendorCtx(req), id)));
