import { beforeAll, describe, expect, it } from "vitest";
import { GET as listRules, POST as createRule } from "@/app/api/rules/route";
import { PUT as putRule } from "@/app/api/rules/[id]/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as evaluate } from "@/app/v1/actions/evaluate/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { call, cleanInvoice } from "../helpers/api";

const db = forOrg(DEMO.orgId);
const ruleOf = (type: "approval_limit" | "bank_details_change" | "three_way_match") =>
  db.rule.findFirstOrThrow({ where: { workflowId: DEMO.workflowId, type } });

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed", level: 3 });
});

describe("auth", () => {
  it("signs in with the right password and sets an HttpOnly session cookie", async () => {
    const res = await call(login, { body: { email: DEMO.users.controller.email, password: DEMO.password } });
    expect(res.status).toBe(200);
    expect(res.data.user.role).toBe("controller");
    expect(res.headers.get("set-cookie")).toMatch(/cr_session=.+HttpOnly/);
  });
  it("rejects a wrong password without saying which part was wrong", async () => {
    const res = await call(login, { body: { email: DEMO.users.controller.email, password: "nope" } });
    expect(res.status).toBe(401);
    expect(res.data.error.message).toBe("Email or password is incorrect");
  });
  it("sign-out clears the cookie", async () => {
    const res = await call(logout, { method: "POST", user: "controller" });
    expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
  });
});

describe("GET /api/rules", () => {
  it("requires sign-in", async () => {
    expect((await call(listRules, { path: `/api/rules?workflowId=${DEMO.workflowId}` })).status).toBe(401);
  });
  it("lists the five default rules with plain-language summaries, for any role including auditors", async () => {
    const res = await call(listRules, { path: `/api/rules?workflowId=${DEMO.workflowId}`, user: "auditor" });
    expect(res.status).toBe(200);
    expect(res.data.rules.map((r: { type: string }) => r.type)).toEqual([
      "blocked_vendor", "bank_details_change", "duplicate_invoice", "three_way_match", "approval_limit",
    ]);
    expect(res.data.rules[1]).toMatchObject({ locked: true, version: 1 });
  });
});

describe("PUT /api/rules/{id}", () => {
  it("auditors cannot edit rules", async () => {
    const rule = await ruleOf("three_way_match");
    const res = await call(putRule, { method: "PUT", user: "auditor", params: { id: rule.id }, body: { changeNote: "try", params: {} } });
    expect(res.status).toBe(403);
  });
  it("requires a reason for the change", async () => {
    const rule = await ruleOf("three_way_match");
    const res = await call(putRule, { method: "PUT", user: "controller", params: { id: rule.id }, body: { params: rule } });
    expect(res.status).toBe(422);
  });
  it("rejects invalid settings with a readable message", async () => {
    const rule = await ruleOf("three_way_match");
    const res = await call(putRule, { method: "PUT", user: "controller", params: { id: rule.id }, body: { changeNote: "bad", params: { amountToleranceBps: -5 } } });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toBe("Some rule settings are invalid");
  });
  it("refuses to switch off a mandatory control", async () => {
    const rule = await ruleOf("bank_details_change");
    const res = await call(putRule, { method: "PUT", user: "admin", params: { id: rule.id }, body: { changeNote: "turn off", enabled: false } });
    expect(res.status).toBe(400);
    expect(res.data.error.message).toContain("mandatory control");
  });
  it("saves a new immutable version and writes a rule.changed audit record with before/after", async () => {
    const rule = await ruleOf("three_way_match");
    const res = await call(putRule, {
      method: "PUT", user: "controller", params: { id: rule.id },
      body: { changeNote: "Allow 2% freight variance", params: { amountToleranceBps: 200, quantityToleranceBps: 0, requirePo: true } },
    });
    expect(res.status).toBe(200);
    expect(res.data.version).toMatchObject({ version: 2, summary: expect.stringContaining("more than 2.0%") });
    const versions = await db.ruleVersion.findMany({ where: { ruleId: rule.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => (v.params as { amountToleranceBps: number }).amountToleranceBps)).toEqual([500, 200]);
    const audit = await db.auditRecord.findFirstOrThrow({ where: { entityId: rule.id, eventType: "rule.changed" } });
    expect(audit.actorId).toBe(DEMO.users.controller.id);
    expect((audit.payload as any).before.params.amountToleranceBps).toBe(500);
    expect((audit.payload as any).after.params.amountToleranceBps).toBe(200);
  });
  it("404s for a rule in another organisation", async () => {
    await rawPrisma.organisation.create({ data: { id: "org_x", name: "X" } });
    await rawPrisma.workflow.create({ data: { id: "wf_x", organisationId: "org_x", type: "ap_invoice", name: "X AP" } });
    const foreign = await rawPrisma.rule.create({ data: { organisationId: "org_x", workflowId: "wf_x", type: "blocked_vendor", name: "X rule" } });
    await rawPrisma.ruleVersion.create({ data: { organisationId: "org_x", ruleId: foreign.id, version: 1, enabled: true, severity: "block", params: { additionalBlockedNames: [] }, summary: "x" } });
    const res = await call(putRule, { method: "PUT", user: "controller", params: { id: foreign.id }, body: { changeNote: "cross-tenant attempt", enabled: false } });
    expect(res.status).toBe(404);
    expect(await rawPrisma.ruleVersion.count({ where: { ruleId: foreign.id } })).toBe(1);
  });
});

describe("POST /api/rules (custom rule)", () => {
  it("creates a custom rule that takes effect on the next evaluate call", async () => {
    const { body } = await cleanInvoice({ amountMinor: 300_000 });
    const before = await call(evaluate, { body, apiKey: DEMO.agents.cautious.apiKey });
    expect(before.data.outcome).toBe("auto_approve");

    const res = await call(createRule, {
      user: "controller",
      body: {
        workflowId: DEMO.workflowId, name: "Second look over $2,500", severity: "review",
        params: { match: "all", conditions: [{ field: "amount", operator: "gt", value: "250000" }], message: "Over $2,500 needs a second look", requiredApprover: "controller" },
      },
    });
    expect(res.status).toBe(201);

    const { body: body2 } = await cleanInvoice({ amountMinor: 300_000 });
    const after = await call(evaluate, { body: body2, apiKey: DEMO.agents.cautious.apiKey });
    expect(after.data.outcome).toBe("needs_human");
    expect(after.data.reasons).toContain("Over $2,500 needs a second look");
    expect(after.data.required_approver).toBe("controller");
  });
  it("validates the condition builder", async () => {
    const res = await call(createRule, {
      user: "controller",
      body: { workflowId: DEMO.workflowId, name: "Broken", severity: "review", params: { match: "all", conditions: [{ field: "amount", operator: "contains", value: "x" }], message: "x y z", requiredApprover: null } },
    });
    expect(res.status).toBe(400);
  });
  it("auditors cannot create rules", async () => {
    const res = await call(createRule, { user: "auditor", body: { workflowId: DEMO.workflowId, name: "x", severity: "review", params: {} } });
    expect(res.status).toBe(403);
  });
});
