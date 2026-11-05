import { requireVendorCtx } from "@/server/portal/session";
import { route } from "@/server/http";
import { supplierInvoicePdf } from "@/server/portal/pdf-data";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const { bytes, filename } = await supplierInvoicePdf(await requireVendorCtx(req), id);
  return new Response(Buffer.from(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${filename}"` } });
});
