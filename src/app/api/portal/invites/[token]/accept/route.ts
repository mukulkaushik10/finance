import { acceptInviteExisting, acceptInviteNew } from "@/server/portal/auth";
import { requireVendorCtx, vendorSessionCookieHeader } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** Accept an invitation: create a supplier account, or (when signed in) connect your existing account. */
export const POST = route<{ token: string }>(async (req, { token }) => {
  const body = (await readJson(req)) as { existing?: boolean } | null;
  if (body?.existing) return json(await acceptInviteExisting(await requireVendorCtx(req), token));
  const { token: session, accountId } = await acceptInviteNew(token, body);
  return json({ accountId }, 201, { "set-cookie": vendorSessionCookieHeader(session) });
});
