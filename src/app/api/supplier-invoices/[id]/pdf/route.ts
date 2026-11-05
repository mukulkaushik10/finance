import { requireCtx } from "@/server/auth/session";
import { route } from "@/server/http";
import { buyerInvoicePdf } from "@/server/portal/pdf-data";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const { bytes, filename } = await buyerInvoicePdf(await requireCtx(req, "suppliers:view"), id);
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"` } });
});
