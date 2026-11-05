import { requireVendorCtx } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";
import { listSupplierBankAccounts, requestBankChange } from "@/server/portal/profile";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ accounts: await listSupplierBankAccounts(await requireVendorCtx(req)) }));

/** Ask your buyers to pay you into a new account. Each buyer must approve before it's used. */
export const POST = route(async (req) => json(await requestBankChange(await requireVendorCtx(req), await readJson(req)), 201));
