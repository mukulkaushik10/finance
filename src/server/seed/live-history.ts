import { rawPrisma } from "../db/client";
import { forOrg } from "../db/dal";
import { evaluateAction } from "../gate/evaluate";
import { reviewAction } from "../review/service";
import { changeAutonomyLevel } from "../autonomy/service";
import { mockAgentDecide, MockConfigSchema } from "../agents/mock";
import { getErpConnector } from "../connectors/erp";
import { liveLookup } from "../workflows/ap_invoice/context";
import { toVendorRecord } from "../connectors/erp";
import { rng } from "./random";
import { generateInvoices, type GenInvoice } from "./generator";
import { DEMO, insertPoGrn } from "./demo";
import type { Ctx } from "../auth/session";

// Eight weeks of live traffic through the real gate, so the review queue, scorecard and audit
// trail have realistic history. Weeks 1-3 run at Level 1; the controller then confirms a
// promotion to Level 2. The last day's queued invoices are left for you to review.

const DAY = 86_400_000;
const WEEKS = 8;

const ctxOf = (u: (typeof DEMO.users)[keyof typeof DEMO.users]): Ctx => ({
  organisationId: DEMO.orgId, user: { id: u.id, name: u.name, email: u.email, role: u.role },
});

const REASONS = {
  approve_clean: ["Checked against PO and receipt, all fine", "Matches PO, goods received in full", "Verified with budget owner, OK to pay"],
  approve_override: [
    "Price increase agreed with buyer by email, OK to pay",
    "Partial delivery accepted by warehouse; remainder cancelled",
    "Freight surcharge confirmed with logistics team",
    "Called vendor on number from master file; bank change is genuine",
    "CFO approved this one-off purchase in writing",
  ],
  reject_dup: ["Duplicate of an invoice already paid", "Same invoice resubmitted with a new number"],
  reject_other: ["Vendor is blocked; do not pay", "No PO and the budget owner doesn't recognise it", "Could not verify bank change with vendor; rejected"],
};

export async function seedLiveHistory(opts: { now?: Date; count?: number } = {}): Promise<Record<string, number>> {
  const now = opts.now ?? new Date();
  const count = opts.count ?? 560;
  const db = forOrg(DEMO.orgId);
  const r = rng("live-history-v1");
  const vendorsRaw = await db.vendor.findMany();
  const vendors = vendorsRaw.map((v) => ({ ...toVendorRecord(v) }));
  const start = new Date(now.getTime() - WEEKS * 7 * DAY);
  const gen = generateInvoices(vendors, {
    seed: "live-v1", count, start, end: new Date(now.getTime() - 2 * 3600_000), idPrefix: "LIV", poStart: 70000, includeBankFingerprint: true,
  });
  await insertPoGrn(DEMO.orgId, gen.pos, gen.grns);

  // Two invoices quoting bank details that don't match the vendor record.
  for (const inv of gen.invoices.filter((i) => i.correctDecision === "approve").slice(40, 42)) {
    inv.subject.bank_account = { fingerprint: "sha256:attacker-account" };
    inv.correctDecision = "escalate";
    inv.anomaly = "bank_changed";
  }

  const agent = await rawPrisma.agent.findUniqueOrThrow({ where: { id: DEMO.agents.cautious.id } });
  const config = MockConfigSchema.parse(agent.mockConfig);
  const wf = await db.workflow.findFirstOrThrow({ where: { id: DEMO.workflowId } });
  const lookup = liveLookup(db, getErpConnector(wf.erpConnector, db), wf.id);
  const controller = ctxOf(DEMO.users.controller);
  const admin = ctxOf(DEMO.users.admin);
  await rawPrisma.workflow.update({ where: { id: wf.id }, data: { autonomyLevel: 1 } });

  const promoteAt = new Date(start.getTime() + 21 * DAY);
  let promoted = false;
  const pendingReviews: { actionId: string; at: Date; inv: GenInvoice; requiredRole: string | null; proposed: string }[] = [];
  let evaluated = 0, reviewed = 0;

  const flushReviews = async (until: Date) => {
    pendingReviews.sort((a, b) => a.at.getTime() - b.at.getTime());
    while (pendingReviews.length && pendingReviews[0].at <= until) {
      const p = pendingReviews.shift()!;
      const truth = p.inv.correctDecision;
      // People decide what to actually do: escalated items are usually resolved after checking.
      let decision: "approve" | "reject";
      let reason: string;
      if (truth === "approve") { decision = "approve"; reason = r.pick(REASONS.approve_clean); }
      else if (truth === "reject") { decision = "reject"; reason = p.inv.anomaly === "duplicate" ? r.pick(REASONS.reject_dup) : r.pick(REASONS.reject_other); }
      else if (r.chance(0.6)) { decision = "approve"; reason = r.pick(REASONS.approve_override); }
      else { decision = "reject"; reason = r.pick(REASONS.reject_other); }
      const who = p.requiredRole === "admin" ? admin : controller;
      await reviewAction(who, p.actionId, {
        decision, reason,
        ...(p.proposed === "escalate" ? { agentRightToEscalate: truth === "escalate" } : {}),
      }, { now: p.at, skipCallback: true });
      reviewed++;
    }
  };

  for (const inv of gen.invoices) {
    const day = new Date(inv.subject.invoice_date + "T00:00:00Z").getTime();
    const at = new Date(Math.min(now.getTime() - 3600_000, day + r.int(8, 17) * 3600_000 + r.int(0, 3599) * 1000));
    await flushReviews(at);
    if (!promoted && at >= promoteAt) {
      promoted = true;
      await rawPrisma.workflow.update({ where: { id: wf.id }, data: { promotionTargetBps: 9000 } });
      await changeAutonomyLevel(controller, wf.id, {
        toLevel: 2, reason: "Three weeks at Level 1 with accuracy above target; auto-approve small, clean invoices",
      }, { now: at }).catch((e) => console.warn("[seed] promotion skipped:", (e as Error).message));
    }
    const answer = await mockAgentDecide(inv.subject, lookup, config, at);
    const res = await evaluateAction(agent, {
      workflow_id: wf.id, agent_version: agent.version,
      proposed: { decision: answer.decision, gl_code: answer.gl_code, reason: answer.reason, confidence: answer.confidence },
      subject: inv.subject,
    }, { now: at });
    evaluated++;
    if (res.status === "pending_review") {
      const reviewAt = new Date(at.getTime() + r.int(1, 30) * 3600_000);
      // Leave the most recent day's queue for a person to work through.
      if (reviewAt.getTime() < now.getTime() - 60 * 3600_000) {
        pendingReviews.push({ actionId: res.action_id, at: reviewAt, inv, requiredRole: res.required_approver, proposed: answer.decision });
      }
    }
  }
  await flushReviews(new Date(now.getTime() - 60 * 3600_000));
  const pending = await db.action.count({ where: { status: "pending_review" } });
  return { liveActions: evaluated, reviews: reviewed, waitingForReview: pending };
}
