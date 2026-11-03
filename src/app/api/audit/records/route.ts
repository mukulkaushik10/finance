import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listAuditRecords } from "@/server/audit/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "audit:view");
  return json(await listAuditRecords(ctx, Object.fromEntries(new URL(req.url).searchParams)));
});
