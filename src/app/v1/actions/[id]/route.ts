import { authenticateAgent } from "@/server/agents/keys";
import { getActionStatus } from "@/server/gate/status";
import { json, route } from "@/server/http";

export const dynamic = "force-dynamic";

export const GET = route<{ id: string }>(async (req, { id }) => {
  const agent = await authenticateAgent(req);
  return json(await getActionStatus(agent, id));
});
