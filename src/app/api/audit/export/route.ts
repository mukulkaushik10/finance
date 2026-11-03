import { requireCtx } from "@/server/auth/session";
import { route } from "@/server/http";
import { buildEvidencePack } from "@/server/audit/evidence";

export const dynamic = "force-dynamic";

/** Evidence pack (ZIP): ?actionId=…  or  ?from=YYYY-MM-DD&to=YYYY-MM-DD[&vendor=…] */
export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "audit:export");
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const scope = sp.actionId ? { actionId: sp.actionId } : { from: sp.from, to: sp.to, ...(sp.vendor ? { vendor: sp.vendor } : {}) };
  const pack = await buildEvidencePack(ctx, scope);
  return new Response(pack.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${pack.filename}"`,
      "cache-control": "no-store",
    },
  });
});
