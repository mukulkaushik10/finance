import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { GET as openapi } from "@/app/api/openapi.json/route";
import { GET as scorecard } from "@/app/api/scorecard/route";
import { GET as listActions } from "@/app/api/actions/route";
import { GET as listAgents, POST as createAgent } from "@/app/api/agents/route";
import { PATCH as patchAgent } from "@/app/api/agents/[id]/route";
import { GET as listVendors } from "@/app/api/vendors/route";
import { PATCH as patchVendor } from "@/app/api/vendors/[id]/route";
import { GET as listUsers, POST as createUser } from "@/app/api/users/route";
import { PATCH as patchUser } from "@/app/api/users/[id]/route";
import { PUT as putConnector } from "@/app/api/workflows/[id]/connector/route";
import { POST as evaluate } from "@/app/v1/actions/evaluate/route";
import { POST as login } from "@/app/api/auth/login/route";
import { DOCUMENTED_OPERATIONS } from "@/server/openapi";
import { DEMO, seedBase } from "@/server/seed/demo";
import { seedLiveHistory } from "@/server/seed/live-history";
import { forOrg } from "@/server/db/dal";
import { call, cleanInvoice } from "../helpers/api";

const db = forOrg(DEMO.orgId);

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? routeFiles(p) : f === "route.ts" ? [p] : [];
  });
}

describe("OpenAPI", () => {
  it("documents every API endpoint in the codebase, and nothing that doesn't exist", () => {
    const appDir = path.join(process.cwd(), "src/app");
    const actual = routeFiles(appDir)
      .filter((f) => !f.includes(`${path.sep}api-docs${path.sep}`))
      .flatMap((f) => {
        const apiPath = "/" + path.relative(appDir, path.dirname(f)).split(path.sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
        const src = readFileSync(f, "utf8");
        return [...src.matchAll(/export (?:const|async function|function) (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => `${m[1].toLowerCase()} ${apiPath}`);
      })
      .sort();
    const documented = DOCUMENTED_OPERATIONS.map((o) => `${o.method} ${o.path}`).sort();
    expect(documented).toEqual(actual);
  });

  it("serves a valid OpenAPI 3 document with request and response schemas", async () => {
    const res = await call(openapi, {});
    expect(res.status).toBe(200);
    expect(res.data.openapi).toBe("3.0.3");
    const evalOp = res.data.paths["/v1/actions/evaluate"].post;
    expect(evalOp.security).toEqual([{ agentKey: [] }]);
    expect(evalOp.requestBody.content["application/json"].schema).toBeTruthy();
    expect(Object.keys(evalOp.responses)).toEqual(expect.arrayContaining(["201", "401", "422"]));
    expect(res.data.components.schemas.EvaluateRequest.properties.subject).toBeTruthy();
  });
});

describe("scorecard", () => {
  beforeAll(async () => {
    await seedBase({ csvDir: "/tmp/control-room-test-seed" });
    await seedLiveHistory({ count: 160 });
  }, 120_000);

  it("returns 8 weeks, and every headline number matches its drill-down list exactly", async () => {
    const res = await call(scorecard, { user: "controller", path: "/api/scorecard" });
    expect(res.status).toBe(200);
    expect(res.data.weeks).toHaveLength(8);
    const w = res.data.selected;
    expect(w.partial).toBe(false);
    const drill = async (href: string) => (await call(listActions, { user: "controller", path: href.replace("/actions", "/api/actions") + "&pageSize=500" })).data;

    expect((await drill(res.data.links.volume)).total).toBe(w.volume);
    expect((await drill(res.data.links.escalation)).total).toBe(w.escalated);
    const auto = await drill(res.data.links.autoApproved);
    expect(auto.total).toBe(w.autoApproved);
    expect(auto.totalAmountMinor).toBe(w.autoApprovedMinor);
    const risk = await drill(res.data.links.moneyAtRisk);
    expect(risk.total).toBe(w.moneyAtRiskCount);
    expect(risk.totalAmountMinor).toBe(w.moneyAtRiskMinor);
    const reviewed = await drill(res.data.links.accuracy);
    expect(reviewed.total).toBe(w.reviewed);
    const wrong = await drill(res.data.links.agentWrong);
    expect(wrong.total).toBe(w.reviewed - w.agentCorrect);
  });

  it("totals across weeks add up to all live actions in the period", async () => {
    const res = await call(scorecard, { user: "auditor", path: "/api/scorecard?weeks=8" });
    const sum = res.data.weeks.reduce((s: number, x: { volume: number }) => s + x.volume, 0);
    const first = new Date(res.data.weeks[0].weekStart + "T00:00:00Z");
    expect(sum).toBe(await db.action.count({ where: { source: "live", createdAt: { gte: first } } }));
  });

  it("does not count approval-limit routing as money at risk", async () => {
    const risky = await call(listActions, { user: "controller", path: "/api/actions?flag=money_at_risk&pageSize=500" });
    for (const row of risky.data.rows) {
      expect(row.ruleResults.some((r: { ruleName: string }) => r.ruleName !== "Approval limits")).toBe(true);
    }
  });

  it("lets you pick a week and validates the query", async () => {
    const res = await call(scorecard, { user: "controller", path: "/api/scorecard" });
    const pick = res.data.weeks[2].weekStart;
    const picked = await call(scorecard, { user: "controller", path: `/api/scorecard?week=${pick}` });
    expect(picked.data.selected.weekStart).toBe(pick);
    expect((await call(scorecard, { user: "controller", path: "/api/scorecard?weeks=99" })).status).toBe(422);
  });
});

describe("settings (admin)", () => {
  it("only admins can change settings; controllers can view", async () => {
    expect((await call(listAgents, { user: "controller" })).status).toBe(200);
    expect((await call(createAgent, { user: "controller", body: { name: "X", kind: "mock", mockConfig: { profile: "cautious", errorRate: 0.1, seed: "x" } } })).status).toBe(403);
    expect((await call(listAgents, { user: "auditor" })).status).toBe(403);
  });

  it("connects a webhook agent; its one-time API key works, and rotating it revokes the old key", async () => {
    const res = await call(createAgent, { user: "admin", body: { name: "Vendor X AP bot", vendorName: "Vendor X", kind: "webhook", endpointUrl: "https://agent.example/decide" } });
    expect(res.status).toBe(201);
    expect(res.data.apiKey).toMatch(/^cr_live_/);
    expect(res.data.signingSecret).toMatch(/^whsec_/);
    expect(JSON.stringify((await call(listAgents, { user: "admin" })).data)).not.toContain(res.data.apiKey);
    const { body } = await cleanInvoice();
    expect((await call(evaluate, { body, apiKey: res.data.apiKey })).status).toBe(201);
    const rotated = await call(patchAgent, { method: "PATCH", user: "admin", params: { id: res.data.agent.id }, body: { rotateKey: true } });
    expect(rotated.data.apiKey).toMatch(/^cr_live_/);
    const { body: b2 } = await cleanInvoice();
    expect((await call(evaluate, { body: b2, apiKey: res.data.apiKey })).status).toBe(401);
    expect((await call(evaluate, { body: b2, apiKey: rotated.data.apiKey })).status).toBe(201);
    expect(await db.auditRecord.count({ where: { entityId: res.data.agent.id, eventType: { in: ["agent.created", "agent.changed"] } } })).toBe(2);
  });

  it("validates agent setup", async () => {
    const res = await call(createAgent, { user: "admin", body: { name: "No URL", kind: "webhook" } });
    expect(res.status).toBe(422);
    expect(res.data.error.details[0].message).toContain("endpoint URL");
  });

  it("changes a demo agent's error rate", async () => {
    const res = await call(patchAgent, { method: "PATCH", user: "admin", params: { id: DEMO.agents.fastpay.id }, body: { mockConfig: { profile: "fast_pay", errorRate: 0.2, seed: "fastpay-v1" } } });
    expect(res.status).toBe(200);
    expect(res.data.agent.mockConfig.errorRate).toBe(0.2);
  });

  it("blocking a vendor stops its next invoice", async () => {
    const { body, vendor } = await cleanInvoice();
    expect((await call(evaluate, { body, apiKey: DEMO.agents.cautious.apiKey })).data.outcome).not.toBe("block");
    const res = await call(patchVendor, { method: "PATCH", user: "admin", params: { id: vendor.id }, body: { blocked: true, blockedReason: "Bank account frozen", reason: "Notice from treasury" } });
    expect(res.status).toBe(200);
    const b2 = { ...body, subject: { ...body.subject, invoice_id: body.subject.invoice_id + "-2", invoice_number: body.subject.invoice_id + "-2", amount: { minor: body.subject.amount.minor + 1, currency: "USD" } } };
    expect((await call(evaluate, { body: b2, apiKey: DEMO.agents.cautious.apiKey })).data.outcome).toBe("block");
    const vendors = await call(listVendors, { user: "admin", path: `/api/vendors?q=${vendor.code}` });
    expect(vendors.data.vendors[0]).toMatchObject({ blocked: true, blockedReason: "Bank account frozen" });
  });

  it("recording a bank detail change sends the vendor's next invoice to a person", async () => {
    const { body, vendor } = await cleanInvoice();
    await call(patchVendor, { method: "PATCH", user: "admin", params: { id: vendor.id }, body: { blocked: false, reason: "Treasury cleared it" } });
    await call(patchVendor, { method: "PATCH", user: "admin", params: { id: vendor.id }, body: { bankDetailsChanged: true, reason: "Vendor letter received" } });
    const res = await call(evaluate, { body, apiKey: DEMO.agents.cautious.apiKey });
    expect(res.data.outcome).toBe("needs_human");
    expect(res.data.reasons.join(" ")).toMatch(/bank details/);
  });

  it("adds users, changes roles, and won't let an admin lock themselves out", async () => {
    const res = await call(createUser, { user: "admin", body: { name: "Robin Reviewer", email: "Robin@harborpine.example", role: "reviewer", password: "longenough1" } });
    expect(res.status).toBe(201);
    expect(res.data.user.email).toBe("robin@harborpine.example");
    expect((await call(login, { body: { email: "robin@harborpine.example", password: "longenough1" } })).status).toBe(200);
    expect((await call(createUser, { user: "admin", body: { name: "Dup", email: "robin@harborpine.example", role: "reviewer", password: "longenough1" } })).status).toBe(409);
    expect((await call(patchUser, { method: "PATCH", user: "admin", params: { id: res.data.user.id }, body: { role: "controller" } })).data.user.role).toBe("controller");
    expect((await call(patchUser, { method: "PATCH", user: "admin", params: { id: DEMO.users.admin.id }, body: { role: "auditor" } })).status).toBe(400);
    expect((await call(listUsers, { user: "admin" })).data.users.length).toBeGreaterThanOrEqual(4);
  });

  it("switches the system-of-record connector", async () => {
    const res = await call(putConnector, { method: "PUT", user: "admin", params: { id: DEMO.workflowId }, body: { erpConnector: "fake_netsuite" } });
    expect(res.data.workflow.erpConnector).toBe("fake_netsuite");
    expect((await call(putConnector, { method: "PUT", user: "admin", params: { id: DEMO.workflowId }, body: { erpConnector: "sap" } })).status).toBe(422);
  });
});
