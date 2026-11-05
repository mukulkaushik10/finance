import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateBankAccount } from "@/server/banking/service";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (req, { id }) => json({ account: await updateBankAccount(await requireCtx(req, "settings:edit"), id, await readJson(req)) }));
