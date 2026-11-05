import { vendorLogin } from "@/server/portal/auth";
import { vendorSessionCookieHeader } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { token, user } = await vendorLogin(await readJson(req));
  return json({ user }, 200, { "set-cookie": vendorSessionCookieHeader(token) });
});
