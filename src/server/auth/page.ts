import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ctxFromToken, SESSION_COOKIE, type Ctx } from "./session";
import { can, type Permission } from "./permissions";

/** For server components: the signed-in user, or a redirect to sign-in. */
export async function getPageCtx(permission?: Permission): Promise<Ctx> {
  const store = await cookies();
  const ctx = await ctxFromToken(store.get(SESSION_COOKIE)?.value);
  if (!ctx) redirect("/login");
  if (permission && !can(ctx.user.role, permission)) redirect("/?denied=1");
  return ctx;
}
