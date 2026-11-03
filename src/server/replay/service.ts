import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { forOrg, type OrgDb } from "../db/dal";
import { rawPrisma } from "../db/client";
import { requirePermission, type Ctx } from "../auth/session";
import { badRequest, notFound } from "../errors";
import { parseReplayCsv, type CsvIssue } from "./csv";
import { storeFile } from "../storage";
import { agentConnector } from "../agents/connector";
import { loadActiveRules } from "../rules/load";
import { evaluateRules, ruleSetVersion } from "../rules/engine";
import { decideGate } from "../gate/decide";
import { buildInvoiceContext, vendorKeyOf, type ContextLookup } from "../workflows/ap_invoice/context";
import { invoiceNumberOf, type InvoiceSubject } from "../workflows/ap_invoice/subject";
import { toVendorRecord } from "../connectors/erp";
import type { PriorInvoice, VendorRecord } from "../rules/types";
import { appendAudit } from "../audit/chain";
import { enqueue, QUEUES } from "../jobs/queue";
import { computeRunReport } from "./report";

// ---------------------------------------------------------------- datasets

export interface UploadInput {
  name: string;
  csvText: string;
  pdfs?: { filename: string; contentType: string; bytes: Uint8Array }[];
}

export async function createDataset(ctx: Ctx, workflowId: string, input: UploadInput) {
  requirePermission(ctx, "replay:run");
  const db = forOrg(ctx.organisationId);
  const wf = await db.workflow.findFirst({ where: { id: workflowId } });
  if (!wf) throw notFound("Workflow");
  const { cases, errors, columns } = parseReplayCsv(input.csvText);
  if (!cases.length) throw badRequest("No usable rows in this file", errors.slice(0, 50));

  // Match vendors to the vendor master so rules and agents can look them up.
  const vendors = await db.vendor.findMany({ select: { code: true, name: true } });
  const byName = new Map(vendors.map((v) => [v.name.toLowerCase(), v.code]));
  const codes = new Set(vendors.map((v) => v.code));
  const warnings: CsvIssue[] = [...errors];
  let unknownVendors = 0;
  for (const c of cases) {
    if (c.subject.vendor_id && codes.has(c.subject.vendor_id)) continue;
    const code = byName.get(c.subject.vendor_name.toLowerCase());
    if (code) c.subject.vendor_id = code;
    else { c.subject.vendor_id = undefined; unknownVendors++; }
  }
  if (unknownVendors) warnings.push({ row: 0, message: `${unknownVendors} invoice(s) name a vendor that isn't in the vendor master` });

  // Optional PDFs, matched by file name = invoice_id (e.g. INV-10432.pdf).
  const fileIdByInvoice = new Map<string, string>();
  for (const pdf of input.pdfs ?? []) {
    const stem = pdf.filename.replace(/\.[^.]+$/, "");
    if (!cases.some((c) => c.subject.invoice_id === stem)) {
      warnings.push({ row: 0, message: `${pdf.filename} doesn't match any invoice_id` });
      continue;
    }
    const f = await storeFile(ctx.organisationId, pdf);
    fileIdByInvoice.set(stem, f.id);
  }

  const dataset = await db.$transaction(async (tx) => {
    const ds = await tx.replayDataset.create({
      data: { organisationId: ctx.organisationId, workflowId, name: input.name, uploadedById: ctx.user.id, rowCount: cases.length },
    });
    for (let i = 0; i < cases.length; i += 1000) {
      await tx.replayCase.createMany({
        data: cases.slice(i, i + 1000).map((c) => ({
          organisationId: ctx.organisationId, datasetId: ds.id, rowNumber: c.rowNumber, externalRef: c.subject.invoice_id,
          counterpartyName: c.subject.vendor_name, amountMinor: c.amountMinor, currency: c.subject.amount.currency,
          payload: c.subject as unknown as Prisma.InputJsonValue, expectedDecision: c.expectedDecision, expectedGlCode: c.expectedGlCode,
          fileId: fileIdByInvoice.get(c.subject.invoice_id) ?? null,
        })),
      });
    }
    return ds;
  }, { timeout: 60_000 });

  const mix = cases.reduce<Record<string, number>>((m, c) => ((m[c.expectedDecision] = (m[c.expectedDecision] ?? 0) + 1), m), {});
  return { dataset, imported: cases.length, skipped: errors.filter((e) => e.row > 0).length, warnings: warnings.slice(0, 100), columns, mix, pdfsAttached: fileIdByInvoice.size };
}

export async function listDatasets(ctx: Ctx) {
  requirePermission(ctx, "replay:view");
  const db = forOrg(ctx.organisationId);
  return db.replayDataset.findMany({
    orderBy: { createdAt: "desc" },
    include: { comparisons: { orderBy: { createdAt: "desc" }, include: { runs: { include: { agent: { select: { name: true } } } } } } },
  });
}

// ---------------------------------------------------------------- comparisons

export const StartComparisonSchema = z.object({
  datasetId: z.string(),
  agentIds: z.array(z.string()).min(1, "Choose at least one agent").max(3, "Compare up to three agents at a time"),
  name: z.string().max(120).optional(),
});

export async function startComparison(ctx: Ctx, input: unknown, opts: { enqueueRun?: (runId: string) => Promise<unknown> } = {}) {
  requirePermission(ctx, "replay:run");
  const data = StartComparisonSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const ds = await db.replayDataset.findFirst({ where: { id: data.datasetId } });
  if (!ds) throw notFound("Replay set");
  const ids = [...new Set(data.agentIds)];
  const agents = await db.agent.findMany({ where: { id: { in: ids }, active: true } });
  if (agents.length !== ids.length) throw badRequest("One of the chosen agents was not found or is switched off");
  const comparison = await db.replayComparison.create({
    data: {
      organisationId: ctx.organisationId, datasetId: ds.id, createdById: ctx.user.id,
      name: data.name || `${agents.map((a) => a.name).join(" vs ")}`,
      runs: {
        create: agents.map((a) => ({ organisationId: ctx.organisationId, agentId: a.id, agentVersion: a.version, totalCases: ds.rowCount })),
      },
    },
    include: { runs: true },
  });
  const send = opts.enqueueRun ?? ((runId: string) => enqueue(QUEUES.replayRun, { runId }));
  for (const run of comparison.runs) await send(run.id);
  return comparison;
}

// ---------------------------------------------------------------- runner

/** Replay lookups: vendor master + PO/GRN preloaded, duplicate history = earlier rows in the same set. */
async function memoryLookup(db: OrgDb, subjects: { rowNumber: number; subject: InvoiceSubject }[]): Promise<ContextLookup> {
  const vendors = (await db.vendor.findMany()).map(toVendorRecord);
  const byCode = new Map(vendors.map((v) => [v.code, v]));
  const byName = new Map(vendors.map((v) => [v.name.toLowerCase(), v]));
  const poNumbers = [...new Set(subjects.map((s) => s.subject.po_number).filter(Boolean))] as string[];
  const grnNumbers = [...new Set(subjects.map((s) => s.subject.grn_number).filter(Boolean))] as string[];
  const pos = new Map((await db.purchaseOrder.findMany({ where: { poNumber: { in: poNumbers } } })).map((p) => [p.poNumber, p]));
  const grns = new Map((await db.goodsReceipt.findMany({ where: { grnNumber: { in: grnNumbers } } })).map((g) => [g.grnNumber, g]));
  const vendorOf = (s: InvoiceSubject): VendorRecord | null =>
    (s.vendor_id ? byCode.get(s.vendor_id) : undefined) ?? byName.get(s.vendor_name.toLowerCase()) ?? null;

  const history = new Map<string, { rowNumber: number; prior: PriorInvoice }[]>();
  const rowOf = new Map<string, number>();
  for (const { rowNumber, subject } of subjects) {
    const key = vendorKeyOf(subject, vendorOf(subject));
    rowOf.set(subject.invoice_id, rowNumber);
    const list = history.get(key) ?? [];
    list.push({ rowNumber, prior: { ref: subject.invoice_id, invoiceNumber: invoiceNumberOf(subject), amountMinor: BigInt(subject.amount.minor), currency: subject.amount.currency, invoiceDate: subject.invoice_date } });
    history.set(key, list);
  }
  return {
    vendor: vendorOf,
    po: (n) => pos.get(n) ?? null,
    grn: (n) => grns.get(n) ?? null,
    priorInvoices: (key, s) => {
      const me = rowOf.get(s.invoice_id) ?? Infinity;
      return (history.get(key) ?? []).filter((h) => h.rowNumber < me).map((h) => h.prior);
    },
  };
}

async function pool<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** Run one agent over every case of a replay set. Called by the worker (or inline in tests). */
export async function runReplay(runId: string) {
  const runRow = await rawPrisma.replayRun.findUnique({ where: { id: runId } });
  if (!runRow) throw new Error(`Replay run ${runId} not found`);
  const db = forOrg(runRow.organisationId);
  const run = await db.replayRun.findFirstOrThrow({ where: { id: runId }, include: { agent: true, comparison: { include: { dataset: true } } } });
  if (run.status === "completed") return;
  const workflow = await db.workflow.findFirstOrThrow({ where: { id: run.comparison.dataset.workflowId } });

  try {
    await db.replayResult.deleteMany({ where: { runId } }); // safe re-run after a crash
    await db.replayRun.update({ where: { id: runId }, data: { status: "running", startedAt: new Date(), processedCases: 0, error: null } });
    const cases = await db.replayCase.findMany({ where: { datasetId: run.comparison.datasetId }, orderBy: { rowNumber: "asc" } });
    const subjects = cases.map((c) => ({ rowNumber: c.rowNumber, subject: c.payload as unknown as InvoiceSubject }));
    const lookup = await memoryLookup(db, subjects);
    const rules = await loadActiveRules(db, workflow.id);
    const ask = agentConnector(run.agent);
    const concurrency = run.agent.kind === "webhook" ? 8 : 4;

    const buffer: Prisma.ReplayResultCreateManyInput[] = [];
    let processed = 0;
    const flush = async () => {
      if (!buffer.length) return;
      const batch = buffer.splice(0, buffer.length);
      await db.replayResult.createMany({ data: batch });
      processed += batch.length;
      await db.replayRun.update({ where: { id: runId }, data: { processedCases: processed } });
    };

    await pool(cases, concurrency, async (c) => {
      const subject = c.payload as unknown as InvoiceSubject;
      const asOf = new Date(subject.invoice_date + "T12:00:00Z");
      const t0 = performance.now();
      let answer: Awaited<ReturnType<typeof ask>> | null = null;
      let error: string | null = null;
      try { answer = await ask(subject, lookup, asOf); } catch (e) { error = (e as Error).message.slice(0, 500); }
      const latencyMs = Math.round(performance.now() - t0);

      let gatedOutcome: Prisma.ReplayResultCreateManyInput["gatedOutcome"] = null;
      let failedRules: { name: string; explanation: string }[] = [];
      if (answer) {
        const confidenceBps = Math.round(answer.confidence * 10_000);
        const { ctx } = await buildInvoiceContext(subject, { decision: answer.decision, glCode: answer.gl_code, confidenceBps }, lookup, asOf);
        const results = evaluateRules(rules, ctx);
        failedRules = results.filter((r) => r.result === "fail").map((r) => ({ name: r.name, explanation: r.explanation }));
        // "With your rules": what Control Room would let through automatically (rules + confidence, as at Level 3).
        gatedOutcome = decideGate({
          level: 3, autoApproveLimitMinor: workflow.autoApproveLimitMinor, workflowCurrency: workflow.currency,
          confidenceThresholdBps: workflow.confidenceThresholdBps, proposedDecision: answer.decision, confidenceBps,
          amountMinor: ctx.amountMinor, currency: ctx.currency, ruleResults: results,
        }).computedOutcome;
      }
      buffer.push({
        organisationId: run.organisationId, runId, caseId: c.id,
        agentDecision: answer?.decision ?? null, agentGlCode: answer?.gl_code ?? null, agentReason: answer?.reason ?? null,
        agentConfidenceBps: answer ? Math.round(answer.confidence * 10_000) : null, error,
        decisionCorrect: answer?.decision === c.expectedDecision,
        glCorrect: answer && c.expectedDecision === "approve" && answer.decision === "approve" && c.expectedGlCode ? answer.gl_code === c.expectedGlCode : null,
        gatedOutcome, failedRules, latencyMs,
      });
      if (buffer.length >= 100) await flush();
    });
    await flush();

    await db.replayRun.update({ where: { id: runId }, data: { status: "completed", finishedAt: new Date(), processedCases: cases.length } });
    const report = await computeRunReport(db, runId);
    await db.$transaction((tx) => appendAudit(tx, run.organisationId, {
      eventType: "replay.completed", entityType: "replay_run", entityId: runId, actorType: "system", actorId: "replay-worker",
      payload: {
        dataset: { id: run.comparison.dataset.id, name: run.comparison.dataset.name, rows: cases.length },
        agent: { id: run.agent.id, name: run.agent.name, version: run.agentVersion },
        ruleSetVersion: ruleSetVersion(rules),
        summary: {
          accuracy: report.accuracy, moneyMisApprovedMinor: report.money.misApprovedMinor, moneyWronglyBlockedMinor: report.money.wronglyBlockedMinor,
          errors: report.agentErrors,
        },
      },
    }));
  } catch (e) {
    await db.replayRun.update({ where: { id: runId }, data: { status: "failed", error: (e as Error).message.slice(0, 1000), finishedAt: new Date() } });
    throw e;
  }
}
