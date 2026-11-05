import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { markInvoicePaid } from "@/server/portal/buyer-invoices";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => json(await markInvoicePaid(await requireCtx(req, "payments:manage"), id, await readJson(req))));
