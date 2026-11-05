import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { decidePortalInvoice } from "@/server/portal/buyer-invoices";

export const dynamic = "force-dynamic";

/** Approve, send back for changes, or reject a supplier invoice. */
export const POST = route<{ id: string }>(async (req, { id }) => json(await decidePortalInvoice(await requireCtx(req, "actions:review"), id, await readJson(req))));
