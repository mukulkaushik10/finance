import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listVendors } from "@/server/settings/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "settings:view");
  return json({ vendors: await listVendors(ctx, new URL(req.url).searchParams.get("q") ?? undefined) });
});
