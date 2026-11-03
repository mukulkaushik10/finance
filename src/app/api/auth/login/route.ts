import { login } from "@/server/auth/login";
import { sessionCookieHeader } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";

export const POST = route(async (req) => {
  const { token, user } = await login(await readJson(req));
  return json({ user }, 200, { "set-cookie": sessionCookieHeader(token) });
});
