import { requireVendorCtx } from "@/server/portal/session";
import { json, route } from "@/server/http";
import { checkBeforeSending } from "@/server/portal/invoices";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => json({ checks: await checkBeforeSending(await requireVendorCtx(req), id) }));
