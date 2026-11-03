import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { setErpConnector } from "@/server/settings/service";

export const dynamic = "force-dynamic";

/** Choose the system of record (mock QuickBooks / Xero / NetSuite in the MVP). */
export const PUT = route<{ id: string }>(async (req, { id }) => json({ workflow: await setErpConnector(await requireCtx(req, "settings:edit"), id, await readJson(req)) }));
