import { beforeAll, describe, expect, it } from "vitest";
import { POST as evaluate } from "@/app/v1/actions/evaluate/route";
import { GET as agentStatus } from "@/app/v1/actions/[id]/route";
import { POST as review } from "@/app/api/actions/[id]/review/route";
import { GET as actionDetail } from "@/app/api/actions/[id]/route";
import { GET as listActions } from "@/app/api/actions/route";
import { GET as queue } from "@/app/api/review-queue/route";
import { GET as autonomyGet, POST as autonomyPost } from "@/app/api/workflows/[id]/autonomy/route";
import { PATCH as workflowPatch } from "@/app/api/workflows/[id]/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { hashPassword } from "@/server/auth/password";
import { createSessionToken, SESSION_COOKIE } from "@/server/auth/session";
import { deliverReviewCallback } from "@/server/review/callback";
import { verifySignature } from "@/server/agents/webhook";
import { verifyChain } from "@/server/audit/chain";
import { call, cleanInvoice } from "../helpers/api";

const KEY = DEMO.agents.cautious.apiKey;
const WF = DEMO.workflowId;
const db = forOrg(DEMO.orgId);
let reviewerCookie = "";

async function queued(amountMinor: number, decision: "approve" | "escalate" = "approve") {
  const { body } = await cleanInvoice({ amountMinor });
  body.proposed.decision = decision;
  const res = await call(evaluate, { body, apiKey: KEY });
  expect(res.data.status).toBe("pending_review");
  return res.data.action_id as string;
}

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed", level: 2 });
  const reviewer = await db.user.create({
    data: { organisationId: DEMO.orgId, email: "rev@harborpine.example", name: "Riley Reviewer", role: "reviewer", passwordHash: hashPassword("x") },
  });
  reviewerCookie = `${SESSION_COOKIE}=${await createSessionToken(reviewer.id)}`;
});

describe("review queue (acceptance 3)", () => {
  it("at Level 2 an invoice above the limit lands in the queue; approving records reviewer, reason and time in the audit log", async () => {
    const id = await queued(750_000); // $7,500 > $5,000 limit
    const q = await call(queue, { user: "controller" });
    expect(q.data.pending.map((a: { id: string }) => a.id)).toContain(id);

    const before = Date.now();
    const res = await call(review, { user: "controller", params: { id }, body: { decision: "approve", reason: "Checked with buyer, goods received in full" } });
    expect(res.status).toBe(201);

    const action = await db.action.findFirstOrThrow({ where: { id }, include: { review: true } });
    expect(action.status).toBe("approved");
    expect(action.review).toMatchObject({ reviewerId: DEMO.users.controller.id, decision: "approve", agentWasCorrect: true });

    const audit = await db.auditRecord.findFirstOrThrow({ where: { entityId: id, eventType: "action.reviewed" } });
    expect(audit.actorId).toBe(DEMO.users.controller.id);
    expect(audit.occurredAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(audit.payload).toMatchObject({
      reviewer: { id: DEMO.users.controller.id, name: "Dana Whitfield", role: "controller" },
      decision: "approve",
      reason: "Checked with buyer, goods received in full",
      previousStatus: "pending_review",
      newStatus: "approved",
    });
    expect((audit.payload as { erpRef: string }).erpRef).toMatch(/^QUICKBOOKS-BILL-/);
    expect(audit.seq).toBe(res.data.audit.seq);

    // The agent can now see the decision.
    const status = await call(agentStatus, { apiKey: KEY, params: { id } });
    expect(status.data).toMatchObject({ status: "approved", final_decision: "approve", reviewer: { name: "Dana Whitfield" } });
    expect((await verifyChain(DEMO.orgId)).ok).toBe(true);
  });

  it("requires a reason", async () => {
    const id = await queued(700_000);
    const res = await call(review, { user: "controller", params: { id }, body: { decision: "approve", reason: "ok" } });
    expect(res.status).toBe(422);
  });

  it("auditors cannot review", async () => {
    const id = await queued(700_000);
    const res = await call(review, { user: "auditor", params: { id }, body: { decision: "approve", reason: "looks fine to me really" } });
    expect(res.status).toBe(403);
  });

  it("enforces approval limits: a reviewer can't approve a controller-band invoice, a controller can", async () => {
    const id = await queued(2_000_000); // $20,000: controller band
    const asReviewer = await review(new Request("http://x", {
      method: "POST", headers: { cookie: reviewerCookie, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", reason: "Looks right to me" }),
    }), { params: Promise.resolve({ id }) });
    expect(asReviewer.status).toBe(403);
    expect((await asReviewer.json()).error.message).toContain("controller or above");
    expect((await call(review, { user: "controller", params: { id }, body: { decision: "reject", reason: "Not budgeted this quarter" } })).status).toBe(201);
  });

  it("can't be decided twice", async () => {
    const id = await queued(650_000);
    await call(review, { user: "controller", params: { id }, body: { decision: "approve", reason: "Verified against PO" } });
    const again = await call(review, { user: "admin", params: { id }, body: { decision: "reject", reason: "Changed my mind here" } });
    expect(again.status).toBe(409);
  });

  it("records whether an escalation was the right call as ground truth", async () => {
    const right = await queued(100_000, "escalate");
    await call(review, { user: "controller", params: { id: right }, body: { decision: "approve", reason: "Checked; fine to pay", agentRightToEscalate: true } });
    const wrong = await queued(100_000, "escalate");
    await call(review, { user: "controller", params: { id: wrong }, body: { decision: "approve", reason: "Routine invoice, no need", agentRightToEscalate: false } });
    const reviews = await db.review.findMany({ where: { actionId: { in: [right, wrong] } } });
    const byId = Object.fromEntries(reviews.map((r) => [r.actionId, r]));
    expect(byId[right]).toMatchObject({ correctDecision: "escalate", agentWasCorrect: true });
    expect(byId[wrong]).toMatchObject({ correctDecision: "approve", agentWasCorrect: false });
  });

  it("shows the action detail with rule results and audit records", async () => {
    const id = await queued(800_000);
    const res = await call(actionDetail, { user: "auditor", params: { id } });
    expect(res.status).toBe(200);
    expect(res.data.action.ruleResults).toHaveLength(5);
    expect(res.data.audit[0].eventType).toBe("action.evaluated");
    expect(res.data.canReview).toBe(false);
  });

  it("lists and filters actions, including money at risk (approved despite a failed rule)", async () => {
    const { body } = await cleanInvoice({ amountMinor: 300_000 });
    body.subject.po_number = "PO-DOES-NOT-EXIST";
    const res = await call(evaluate, { body, apiKey: KEY });
    await call(review, { user: "controller", params: { id: res.data.action_id }, body: { decision: "approve", reason: "Non-PO spend approved by CFO" } });
    const risky = await call(listActions, { user: "auditor", path: "/api/actions?flag=money_at_risk" });
    expect(risky.data.rows.map((r: { id: string }) => r.id)).toContain(res.data.action_id);
    expect(risky.data.rows.every((r: { ruleResults: unknown[] }) => r.ruleResults.length > 0)).toBe(true);
    const pending = await call(listActions, { user: "auditor", path: "/api/actions?status=pending_review" });
    expect(pending.data.rows.every((r: { status: string }) => r.status === "pending_review")).toBe(true);
    expect((await call(listActions, { user: "auditor", path: "/api/actions?from=2026-13-01" })).status).toBe(422);
  });

  it("notifies the agent's callback URL with a signed message", async () => {
    const id = await queued(720_000);
    await rawPrisma.agent.update({ where: { id: DEMO.agents.cautious.id }, data: { callbackUrl: "https://agent.example/cb" } });
    await call(review, { user: "controller", params: { id }, body: { decision: "reject", reason: "Duplicate of a paid invoice" } });
    let received: { body: string; headers: Headers } | null = null;
    const fake: typeof fetch = async (_u, init) => {
      received = { body: String(init!.body), headers: new Headers(init!.headers) };
      return new Response("ok");
    };
    expect(await deliverReviewCallback(DEMO.orgId, id, fake)).toEqual({ delivered: true });
    const r = received!;
    expect(JSON.parse(r.body)).toMatchObject({ event: "action.decided", action_id: id, final_decision: "reject" });
    expect(verifySignature(DEMO.agents.cautious.signingSecret, r.headers.get("x-controlroom-timestamp"), r.body, r.headers.get("x-controlroom-signature"))).toBe(true);
    await rawPrisma.agent.update({ where: { id: DEMO.agents.cautious.id }, data: { callbackUrl: null } });
  });
});

describe("autonomy levels", () => {
  it("reports the track record and whether promotion is possible", async () => {
    const res = await call(autonomyGet, { user: "auditor", params: { id: WF } });
    expect(res.status).toBe(200);
    expect(res.data.workflow.autonomyLevel).toBe(2);
    expect(res.data.promotion).toMatchObject({ eligible: false, nextLevel: 3 });
    expect(res.data.promotion.reason).toMatch(/Needs 50 reviewed invoices/);
  });

  it("refuses a promotion the track record doesn't support", async () => {
    const res = await call(autonomyPost, { user: "controller", params: { id: WF }, body: { toLevel: 3, reason: "Let's go faster now please" } });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toMatch(/^Not ready for Level 3/);
  });

  it("suggests promotion once rolling accuracy meets the target, and a person must confirm it", async () => {
    await rawPrisma.workflow.update({ where: { id: WF }, data: { promotionWindow: 5, promotionTargetBps: 8000 } });
    for (let i = 0; i < 5; i++) {
      const id = await queued(600_000 + i);
      await call(review, { user: "controller", params: { id }, body: { decision: "approve", reason: "Verified against PO and receipt" } });
    }
    const state = await call(autonomyGet, { user: "controller", params: { id: WF } });
    expect(state.data.promotion.eligible).toBe(true);
    expect(state.data.workflow.autonomyLevel).toBe(2); // suggested, not applied

    expect((await call(autonomyPost, { user: "auditor", params: { id: WF }, body: { toLevel: 3, reason: "Auditor trying it out" } })).status).toBe(403);
    const res = await call(autonomyPost, { user: "controller", params: { id: WF }, body: { toLevel: 3, reason: "Accuracy above target for 5 invoices" } });
    expect(res.status).toBe(200);
    expect(res.data.change).toMatchObject({ fromLevel: 2, toLevel: 3, sampleSize: 5, confirmedById: DEMO.users.controller.id });
    const audit = await db.auditRecord.findFirstOrThrow({ where: { eventType: "autonomy.changed" }, orderBy: { seq: "desc" } });
    expect(audit.payload).toMatchObject({ fromLevel: 2, toLevel: 3, direction: "promotion" });
  });

  it("allows moving down at any time, but only one level up at a time", async () => {
    expect((await call(autonomyPost, { user: "controller", params: { id: WF }, body: { toLevel: 0, reason: "Pausing during year-end close" } })).status).toBe(200);
    const skip = await call(autonomyPost, { user: "controller", params: { id: WF }, body: { toLevel: 2, reason: "Back to where we were" } });
    expect(skip.status).toBe(400);
    expect(skip.data.error.message).toBe("Promote one level at a time");
  });

  it("changing the auto-approve limit takes effect on the next call", async () => {
    await rawPrisma.workflow.update({ where: { id: WF }, data: { autonomyLevel: 2 } });
    const { body } = await cleanInvoice({ amountMinor: 400_000 });
    expect((await call(evaluate, { body, apiKey: KEY })).data.outcome).toBe("auto_approve");
    const patch = await call(workflowPatch, { method: "PATCH", user: "controller", params: { id: WF }, body: { autoApproveLimitMinor: 250_000, reason: "Tighter limit during audit season" } });
    expect(patch.status).toBe(200);
    const { body: b2 } = await cleanInvoice({ amountMinor: 400_000 });
    expect((await call(evaluate, { body: b2, apiKey: KEY })).data.outcome).toBe("needs_human");
    expect(await db.auditRecord.count({ where: { eventType: "workflow.settings_changed", actorId: DEMO.users.controller.id } })).toBe(1);
  });

  it("shadow-mode actions can be spot-checked without changing what happened", async () => {
    await rawPrisma.workflow.update({ where: { id: WF }, data: { autonomyLevel: 0 } });
    const { body } = await cleanInvoice({ amountMinor: 100_000 });
    const res = await call(evaluate, { body, apiKey: KEY });
    expect(res.data.status).toBe("logged");
    const q = await call(queue, { user: "controller" });
    expect(q.data.spotChecks.map((a: { id: string }) => a.id)).toContain(res.data.action_id);
    await call(review, { user: "controller", params: { id: res.data.action_id }, body: { decision: "approve", reason: "Spot check: correct to pay" } });
    const a = await db.action.findFirstOrThrow({ where: { id: res.data.action_id }, include: { review: true } });
    expect(a.status).toBe("logged");
    expect(a.review?.agentWasCorrect).toBe(true);
    expect((await verifyChain(DEMO.orgId)).ok).toBe(true);
  });
});
