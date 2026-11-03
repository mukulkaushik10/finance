import { z } from "zod";
import { InvoiceSubjectSchema, MoneySchema } from "../workflows/ap_invoice/subject";

export const DecisionSchema = z.enum(["approve", "reject", "escalate"]);
export const GateOutcomeSchema = z.enum(["auto_approve", "needs_human", "block"]);

export const EvaluateRequestSchema = z.object({
  workflow_id: z.string().min(1).describe("The Control Room workflow this action belongs to, e.g. wf_ap_main"),
  agent_version: z.string().max(64).optional().describe("Version of the agent making the call; recorded in the audit trail"),
  proposed: z.object({
    decision: DecisionSchema.describe("What the agent wants to do with the invoice"),
    gl_code: z.string().max(32).nullish(),
    reason: z.string().max(4000).optional().describe("The agent's stated reason, in plain words"),
    confidence: z.number().min(0).max(1).optional().describe("0 to 1"),
  }),
  // A discriminated union on `type` once refund subjects exist.
  subject: InvoiceSubjectSchema,
  cost: MoneySchema.optional().describe("What this agent call cost, if the agent reports it"),
});
export type EvaluateRequest = z.infer<typeof EvaluateRequestSchema>;

export const RuleResultSchema = z.object({
  rule_id: z.string(),
  rule_name: z.string(),
  rule_version: z.number().int(),
  result: z.enum(["pass", "fail", "not_applicable"]),
  severity: z.enum(["review", "block"]),
  explanation: z.string(),
});

export const EvaluateResponseSchema = z.object({
  action_id: z.string(),
  outcome: GateOutcomeSchema.describe("auto_approve: go ahead. needs_human: wait for a person. block: do not proceed."),
  enforced: z.boolean().describe("false in shadow mode (Level 0): the agent may proceed regardless"),
  shadow_outcome: GateOutcomeSchema.nullable().describe("In shadow mode, what would have happened"),
  autonomy_level: z.number().int().min(0).max(3),
  status: z.string(),
  required_approver: z.enum(["reviewer", "controller", "admin"]).nullable(),
  reasons: z.array(z.string()),
  rule_results: z.array(RuleResultSchema),
  review_url: z.string().nullable(),
  audit: z.object({ seq: z.number().int(), hash: z.string() }),
  idempotent_replay: z.boolean().describe("true when this response was returned for a repeated Idempotency-Key"),
});
export type EvaluateResponse = z.infer<typeof EvaluateResponseSchema>;

export const ActionStatusResponseSchema = z.object({
  action_id: z.string(),
  status: z.enum(["logged", "auto_approved", "pending_review", "approved", "rejected", "blocked"]),
  outcome: GateOutcomeSchema,
  final_decision: DecisionSchema.nullable().describe("approve/reject once decided; null while pending"),
  decided_at: z.string().nullable(),
  reviewer: z.object({ name: z.string(), reason: z.string() }).nullable(),
});
