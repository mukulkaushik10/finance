import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { setConnectionSuspended } from "@/server/portal/suppliers";

export const dynamic = "force-dynamic";

export const PATCH = route<{ id: string }>(async (req, { id }) => json(await setConnectionSuspended(await requireCtx(req, "suppliers:manage"), id, await readJson(req))));
