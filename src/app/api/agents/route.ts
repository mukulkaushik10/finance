import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { createAgent, listAgents } from "@/server/settings/service";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ agents: await listAgents(await requireCtx(req, "settings:view")) }));

/** Connect an agent. The response contains the API key and signing secret: shown once only. */
export const POST = route(async (req) => json(await createAgent(await requireCtx(req, "settings:edit"), await readJson(req)), 201));
