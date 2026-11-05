import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listBankChanges } from "@/server/portal/suppliers";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ changes: await listBankChanges(await requireCtx(req, "suppliers:view"), { status: new URL(req.url).searchParams.get("status") === "all" ? "all" : "pending" }) }));
