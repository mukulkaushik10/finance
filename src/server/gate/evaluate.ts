import { Prisma, type Agent } from "@prisma/client";
import { forOrg, type OrgDb } from "../db/dal";
import { badRequest, notFound } from "../errors";
import { appendAudit } from "../audit/chain";
import { getErpConnector } from "../connectors/erp";
import { loadActiveRules } from "../rules/load";
import { evaluateRules, ruleSetVersion } from "../rules/engine";
import { buildInvoiceContext, liveLookup } from "../workflows/ap_invoice/context";
import { decideGate } from "./decide";
import { EvaluateRequestSchema, type EvaluateResponse } from "./schemas";

export interface EvaluateOptions {
  idempotencyKey?: string | null;
  /** Override the clock (seed data / tests). */
  now?: Date;
}

/**
 * POST /v1/actions/evaluate. Runs the rules + autonomy level for a proposed agent action,
 * stores the action, its rule results and an audit record in one transaction, and returns
 * the gate outcome.
 */
export async function evaluateAction(agent: Agent, body: unknown, opts: EvaluateOptions = {}): Promise<EvaluateResponse> {
  const req = EvaluateRequestSchema.parse(body);
  const db = forOrg(agent.organisationId);
  const now = opts.now ?? new Date();
  const idempotencyKey = opts.idempotencyKey?.slice(0, 200) || null;

  if (idempotencyKey) {
    const existing = await db.action.findFirst({ where: { agentId: agent.id, idempotencyKey } });
    if (existing) return { ...(await buildEvaluateResponse(db, existing.id)), idempotent_replay: true };
  }

  const workflow = await db.workflow.findFirst({ where: { id: req.workflow_id } });
  if (!workflow) throw notFound(`Workflow ${req.workflow_id}`);
  if (workflow.type !== "ap_invoice" || req.subject.type !== "invoice") throw badRequest("This workflow only accepts invoice subjects");

  const subject = { ...req.subject, amount: { ...req.subject.amount, currency: req.subject.amount.currency.toUpperCase() } };
  const confidenceBps = req.proposed.confidence === undefined ? null : Math.round(req.proposed.confidence * 10_000);
  const proposed = { decision: req.proposed.decision, glCode: req.proposed.gl_code ?? null, confidenceBps };

  const erp = getErpConnector(workflow.erpConnector, db);
  const { ctx, vendorKey } = await buildInvoiceContext(subject, proposed, liveLookup(db, erp, workflow.id), now);
  const rules = await loadActiveRules(db, workflow.id);
  const results = evaluateRules(rules, ctx);
  const gate = decideGate({
    level: workflow.autonomyLevel,
    autoApproveLimitMinor: workflow.autoApproveLimitMinor,
    workflowCurrency: workflow.currency,
    confidenceThresholdBps: workflow.confidenceThresholdBps,
    proposedDecision: proposed.decision,
    confidenceBps,
    amountMinor: ctx.amountMinor,
    currency: ctx.currency,
    ruleResults: results,
  });
  const rsv = ruleSetVersion(rules);
  const agentVersion = req.agent_version ?? agent.version;
  const cost = req.cost
    ? { minor: BigInt(req.cost.minor), currency: req.cost.currency.toUpperCase() }
    : { minor: agent.costPerActionMinor, currency: agent.costCurrency };

  try {
    const actionId = await db.$transaction(async (tx) => {
      const action = await tx.action.create({
        data: {
          organisationId: agent.organisationId,
          workflowId: workflow.id,
          agentId: agent.id,
          agentVersion,
          source: "live",
          idempotencyKey,
          subjectType: "invoice",
          externalRef: subject.invoice_id,
          counterpartyKey: vendorKey,
          counterpartyName: ctx.vendor?.name ?? subject.vendor_name,
          amountMinor: ctx.amountMinor,
          currency: ctx.currency,
          occurredOn: new Date(subject.invoice_date + "T00:00:00Z"),
          payload: subject as unknown as Prisma.InputJsonValue,
          proposedDecision: proposed.decision,
          proposedGlCode: proposed.glCode,
          agentReason: req.proposed.reason ?? null,
          agentConfidenceBps: confidenceBps,
          gateOutcome: gate.outcome,
          computedOutcome: gate.computedOutcome,
          enforced: gate.enforced,
          gateReasons: gate.reasons,
          requiredRole: gate.requiredRole,
          autonomyLevel: workflow.autonomyLevel,
          ruleSetVersion: rsv,
          status: gate.status,
          costMinor: cost.minor,
          costCurrency: cost.currency,
          createdAt: now,
          decidedAt: gate.status === "pending_review" ? null : now,
        },
      });
      await tx.ruleResult.createMany({
        data: results.map((r) => ({
          organisationId: agent.organisationId,
          actionId: action.id,
          ruleId: r.ruleId,
          ruleVersionId: r.ruleVersionId,
          ruleName: r.name,
          ruleType: r.type,
          severity: r.severity,
          result: r.result,
          explanation: r.explanation,
          details: toJson(r.details ?? {}),
        })),
      });
      await appendAudit(tx, agent.organisationId, {
        eventType: "action.evaluated",
        entityType: "action",
        entityId: action.id,
        actorType: "agent",
        actorId: agent.id,
        occurredAt: now,
        payload: {
          workflow: { id: workflow.id, name: workflow.name, autonomyLevel: workflow.autonomyLevel, autoApproveLimitMinor: workflow.autoApproveLimitMinor, confidenceThresholdBps: workflow.confidenceThresholdBps },
          agent: { id: agent.id, name: agent.name, version: agentVersion },
          inputs: subject,
          proposed: { decision: proposed.decision, glCode: proposed.glCode, reason: req.proposed.reason ?? null, confidenceBps },
          ruleResults: results.map((r) => ({ ruleId: r.ruleId, ruleVersionId: r.ruleVersionId, version: r.version, name: r.name, severity: r.severity, result: r.result, explanation: r.explanation })),
          ruleSetVersion: rsv,
          gate: { outcome: gate.outcome, computedOutcome: gate.computedOutcome, enforced: gate.enforced, reasons: gate.reasons, requiredRole: gate.requiredRole, status: gate.status },
          cost,
        },
      });
      return action.id;
    });
    return buildEvaluateResponse(db, actionId);
  } catch (e) {
    // Two concurrent calls with the same Idempotency-Key: return the one that won.
    if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await db.action.findFirst({ where: { agentId: agent.id, idempotencyKey } });
      if (existing) return { ...(await buildEvaluateResponse(db, existing.id)), idempotent_replay: true };
    }
    throw e;
  }
}

function toJson(v: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));
}

export async function buildEvaluateResponse(db: OrgDb, actionId: string): Promise<EvaluateResponse> {
  const action = await db.action.findFirst({
    where: { id: actionId },
    include: { ruleResults: { include: { ruleVersion: { select: { version: true } } } } },
  });
  if (!action) throw notFound("Action");
  const audit = await db.auditRecord.findFirst({
    where: { entityType: "action", entityId: action.id, eventType: "action.evaluated" },
    select: { seq: true, hash: true },
  });
  const appUrl = process.env.APP_URL ?? "";
  return {
    action_id: action.id,
    outcome: action.gateOutcome,
    enforced: action.enforced,
    shadow_outcome: action.enforced ? null : action.computedOutcome,
    autonomy_level: action.autonomyLevel,
    status: action.status,
    required_approver: (action.requiredRole as "reviewer" | "controller" | "admin" | null) ?? null,
    reasons: action.gateReasons as string[],
    rule_results: action.ruleResults.map((r) => ({
      rule_id: r.ruleId, rule_name: r.ruleName, rule_version: r.ruleVersion.version,
      result: r.result, severity: r.severity, explanation: r.explanation,
    })),
    review_url: action.status === "pending_review" ? `${appUrl}/review/${action.id}` : null,
    audit: { seq: audit?.seq ?? 0, hash: audit?.hash ?? "" },
    idempotent_replay: false,
  };
}
