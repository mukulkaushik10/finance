import { beforeAll, describe, expect, it } from "vitest";
import { GET as listDatasets, POST as uploadDataset } from "@/app/api/replay/datasets/route";
import { POST as startComparison } from "@/app/api/replay/comparisons/route";
import { GET as getComparison } from "@/app/api/replay/comparisons/[id]/route";
import { POST as mockDecide } from "@/app/api/mock-agents/[id]/decide/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import { runReplay } from "@/server/replay/service";
import { callWebhookAgent } from "@/server/agents/webhook";
import { hashApiKey } from "@/server/agents/keys";
import { verifyChain } from "@/server/audit/chain";
import { call } from "../helpers/api";

let csv = "";
const db = forOrg(DEMO.orgId);

function csvForm(text: string, name = "Seed invoices") {
  const fd = new FormData();
  fd.set("csv", new File([text], "invoices.csv", { type: "text/csv" }));
  fd.set("name", name);
  return fd;
}

/** Route a webhook agent's HTTP calls straight to our mock-agent route handler. */
const inProcessFetch: typeof fetch = async (url, init) => {
  const id = String(url).match(/mock-agents\/([^/]+)\/decide/)![1];
  return mockDecide(new Request(String(url), init as RequestInit), { params: Promise.resolve({ id }) });
};

beforeAll(async () => {
  ({ csv } = await seedBase({ csvDir: "/tmp/control-room-test-seed" }));
});

describe("replay testing", () => {
  let datasetId = "";

  it("auditors can't upload", async () => {
    const res = await call(uploadDataset, { method: "POST", user: "auditor", rawBody: csvForm(csv) });
    expect(res.status).toBe(403);
  });

  it("rejects a file with no usable rows and explains why", async () => {
    const res = await call(uploadDataset, { method: "POST", user: "controller", rawBody: csvForm("hello,world\n1,2\n") });
    expect(res.status).toBe(400);
    expect(res.data.error.details[0].message).toMatch(/Missing columns/);
  });

  it("uploads the seed CSV, matching vendors to the vendor master", async () => {
    const res = await call(uploadDataset, { method: "POST", user: "controller", rawBody: csvForm(csv) });
    expect(res.status).toBe(201);
    const expectedMix: Record<string, number> = {};
    for (const line of csv.trim().split("\n").slice(1)) {
      const d = line.split(",")[8];
      expectedMix[d] = (expectedMix[d] ?? 0) + 1;
    }
    expect(res.data).toMatchObject({ imported: 1000, skipped: 0, mix: expectedMix });
    expect(res.data.warnings).toEqual([]);
    datasetId = res.data.dataset.id;
    const cases = await db.replayCase.findMany({ where: { datasetId }, select: { payload: true } });
    expect(cases.filter((c) => !(c.payload as { vendor_id?: string }).vendor_id)).toHaveLength(0);
    const list = await call(listDatasets, { user: "auditor" });
    expect(list.data.datasets).toHaveLength(1);
  });

  it("validates the agent choice (1 to 3)", async () => {
    const res = await call(startComparison, { user: "controller", body: { datasetId, agentIds: [] } });
    expect(res.status).toBe(422);
  });

  it("acceptance 1: replays both mock agents and produces a comparison report well under 2 minutes", async () => {
    const t0 = Date.now();
    const res = await call(startComparison, { user: "controller", body: { datasetId, agentIds: [DEMO.agents.cautious.id, DEMO.agents.fastpay.id] } });
    expect(res.status).toBe(202);
    const runs = res.data.comparison.runs as { id: string }[];
    expect(runs).toHaveLength(2);
    // The worker would pick these up from the queue; run them inline here.
    await Promise.all(runs.map((r) => runReplay(r.id)));
    const report = await call(getComparison, { user: "auditor", params: { id: res.data.comparison.id } });
    expect(Date.now() - t0).toBeLessThan(120_000);
    expect(report.status).toBe(200);
    expect(report.data.done).toBe(true);
    const [cautious, fastpay] = report.data.reports;
    expect(cautious.agent.name).toBe("Cautious Co. AP Agent");

    for (const r of [cautious, fastpay]) {
      expect(r.status).toBe("completed");
      expect(r.processed).toBe(1000);
      const matrixTotal = Object.values(r.confusion).reduce((s: number, row: any) => s + Object.values(row).reduce((a: number, b: any) => a + b, 0), 0);
      expect(matrixTotal).toBe(1000);
      expect(r.worstErrors.length).toBe(20);
      expect(r.worstErrors[0].kind).toBe("mis_approved");
      // Ordered: worse kinds first, larger amounts first within a kind.
      const firstReject = r.worstErrors.findIndex((w: any) => w.kind !== "mis_approved");
      if (firstReject > 1) expect(r.worstErrors[0].amountMinor).toBeGreaterThanOrEqual(r.worstErrors[firstReject - 1].amountMinor);
    }
    // The two error profiles are visibly different.
    expect(cautious.accuracy).toBeGreaterThan(0.9);
    expect(fastpay.accuracy).toBeLessThan(cautious.accuracy);
    expect(fastpay.money.misApprovedMinor).toBeGreaterThan(cautious.money.misApprovedMinor);
    expect(cautious.money.unnecessaryEscalationCount).toBeGreaterThan(fastpay.money.unnecessaryEscalationCount);
    // Money is reported in integer minor units and adds up.
    expect(Number.isInteger(cautious.money.misApprovedMinor)).toBe(true);
    expect(cautious.money.caughtByRulesMinor + cautious.money.misApprovedAfterRulesMinor).toBe(cautious.money.misApprovedMinor);
  });

  it("is deterministic: the same agent on the same set gives the same answers", async () => {
    const res = await call(startComparison, { user: "controller", body: { datasetId, agentIds: [DEMO.agents.cautious.id] } });
    await runReplay(res.data.comparison.runs[0].id);
    const again = await call(getComparison, { user: "controller", params: { id: res.data.comparison.id } });
    const first = (await db.replayRun.findMany({ where: { agentId: DEMO.agents.cautious.id, status: "completed" }, orderBy: { createdAt: "asc" } }))[0];
    const firstReport = await call(getComparison, { user: "controller", params: { id: first.comparisonId } });
    expect(again.data.reports[0].accuracy).toBe(firstReport.data.reports[0].accuracy);
  });

  it("records a replay.completed audit record and keeps the chain valid", async () => {
    expect(await db.auditRecord.count({ where: { eventType: "replay.completed" } })).toBe(3);
    expect((await verifyChain(DEMO.orgId)).ok).toBe(true);
  });

  it("works with a webhook agent over the signed HTTP contract", async () => {
    const webhook = await db.agent.create({
      data: {
        organisationId: DEMO.orgId, name: "Webhook copy of Fast-Pay", kind: "webhook", signingSecret: DEMO.agents.fastpay.signingSecret,
        endpointUrl: `http://localhost:3000/api/mock-agents/${DEMO.agents.fastpay.id}/decide`, apiKeyHash: hashApiKey("cr_test_webhook"), apiKeyPrefix: "cr_test_webh",
      },
    });
    const sampleCase = await db.replayCase.findFirstOrThrow({ where: { datasetId }, orderBy: { rowNumber: "asc" } });
    const answer = await callWebhookAgent(webhook, sampleCase.payload as any, inProcessFetch);
    expect(["approve", "reject", "escalate"]).toContain(answer.decision);

    const bad = await callWebhookAgent({ ...webhook, signingSecret: "wrong" }, sampleCase.payload as any, inProcessFetch).catch((e) => e);
    expect(String(bad)).toContain("HTTP 401");
  });

  it("records agent failures as 'no answer' instead of failing the run", async () => {
    const broken = await db.agent.create({
      data: { organisationId: DEMO.orgId, name: "Broken agent", kind: "webhook", signingSecret: "s", endpointUrl: "http://127.0.0.1:9/nothing", apiKeyHash: hashApiKey("cr_test_broken"), apiKeyPrefix: "cr_test_brok" },
    });
    const small = await call(uploadDataset, { method: "POST", user: "controller", rawBody: csvForm(csv.split("\n").slice(0, 6).join("\n") + "\n", "Five invoices") });
    const res = await call(startComparison, { user: "controller", body: { datasetId: small.data.dataset.id, agentIds: [broken.id] } });
    await runReplay(res.data.comparison.runs[0].id);
    const report = await call(getComparison, { user: "controller", params: { id: res.data.comparison.id } });
    expect(report.data.reports[0]).toMatchObject({ status: "completed", agentErrors: 5, accuracy: 0 });
    expect(report.data.reports[0].worstErrors[0].kind).toBe("no_answer");
  });
});
