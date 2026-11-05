import { requireVendorCtx } from "@/server/portal/session";
import { json, readJson, route } from "@/server/http";
import { getSupplierProfile, updateSupplierProfile } from "@/server/portal/profile";

export const dynamic = "force-dynamic";

export const GET = route(async (req) => json({ profile: await getSupplierProfile(await requireVendorCtx(req)) }));
export const PATCH = route(async (req) => json({ profile: await updateSupplierProfile(await requireVendorCtx(req), await readJson(req)) }));
