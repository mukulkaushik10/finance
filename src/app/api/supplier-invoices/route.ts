import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { listPortalInvoices } from "@/server/portal/buyer-invoices";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const sp = new URL(req.url).searchParams;
  return json({ invoices: await listPortalInvoices(await requireCtx(req, "suppliers:view"), { status: sp.get("status") ?? undefined, q: sp.get("q") ?? undefined }) });
});
