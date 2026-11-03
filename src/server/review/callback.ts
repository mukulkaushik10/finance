import { forOrg } from "../db/dal";
import { signPayload } from "../agents/webhook";

/** Tell the agent (if it registered a callback URL) that a person decided a queued action. */
export async function deliverReviewCallback(organisationId: string, actionId: string, fetchImpl: typeof fetch = fetch) {
  const db = forOrg(organisationId);
  const action = await db.action.findFirst({ where: { id: actionId }, include: { agent: true, review: true } });
  if (!action?.agent.callbackUrl || !action.review) return { delivered: false };
  const body = JSON.stringify({
    event: "action.decided",
    action_id: action.id,
    invoice_id: action.externalRef,
    final_decision: action.review.decision,
    reason: action.review.reason,
    decided_at: action.review.createdAt.toISOString(),
  });
  const ts = String(Math.floor(Date.now() / 1000));
  const res = await fetchImpl(action.agent.callbackUrl, {
    method: "POST",
    headers: { "content-type": "application/json", "x-controlroom-timestamp": ts, "x-controlroom-signature": signPayload(action.agent.signingSecret, ts, body) },
    body,
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Callback failed with HTTP ${res.status}`);
  return { delivered: true };
}
