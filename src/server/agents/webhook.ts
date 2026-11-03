import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { AgentAnswer } from "./mock";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";

// Webhook agent contract (Control Room -> your agent), used for replay runs.
//
//   POST {endpointUrl}
//   Content-Type: application/json
//   X-ControlRoom-Timestamp: <unix seconds>
//   X-ControlRoom-Signature: sha256=<hex HMAC-SHA256 of "<timestamp>.<raw body>" using the agent's signing secret>
//   { "mode": "replay", "workflow_type": "ap_invoice", "subject": { ...invoice... } }
//
// Expected 200 response:
//   { "decision": "approve" | "reject" | "escalate", "gl_code": "6100", "reason": "...", "confidence": 0.93 }

export const AgentAnswerSchema = z.object({
  decision: z.enum(["approve", "reject", "escalate"]),
  gl_code: z.string().max(32).nullish(),
  reason: z.string().max(4000).optional().default(""),
  confidence: z.number().min(0).max(1).optional(),
});

export const WEBHOOK_TIMEOUT_MS = 10_000;

export function signPayload(secret: string, timestamp: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifySignature(secret: string, timestamp: string | null, body: string, signature: string | null, toleranceSec = 300): boolean {
  if (!timestamp || !signature) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSec) return false;
  const expected = Buffer.from(signPayload(secret, timestamp, body));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function callWebhookAgent(
  agent: { endpointUrl: string | null; signingSecret: string },
  subject: InvoiceSubject,
  fetchImpl: typeof fetch = fetch,
): Promise<AgentAnswer> {
  if (!agent.endpointUrl) throw new Error("This agent has no endpoint URL");
  const body = JSON.stringify({ mode: "replay", workflow_type: "ap_invoice", subject });
  const ts = String(Math.floor(Date.now() / 1000));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), WEBHOOK_TIMEOUT_MS);
  try {
    const res = await fetchImpl(agent.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-controlroom-timestamp": ts,
        "x-controlroom-signature": signPayload(agent.signingSecret, ts, body),
      },
      body,
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`Agent answered HTTP ${res.status}`);
    const parsed = AgentAnswerSchema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Error("Agent's answer was not in the expected format");
    return { decision: parsed.data.decision, gl_code: parsed.data.gl_code ?? null, reason: parsed.data.reason, confidence: parsed.data.confidence ?? 0 };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw new Error(`Agent did not answer within ${WEBHOOK_TIMEOUT_MS / 1000}s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
