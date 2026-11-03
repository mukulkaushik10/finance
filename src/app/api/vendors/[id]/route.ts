import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { updateVendor } from "@/server/settings/service";

export const dynamic = "force-dynamic";

/** Block/unblock a vendor or record a bank detail change. */
export const PATCH = route<{ id: string }>(async (req, { id }) => json({ vendor: await updateVendor(await requireCtx(req, "settings:edit"), id, await readJson(req)) }));
