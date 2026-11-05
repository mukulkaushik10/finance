import { vendorSessionCookieHeader } from "@/server/portal/session";
import { json, route } from "@/server/http";

export const POST = route(async () => json({ ok: true }, 200, { "set-cookie": vendorSessionCookieHeader("", 0) }));
