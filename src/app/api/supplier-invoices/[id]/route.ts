import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { getPortalInvoice } from "@/server/portal/buyer-invoices";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const inv = await getPortalInvoice(await requireCtx(req, "suppliers:view"), id);
  const { connection, ...rest } = inv;
  return json({ invoice: { ...rest, payTo: connection.bankAccount ? { bankName: connection.bankAccount.bankName, accountLast4: connection.bankAccount.accountLast4 } : null } });
});
