import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { createUser, listUsers } from "@/server/settings/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ users: await listUsers(await requireCtx(req, "settings:view")) }));
export const POST = route(async (req) => json({ user: await createUser(await requireCtx(req, "settings:edit"), await readJson(req)) }, 201));
