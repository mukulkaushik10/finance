import { beforeAll, describe, expect, it } from "vitest";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { createHash } from "node:crypto";
import { GET as verify } from "@/app/api/audit/verify/route";
import { GET as records } from "@/app/api/audit/records/route";
import { GET as exportPack } from "@/app/api/audit/export/route";
import { POST as evaluate } from "@/app/v1/actions/evaluate/route";
import { POST as review } from "@/app/api/actions/[id]/review/route";
import { PUT as putRule, } from "@/app/api/rules/[id]/route";
import { POST as createRule } from "@/app/api/rules/route";
import { POST as autonomyPost } from "@/app/api/workflows/[id]/autonomy/route";
import { PATCH as workflowPatch } from "@/app/api/workflows/[id]/route";
import { POST as uploadDataset } from "@/app/api/replay/datasets/route";
import { POST as startComparison } from "@/app/api/replay/comparisons/route";
import { DEMO, seedBase } from "@/server/seed/demo";
import { forOrg } from "@/server/db/dal";
import { rawPrisma } from "@/server/db/client";
import { call, cleanInvoice } from "../helpers/api";

const KEY = DEMO.agents.cautious.apiKey;
const db = forOrg(DEMO.orgId);
let reviewedId = "";

async function unzip(bytes: string | ArrayBuffer) {
  return JSZip.loadAsync(bytes as ArrayBuffer);
}
async function download(path: string, user: "auditor" | "controller" = "auditor") {
  const req = new Request(`http://localhost${path}`, { headers: { cookie: (await import("@/server/auth/session")).SESSION_COOKIE + "=" + await (await import("@/server/auth/session")).createSessionToken(DEMO.users[user].id) } });
  const res = await exportPack(req, { params: Promise.resolve({}) });
  return { res, bytes: res.ok ? await res.arrayBuffer() : null };
}

/** Tamper the way a DBA could: bypass triggers as superuser and edit a record in place. */
async function tamper(seq: number, mutate: (p: any) => void) {
  const rec = await rawPrisma.auditRecord.findFirstOrThrow({ where: { organisationId: DEMO.orgId, seq } });
  const payload = structuredClone(rec.payload) as any;
  mutate(payload);
  await rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`UPDATE "AuditRecord" SET payload = $1::jsonb WHERE id = $2`, JSON.stringify(payload), rec.id);
  });
  return rec;
}
async function restore(rec: { id: string; payload: unknown }) {
  await rawPrisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
    await tx.$executeRawUnsafe(`UPDATE "AuditRecord" SET payload = $1::jsonb WHERE id = $2`, JSON.stringify(rec.payload), rec.id);
  });
}

beforeAll(async () => {
  await seedBase({ csvDir: "/tmp/control-room-test-seed", level: 2 });
  for (const amount of [120_000, 700_000, 900_000]) {
    const { body } = await cleanInvoice({ amountMinor: amount });
    const res = await call(evaluate, { body, apiKey: KEY });
    if (res.data.status === "pending_review" && !reviewedId) {
      reviewedId = res.data.action_id;
      await call(review, { user: "controller", params: { id: reviewedId }, body: { decision: "approve", reason: "Checked against the PO and receipt" } });
    }
  }
});

describe("verify chain (acceptance 4)", () => {
  it("passes on clean data", async () => {
    const res = await call(verify, { user: "auditor" });
    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ ok: true, problems: [] });
    expect(res.data.checked).toBeGreaterThan(5);
    expect(res.data.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("flags a record edited directly in the database, naming the record", async () => {
    const target = await db.auditRecord.findFirstOrThrow({ where: { eventType: "action.evaluated" }, orderBy: { seq: "asc" } });
    const original = await tamper(target.seq, (p) => { p.inputs.amount.minor = 1; });
    const res = await call(verify, { user: "auditor" });
    expect(res.data.ok).toBe(false);
    expect(res.data.problems[0]).toMatchObject({ seq: target.seq, recordId: target.id });
    expect(res.data.problems[0].problem).toContain(`Record #${target.seq} was changed`);
    await restore(original);
    expect((await call(verify, { user: "auditor" })).data.ok).toBe(true);
  });

  it("flags a re-hashed record because the next record no longer links to it", async () => {
    const target = await db.auditRecord.findFirstOrThrow({ where: { eventType: "action.evaluated" }, orderBy: { seq: "asc" } });
    const { computeHash } = await import("@/server/audit/chain");
    const payload = { ...(target.payload as object), tampered: true };
    const newHash = computeHash({ ...target, payload });
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`UPDATE "AuditRecord" SET payload = $1::jsonb, hash = $2 WHERE id = $3`, JSON.stringify(payload), newHash, target.id);
    });
    const res = await call(verify, { user: "auditor" });
    expect(res.data.ok).toBe(false);
    expect(res.data.problems[0].problem).toContain(`Record #${target.seq + 1} does not link`);
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`UPDATE "AuditRecord" SET payload = $1::jsonb, hash = $2 WHERE id = $3`, JSON.stringify(target.payload), target.hash, target.id);
    });
  });

  it("flags a deleted record", async () => {
    const target = await db.auditRecord.findFirstOrThrow({ where: { eventType: "rule.created" }, orderBy: { seq: "desc" } });
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.$executeRawUnsafe(`DELETE FROM "AuditRecord" WHERE id = $1`, target.id);
    });
    const res = await call(verify, { user: "auditor" });
    expect(res.data.ok).toBe(false);
    expect(res.data.problems[0].problem).toContain(`Record #${target.seq} is missing`);
    await rawPrisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = replica");
      await tx.auditRecord.create({ data: { ...target, payload: target.payload as object } });
    });
    expect((await call(verify, { user: "auditor" })).data.ok).toBe(true);
  });
});

describe("audit records", () => {
  it("lists records newest first with plain-language summaries and filters by entity", async () => {
    const res = await call(records, { user: "auditor", path: `/api/audit/records?entity=${reviewedId}` });
    expect(res.status).toBe(200);
    expect(res.data.rows.map((r: { eventType: string }) => r.eventType)).toEqual(["action.reviewed", "action.evaluated"]);
    expect(res.data.rows[0].summary).toBe("Dana Whitfield approved: “Checked against the PO and receipt”");
    expect(res.data.rows[0].actorName).toBe("Dana Whitfield");
  });
  it("requires sign-in", async () => {
    expect((await call(records, {})).status).toBe(401);
  });
});

describe("evidence packs (acceptance 5)", () => {
  it("exports one action: PDF summary, CSVs, verification and a manifest whose hashes match", async () => {
    const { res, bytes } = await download(`/api/audit/export?actionId=${reviewedId}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/zip");
    expect(res.headers.get("content-disposition")).toMatch(/attachment; filename="evidence-pack_action-T-\d+\.zip"/);
    const zip = await unzip(bytes!);
    expect(Object.keys(zip.files).sort()).toEqual(["actions.csv", "audit_records.csv", "chain_verification.json", "manifest.json", "reviews.csv", "rule_results.csv", "summary.pdf"]);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    for (const f of manifest.files) {
      const content = await zip.file(f.name)!.async("uint8array");
      expect(createHash("sha256").update(content).digest("hex"), f.name).toBe(f.sha256);
    }
    const actionsCsv = await zip.file("actions.csv")!.async("string");
    expect(actionsCsv.trim().split("\r\n")).toHaveLength(2);
    expect(actionsCsv).toContain("Dana Whitfield");
    expect(actionsCsv).toContain("Checked against the PO and receipt");
    expect((await zip.file("rule_results.csv")!.async("string")).trim().split("\r\n")).toHaveLength(6);
    const verification = JSON.parse(await zip.file("chain_verification.json")!.async("string"));
    expect(verification.wholeChain.ok).toBe(true);
    expect(verification.recordsInThisPack).toMatchObject({ count: 2, allHashesRecomputeCorrectly: true });
    const pdf = await PDFDocument.load(await zip.file("summary.pdf")!.async("uint8array"));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(1);
    expect(pdf.getTitle()).toContain("Single invoice");
  });

  it("exports one month for the whole organisation", async () => {
    const today = new Date();
    const ym = today.toISOString().slice(0, 7);
    const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
    const { res, bytes } = await download(`/api/audit/export?from=${ym}-01&to=${ym}-${last}`);
    expect(res.status).toBe(200);
    const zip = await unzip(bytes!);
    const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
    expect(manifest.counts.actions).toBeGreaterThanOrEqual(3);
    expect(manifest.generatedBy.role).toBe("auditor");
    const audit = await zip.file("audit_records.csv")!.async("string");
    expect(audit).toContain("rule.created");
    expect(audit).toContain("action.reviewed");
  });

  it("exports by vendor", async () => {
    const vendor = (await db.action.findFirstOrThrow({ where: { id: reviewedId } })).counterpartyKey;
    const today = new Date().toISOString().slice(0, 10);
    const { res, bytes } = await download(`/api/audit/export?from=2020-01-01&to=${today}&vendor=${vendor}`);
    expect(res.status).toBe(200);
    const csv = await (await unzip(bytes!)).file("actions.csv")!.async("string");
    const rows = csv.trim().split("\r\n").slice(1);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("records the export itself in the audit trail", async () => {
    expect(await db.auditRecord.count({ where: { eventType: "evidence.exported", actorId: DEMO.users.auditor.id } })).toBeGreaterThanOrEqual(3);
  });

  it("validates the scope", async () => {
    expect((await download(`/api/audit/export?from=2026-10-31&to=2026-10-01`)).res.status).toBe(400);
    expect((await download(`/api/audit/export?actionId=nope`)).res.status).toBe(404);
    expect((await download(`/api/audit/export`)).res.status).toBe(422);
  });

  it("acceptance 5: an auditor cannot edit anything", async () => {
    const rule = await db.rule.findFirstOrThrow({ where: { workflowId: DEMO.workflowId } });
    const { body } = await cleanInvoice({ amountMinor: 800_000 });
    const pending = (await call(evaluate, { body, apiKey: KEY })).data.action_id;
    const fd = new FormData();
    fd.set("csv", new File(["invoice_id\n"], "x.csv"));
    const attempts = [
      call(putRule, { method: "PUT", user: "auditor", params: { id: rule.id }, body: { changeNote: "auditor edit", enabled: false } }),
      call(createRule, { user: "auditor", body: { workflowId: DEMO.workflowId, name: "x", severity: "review", params: {} } }),
      call(review, { user: "auditor", params: { id: pending }, body: { decision: "approve", reason: "auditor approving this" } }),
      call(autonomyPost, { user: "auditor", params: { id: DEMO.workflowId }, body: { toLevel: 1, reason: "auditor change level" } }),
      call(workflowPatch, { method: "PATCH", user: "auditor", params: { id: DEMO.workflowId }, body: { autoApproveLimitMinor: 1, reason: "auditor change limit" } }),
      call(uploadDataset, { method: "POST", user: "auditor", rawBody: fd }),
      call(startComparison, { user: "auditor", body: { datasetId: "x", agentIds: [DEMO.agents.cautious.id] } }),
    ];
    const results = await Promise.all(attempts);
    expect(results.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    // Nothing changed.
    expect((await db.action.findFirstOrThrow({ where: { id: pending } })).status).toBe("pending_review");
    expect((await db.workflow.findFirstOrThrow({ where: { id: DEMO.workflowId } })).autonomyLevel).toBe(2);
  });
});
