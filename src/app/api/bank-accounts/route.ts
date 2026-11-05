import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { addBankAccount, listBankAccounts } from "@/server/banking/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ accounts: await listBankAccounts(await requireCtx(req), { includeArchived: new URL(req.url).searchParams.get("archived") === "1" }) }));

/** Add one of your organisation's bank accounts (admin). The account number is stored encrypted. */
export const POST = route(async (req) => json({ account: await addBankAccount(await requireCtx(req, "settings:edit"), await readJson(req)) }, 201));
