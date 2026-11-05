import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listSupplierConnections } from "@/server/portal/suppliers";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ suppliers: await listSupplierConnections(await requireCtx(req, "suppliers:view")) }));
