import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { verifyOrgChain } from "@/server/audit/service";

export const dynamic = "force-dynamic";

/** Recompute every audit record's fingerprint and check each link in the chain. */
export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "audit:view");
  return json(await verifyOrgChain(ctx));
});
