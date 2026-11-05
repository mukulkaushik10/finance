import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { listBuyers } from "@/server/portal/profile";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ buyers: await listBuyers(await requireVendorCtx(req)) }));
