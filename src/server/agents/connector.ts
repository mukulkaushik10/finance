import type { Agent } from "@prisma/client";
import { MockConfigSchema, mockAgentDecide, type AgentAnswer } from "./mock";
import { callWebhookAgent } from "./webhook";
import type { ContextLookup } from "../workflows/ap_invoice/context";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";

/** One way to ask any agent for a decision, whatever kind it is. */
export type AgentConnector = (subject: InvoiceSubject, lookup: ContextLookup, asOf: Date) => Promise<AgentAnswer>;

export function agentConnector(agent: Agent): AgentConnector {
  if (agent.kind === "mock") {
    const config = MockConfigSchema.parse(agent.mockConfig);
    return (subject, lookup, asOf) => mockAgentDecide(subject, lookup, config, asOf);
  }
  return (subject) => callWebhookAgent(agent, subject);
}
