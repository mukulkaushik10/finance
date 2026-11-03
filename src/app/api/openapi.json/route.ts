import { json, route } from "@/server/http";
import { buildOpenApi } from "@/server/openapi";

export const dynamic = "force-dynamic";

export const GET = route(async () => json(buildOpenApi()));
