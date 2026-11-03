import { sessionCookieHeader } from "@/server/auth/session";
import { json, route } from "@/server/http";

export const POST = route(async () => json({ ok: true }, 200, { "set-cookie": sessionCookieHeader("", 0) }));
