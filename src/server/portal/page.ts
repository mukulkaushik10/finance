import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VENDOR_SESSION_COOKIE, vendorCtxFromToken, type VendorCtx } from "./session";

/** For supplier portal server components: the signed-in supplier user, or a redirect to sign-in. */
export async function getVendorPageCtx(): Promise<VendorCtx> {
  const store = await cookies();
  const ctx = await vendorCtxFromToken(store.get(VENDOR_SESSION_COOKIE)?.value);
  if (!ctx) redirect("/portal/login");
  return ctx;
}
