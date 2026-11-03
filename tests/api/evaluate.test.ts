import { beforeAll, describe, expect, it } from "vitest";
import { POST as evaluate } from "@/app/v1/actions/evaluate/route";
import { GET as getAction } from "@/app/v1/actions/[id]/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { updateRule } from "@/server/rules/service";
import { verifyChain } from "@/server/audit/chain";
import { call, cleanInvoice, ctxFor } from "../helpers/api";

const KEY = DEMO.agents.cautious.apiKey;
const db = forOrg(DEMO.orgId);
const setLevel = (level: number) => rawPrisma.workflow.update({ where: { id: DEMO.workflowId }, data: { autonomyLevel: level } });

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed", level: 2 });
});

describe("POST /v1/actions/evaluate", () => {
  it("rejects calls without a valid agent key", async () => {
    const { body } = await cleanInvoice();
    expect((await call(evaluate, { body })).status).toBe(401);
    expect((await call(evaluate, { body, apiKey: "cr_live_wrong" })).status).toBe(401);
  });

  it("validates the request and explains what is wrong", async () => {
    const res = await call(evaluate, { body: { workflow_id: DEMO.workflowId }, apiKey: KEY });
    expect(res.status).toBe(422);
    expect(res.data.error.code).toBe("validation_failed");
    expect(res.data.error.details.map((d: { path: string }) => d.path)).toContain("proposed");
  });

  it("404s for an unknown workflow", async () => {
    const { body } = await cleanInvoice();
    expect((await call(evaluate, { body: { ...body, workflow_id: "nope" }, apiKey: KEY })).status).toBe(404);
  });

  it("auto-approves a clean small invoice at Level 2, storing rule results and an audit record", async () => {
    await setLevel(2);
    const { body } = await cleanInvoice({ amountMinor: 120_000 });
    const res = await call(evaluate, { body, apiKey: KEY });
    expect(res.status).toBe(201);
    expect(res.data).toMatchObject({ outcome: "auto_approve", enforced: true, autonomy_level: 2, status: "auto_approved", review_url: null });
    expect(res.data.rule_results).toHaveLength(5);
    expect(res.data.rule_results.every((r: { result: string }) => r.result === "pass")).toBe(true);
    expect(res.data.audit.hash).toMatch(/^[0-9a-f]{64}$/);
    const stored = await db.ruleResult.count({ where: { actionId: res.data.action_id } });
    expect(stored).toBe(5);
  });

  it("acceptance 3 (gate side): above the Level 2 limit it goes to the review queue", async () => {
    await setLevel(2);
    const { body } = await cleanInvoice({ amountMinor: 750_000 });
    const res = await call(evaluate, { body, apiKey: KEY });
    expect(res.data.outcome).toBe("needs_human");
    expect(res.data.status).toBe("pending_review");
    expect(res.data.reasons).toContain("$7,500.00 is above the $5,000.00 auto-approve limit");
    expect(res.data.review_url).toContain(`/review/${res.data.action_id}`);
  });

  it("blocks an invoice from a blocked vendor", async () => {
    const { body } = await cleanInvoice();
    const blocked = await db.vendor.findFirstOrThrow({ where: { blocked: true } });
    body.subject.vendor_id = blocked.code;
    body.subject.vendor_name = blocked.name;
    const res = await call(evaluate, { body, apiKey: KEY });
    expect(res.data.outcome).toBe("block");
    expect(res.data.reasons[0]).toContain("is blocked");
  });

  it("flags a resubmitted invoice as a possible duplicate", async () => {
    await setLevel(3);
    const { body } = await cleanInvoice({ amountMinor: 80_000 });
    const first = await call(evaluate, { body, apiKey: KEY });
    expect(first.data.outcome).toBe("auto_approve");
    const again = { ...body, subject: { ...body.subject, invoice_id: body.subject.invoice_id + "-B", invoice_number: body.subject.invoice_number + "A" } };
    const second = await call(evaluate, { body: again, apiKey: KEY });
    expect(second.data.outcome).toBe("needs_human");
    expect(second.data.reasons[0]).toMatch(/^Possible duplicate/);
  });

  it("acceptance 2: lowering an approval limit changes the outcome on the very next call, no deploy", async () => {
    await setLevel(3);
    const { body } = await cleanInvoice({ amountMinor: 800_000 }); // $8,000
    const before = await call(evaluate, { body, apiKey: KEY });
    expect(before.data.outcome).toBe("auto_approve");

    const rule = await db.rule.findFirstOrThrow({ where: { workflowId: DEMO.workflowId, type: "approval_limit" } });
    await updateRule(ctxFor("controller"), rule.id, {
      changeNote: "Tighten no-approval band to $5,000",
      params: { currency: "USD", bands: [{ upToMinor: 500_000, approver: "none" }, { upToMinor: 5_000_000, approver: "controller" }, { upToMinor: null, approver: "admin" }] },
    });

    const { body: body2 } = await cleanInvoice({ amountMinor: 800_000 });
    const after = await call(evaluate, { body: body2, apiKey: KEY });
    expect(after.data.outcome).toBe("needs_human");
    expect(after.data.required_approver).toBe("controller");
    const limit = after.data.rule_results.find((r: { rule_name: string }) => r.rule_name === "Approval limits");
    expect(limit).toMatchObject({ result: "fail", rule_version: 2 });
  });

  it("shadow mode (Level 0) never stops the agent but records what would have happened", async () => {
    await setLevel(0);
    const { body } = await cleanInvoice();
    body.proposed.confidence = 0.4;
    const res = await call(evaluate, { body, apiKey: KEY });
    expect(res.data).toMatchObject({ outcome: "auto_approve", enforced: false, shadow_outcome: "needs_human", status: "logged" });
  });

  it("is idempotent per Idempotency-Key", async () => {
    await setLevel(2);
    const { body } = await cleanInvoice();
    const a = await call(evaluate, { body, apiKey: KEY, headers: { "idempotency-key": "abc-123" } });
    const b = await call(evaluate, { body, apiKey: KEY, headers: { "idempotency-key": "abc-123" } });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.data.action_id).toBe(a.data.action_id);
    expect(b.data.idempotent_replay).toBe(true);
  });

  it("keeps the audit chain valid across all of the above", async () => {
    const v = await verifyChain(DEMO.orgId);
    expect(v.ok).toBe(true);
    expect(v.checked).toBeGreaterThan(10);
  });
});

describe("GET /v1/actions/{id}", () => {
  it("returns status for the calling agent's own action only", async () => {
    await setLevel(2);
    const { body } = await cleanInvoice({ amountMinor: 900_000 });
    const res = await call(evaluate, { body, apiKey: KEY });
    const mine = await call(getAction, { apiKey: KEY, params: { id: res.data.action_id } });
    expect(mine.status).toBe(200);
    expect(mine.data).toMatchObject({ status: "pending_review", final_decision: null, reviewer: null });
    const other = await call(getAction, { apiKey: DEMO.agents.fastpay.apiKey, params: { id: res.data.action_id } });
    expect(other.status).toBe(404);
  });
});
