import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateUser } from "@/server/settings/service";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (req, { id }) => json({ user: await updateUser(await requireCtx(req, "settings:edit"), id, await readJson(req)) }));
