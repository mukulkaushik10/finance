import { authenticateAgent } from "@/server/agents/keys";
import { evaluateAction } from "@/server/gate/evaluate";
import { json, readJson, route } from "@/server/http";

export const dynamic = "force-dynamic";

/** POST /v1/actions/evaluate: the agent calls this before it acts. */
export const POST = route(async (req) => {
  const agent = await authenticateAgent(req);
  const body = await readJson(req);
  const result = await evaluateAction(agent, body, { idempotencyKey: req.headers.get("idempotency-key") });
  return json(result, result.idempotent_replay ? 200 : 201);
});
