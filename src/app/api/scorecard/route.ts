import { requireCtx } from "@/server/auth/session";
import { json, route } from "@/server/http";
import { getScorecard } from "@/server/scorecard/service";

export const dynamic = "force-dynamic";

/** Weekly outcome scorecard. ?weeks=8&week=YYYY-MM-DD (a Monday) */
export const GET = route(async (req) => {
  const ctx = await requireCtx(req, "scorecard:view");
  return json(await getScorecard(ctx, Object.fromEntries(new URL(req.url).searchParams)));
});
