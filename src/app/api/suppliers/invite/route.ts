import { requireCtx } from "@/server/auth/session";
import { json, readJson, route } from "@/server/http";
import { inviteSupplier } from "@/server/portal/suppliers";

export const dynamic = "force-dynamic";

/** Invite a vendor to the supplier portal. The invitation link is returned once. */
export const POST = route(async (req) => json(await inviteSupplier(await requireCtx(req, "suppliers:manage"), await readJson(req)), 201));
