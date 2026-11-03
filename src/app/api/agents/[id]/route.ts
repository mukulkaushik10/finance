import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateAgent } from "@/server/settings/service";

export const dynamic = "force-dynamic";

/** Update an agent; `rotateKey: true` issues a new API key (returned once). */
export const PATCH = route<{ id: string }>(async (req, { id }) => json(await updateAgent(await requireCtx(req, "settings:edit"), id, await readJson(req))));
