import { requireVendorCtx } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";
import { postSupplierMessage } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => json({ message: await postSupplierMessage(await requireVendorCtx(req), id, await readJson(req)) }, 201));
