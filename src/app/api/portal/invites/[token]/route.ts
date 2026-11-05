import { getInvitePreview } from "@/server/portal/auth";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ token: string }>(async (_req, { token }) => json({ invite: await getInvitePreview(token) }));
