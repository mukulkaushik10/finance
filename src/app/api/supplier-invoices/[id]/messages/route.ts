import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { postBuyerMessage } from "@/server/portal/buyer-invoices";

export const dynamic = "force-dynamic";

export const POST = route<{ id: string }>(async (req, { id }) => json({ message: await postBuyerMessage(await requireCtx(req), id, await readJson(req)) }, 201));
