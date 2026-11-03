import { createHash } from "node:crypto";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { forOrg } from "../db/dal";
import { rawPrisma } from "../db/client";
import { requirePermission, type Ctx } from "../auth/session";
import { badRequest, notFound } from "../errors";
import { actionWhere } from "../actions/query";
import { appendAudit, computeHash, verifyChain } from "./chain";
import { canonicalJson } from "./canonical";
import { formatMoney } from "@/lib/money";
import { formatDate, formatDateTime } from "@/lib/format";
import { OUTCOME_LABEL } from "../gate/decide";
import { isControlFailure } from "../rules/routing";
import { STATUS_LABEL } from "../actions/labels";

// Evidence pack: a ZIP with a PDF summary, CSVs of every action, rule result, review and
// audit record in scope, the chain verification result, and a manifest of file hashes.

export const EvidenceScopeSchema = z.union([
  z.object({ actionId: z.string().min(1) }),
  z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    vendor: z.string().optional(),
  }),
]);
export type EvidenceScope = z.infer<typeof EvidenceScopeSchema>;

const MAX_ACTIONS = 50_000;

export async function buildEvidencePack(ctx: Ctx, input: unknown) {
  requirePermission(ctx, "audit:export");
  const scope = EvidenceScopeSchema.parse(input);
  const db = forOrg(ctx.organisationId);
  const org = await rawPrisma.organisation.findUniqueOrThrow({ where: { id: ctx.organisationId } });
  const generatedAt = new Date();

  let where: Prisma.ActionWhereInput;
  let scopeLabel: string;
  let range: { start: Date; end: Date } | null = null;
  if ("actionId" in scope) {
    where = { id: scope.actionId };
    const a = await db.action.findFirst({ where, select: { id: true, externalRef: true } });
    if (!a) throw notFound("Action");
    scopeLabel = `Single invoice ${a.externalRef} (action ${a.id})`;
  } else {
    if (scope.from > scope.to) throw badRequest("The start date must be on or before the end date");
    where = actionWhere({ from: scope.from, to: scope.to, vendor: scope.vendor });
    scopeLabel = `${formatDate(scope.from)} to ${formatDate(scope.to)}${scope.vendor ? `, vendor "${scope.vendor}"` : ""}`;
    range = { start: new Date(scope.from + "T00:00:00Z"), end: new Date(new Date(scope.to + "T00:00:00Z").getTime() + 86_400_000) };
  }

  const actions = await db.action.findMany({
    where, orderBy: { createdAt: "asc" }, take: MAX_ACTIONS,
    include: {
      agent: { select: { name: true } },
      ruleResults: { include: { ruleVersion: { select: { version: true } } } },
      review: { include: { reviewer: { select: { name: true, role: true } } } },
    },
  });
  // Audit records in scope: the actions' own records, plus (for a period) every policy/autonomy
  // change made during it. A whole-organisation period includes every record in the window.
  const ownRecords: Prisma.AuditRecordWhereInput = { entityType: "action", entityId: { in: actions.map((a) => a.id) } };
  const auditWhere: Prisma.AuditRecordWhereInput = !range
    ? ownRecords
    : "vendor" in scope && scope.vendor
      ? { OR: [ownRecords, { entityType: { not: "action" }, eventType: { not: "evidence.exported" }, occurredAt: { gte: range.start, lt: range.end } }] }
      : { occurredAt: { gte: range.start, lt: range.end } };
  const records = await db.auditRecord.findMany({ where: auditWhere, orderBy: { seq: "asc" } });
  const chain = await verifyChain(ctx.organisationId);
  const recordChecks = records.map((r) => ({ seq: r.seq, ok: computeHash(r) === r.hash }));
  const recordsIntact = recordChecks.every((c) => c.ok);

  // ---- CSVs
  const actionsCsv = toCsv(
    ["action_id", "invoice_id", "vendor", "amount", "currency", "invoice_date", "received_at", "agent", "agent_version", "agent_decision", "agent_gl_code", "agent_confidence", "agent_reason",
     "autonomy_level", "gate_outcome", "enforced", "status", "required_approver", "rule_set_version", "failed_rules", "reviewer", "review_decision", "review_reason", "reviewed_at", "agent_was_correct"],
    actions.map((a) => [
      a.id, a.externalRef, a.counterpartyName, minorToDecimal(a.amountMinor), a.currency, (a.payload as { invoice_date?: string }).invoice_date ?? "",
      a.createdAt.toISOString(), a.agent.name, a.agentVersion, a.proposedDecision, a.proposedGlCode ?? "", a.agentConfidenceBps === null ? "" : (a.agentConfidenceBps / 10_000).toFixed(2),
      a.agentReason ?? "", a.autonomyLevel, a.computedOutcome, a.enforced, a.status, a.requiredRole ?? "", a.ruleSetVersion,
      a.ruleResults.filter((r) => r.result === "fail").map((r) => r.ruleName).join("; "),
      a.review?.reviewer.name ?? "", a.review?.decision ?? "", a.review?.reason ?? "", a.review?.createdAt.toISOString() ?? "", a.review ? a.review.agentWasCorrect : "",
    ]),
  );
  const rulesCsv = toCsv(
    ["action_id", "invoice_id", "rule_id", "rule_version_id", "rule_version", "rule_name", "severity", "result", "explanation"],
    actions.flatMap((a) => a.ruleResults.map((r) => [a.id, a.externalRef, r.ruleId, r.ruleVersionId, r.ruleVersion.version, r.ruleName, r.severity, r.result, r.explanation])),
  );
  const reviewsCsv = toCsv(
    ["action_id", "invoice_id", "reviewer", "reviewer_role", "decision", "correct_decision", "agent_was_correct", "reason", "reviewed_at"],
    actions.filter((a) => a.review).map((a) => [a.id, a.externalRef, a.review!.reviewer.name, a.review!.reviewer.role, a.review!.decision, a.review!.correctDecision, a.review!.agentWasCorrect, a.review!.reason, a.review!.createdAt.toISOString()]),
  );
  const auditCsv = toCsv(
    ["seq", "occurred_at", "event_type", "entity_type", "entity_id", "actor_type", "actor_id", "prev_hash", "hash", "hash_recomputed_ok", "payload_json"],
    records.map((r, i) => [r.seq, r.occurredAt.toISOString(), r.eventType, r.entityType, r.entityId, r.actorType, r.actorId, r.prevHash, r.hash, recordChecks[i].ok, canonicalJson(r.payload)]),
  );
  const verification = {
    verifiedAt: chain.verifiedAt,
    wholeChain: { ok: chain.ok, recordsChecked: chain.checked, headSeq: chain.headSeq, headHash: chain.headHash, problems: chain.problems },
    recordsInThisPack: { count: records.length, allHashesRecomputeCorrectly: recordsIntact, failed: recordChecks.filter((c) => !c.ok).map((c) => c.seq) },
    method: "SHA-256 over canonical JSON (sorted keys) of {organisationId, seq, eventType, entityType, entityId, actorType, actorId, occurredAt, payload, prevHash}; prevHash links each record to the one before it.",
  };

  const pdf = await summaryPdf({
    orgName: org.name, scopeLabel, generatedAt, generatedBy: `${ctx.user.name} (${ctx.user.role})`, chain, recordsIntact, recordCount: records.length,
    actions, records, single: "actionId" in scope,
  });

  const files: Record<string, Uint8Array> = {
    "summary.pdf": pdf,
    "actions.csv": utf8(actionsCsv),
    "rule_results.csv": utf8(rulesCsv),
    "reviews.csv": utf8(reviewsCsv),
    "audit_records.csv": utf8(auditCsv),
    "chain_verification.json": utf8(JSON.stringify(verification, null, 2)),
  };
  const manifest = {
    product: "Control Room evidence pack",
    organisation: org.name,
    scope: scopeLabel,
    generatedAt: generatedAt.toISOString(),
    generatedBy: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role },
    counts: { actions: actions.length, auditRecords: records.length },
    files: Object.entries(files).map(([name, bytes]) => ({ name, bytes: bytes.byteLength, sha256: sha256(bytes) })),
  };
  const zip = new JSZip();
  for (const [name, bytes] of Object.entries(files)) zip.file(name, bytes, { date: generatedAt });
  zip.file("manifest.json", JSON.stringify(manifest, null, 2), { date: generatedAt });
  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  // Exporting is recorded too (it changes no business data).
  await db.$transaction((tx) => appendAudit(tx, ctx.organisationId, {
    eventType: "evidence.exported", entityType: "evidence_pack", entityId: sha256(zipBytes).slice(0, 24), actorType: "user", actorId: ctx.user.id,
    payload: { scope, scopeLabel, counts: manifest.counts, files: manifest.files, by: { name: ctx.user.name, role: ctx.user.role } },
  }));

  const slug = "actionId" in scope ? `action-${actions[0]?.externalRef ?? scope.actionId}` : `${scope.from}_to_${scope.to}${scope.vendor ? "_" + scope.vendor.replace(/\W+/g, "-") : ""}`;
  return { bytes: zipBytes, filename: `evidence-pack_${slug}.zip`, manifest };
}

// ---------------------------------------------------------------- helpers

function minorToDecimal(minor: bigint) {
  const neg = minor < 0n;
  const a = neg ? -minor : minor;
  return `${neg ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export function toCsv(header: string[], rows: unknown[][]): string {
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // Neutralise spreadsheet formula injection.
    const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? "'" + s : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** pdf-lib's standard fonts only cover WinAnsi; map typographic characters and drop the rest. */
function pdfSafe(s: string): string {
  return s
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/→/g, "->").replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF•]/g, "?");
}

interface PdfInput {
  orgName: string; scopeLabel: string; generatedAt: Date; generatedBy: string;
  chain: Awaited<ReturnType<typeof verifyChain>>; recordsIntact: boolean; recordCount: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actions: any[];
  records: { seq: number; eventType: string; occurredAt: Date; hash: string; actorType: string; payload: unknown }[];
  single: boolean;
}

async function summaryPdf(p: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Evidence pack - ${p.scopeLabel}`);
  doc.setProducer("Control Room");
  doc.setCreationDate(p.generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);
  const W = 595, H = 842, M = 48;
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;
  const ink = rgb(0.07, 0.09, 0.15), muted = rgb(0.42, 0.45, 0.5), good = rgb(0.07, 0.5, 0.36), bad = rgb(0.75, 0.2, 0.17);

  const newPageIfNeeded = (need: number) => {
    if (y - need < M) { page = doc.addPage([W, H]); y = H - M; }
  };
  const text = (s: string, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; maxWidth?: number } = {}) => {
    const size = o.size ?? 10, f = o.f ?? font, x = o.x ?? M, maxWidth = o.maxWidth ?? W - M - x;
    for (const line of wrap(pdfSafe(s), f, size, maxWidth)) {
      newPageIfNeeded(size + 4);
      page.drawText(line, { x, y: y - size, size, font: f, color: o.color ?? ink });
      y -= size + 4;
    }
  };
  const gap = (n = 8) => { y -= n; };
  const heading = (s: string) => { gap(10); newPageIfNeeded(30); text(s, { size: 13, f: bold }); gap(2); };
  const kv = (k: string, v: string) => {
    newPageIfNeeded(16);
    page.drawText(pdfSafe(k), { x: M, y: y - 10, size: 10, font: bold, color: muted });
    const before = y;
    text(v, { x: M + 150 });
    if (y === before) y -= 14;
  };

  text("Control Room", { size: 10, f: bold, color: muted });
  text("Evidence pack", { size: 22, f: bold });
  gap(4);
  kv("Organisation", p.orgName);
  kv("Scope", p.scopeLabel);
  kv("Generated", `${formatDateTime(p.generatedAt)} by ${p.generatedBy}`);

  heading("Tamper check");
  text(p.chain.ok && p.recordsIntact ? "PASSED - every audit record matches its fingerprint and links to the one before it." : "FAILED - one or more audit records have been altered or removed.", { f: bold, color: p.chain.ok && p.recordsIntact ? good : bad });
  kv("Records in this pack", `${p.recordCount}, ${p.recordsIntact ? "all intact" : "some altered"}`);
  kv("Whole chain", `${p.chain.checked} records checked, latest #${p.chain.headSeq}`);
  text(`Latest fingerprint: ${p.chain.headHash}`, { f: mono, size: 8, color: muted });
  for (const prob of p.chain.problems.slice(0, 10)) text(`- ${prob.problem}`, { color: bad });

  const sum = (pred: (a: any) => boolean) => p.actions.filter(pred).reduce((s: bigint, a: any) => s + a.amountMinor, 0n);
  const count = (pred: (a: any) => boolean) => p.actions.filter(pred).length;
  const cur = p.actions[0]?.currency ?? "USD";

  if (p.single && p.actions[0]) {
    const a = p.actions[0];
    const s = a.payload as Record<string, any>;
    heading(`Invoice ${a.externalRef}`);
    kv("Vendor", `${a.counterpartyName}${s.vendor_id ? ` (${s.vendor_id})` : ""}`);
    kv("Amount", formatMoney(a.amountMinor, a.currency));
    kv("Invoice date", formatDate(s.invoice_date));
    kv("PO / goods received", `${s.po_number ?? "none"} / ${s.grn_number ?? "none"}`);
    kv("Received", formatDateTime(a.createdAt));
    heading("What the agent proposed");
    kv("Agent", `${a.agent.name}, version ${a.agentVersion}`);
    kv("Decision", `${a.proposedDecision}${a.proposedGlCode ? `, GL ${a.proposedGlCode}` : ""}`);
    kv("Confidence", a.agentConfidenceBps === null ? "not given" : `${(a.agentConfidenceBps / 100).toFixed(0)}%`);
    kv("Stated reason", a.agentReason ?? "none");
    heading("Rule results");
    for (const r of a.ruleResults) {
      text(`${r.result.toUpperCase().replace("_", " ")}  ${r.ruleName} (version ${r.ruleVersion.version})`, { f: bold, color: r.result === "fail" ? bad : r.result === "pass" ? good : muted });
      text(r.explanation, { x: M + 12 });
    }
    kv("Rule set", a.ruleSetVersion);
    heading("Gate outcome");
    kv("Autonomy level", String(a.autonomyLevel));
    kv("Outcome", `${OUTCOME_LABEL[a.computedOutcome as keyof typeof OUTCOME_LABEL]}${a.enforced ? "" : " (shadow mode, not enforced)"}`);
    kv("Reasons", (a.gateReasons as string[]).join("; "));
    if (a.requiredRole) kv("Required approver", a.requiredRole);
    heading("Human review");
    if (a.review) {
      kv("Reviewer", `${a.review.reviewer.name} (${a.review.reviewer.role})`);
      kv("Decision", a.review.decision);
      kv("Reason", a.review.reason);
      kv("Reviewed at", formatDateTime(a.review.createdAt));
      kv("Agent was right", a.review.agentWasCorrect ? "yes" : `no (correct: ${a.review.correctDecision})`);
    } else text(a.status === "pending_review" ? "Waiting for review." : "No human review was needed.", { color: muted });
  } else {
    heading("Summary");
    kv("Invoices", String(p.actions.length));
    kv("Approved automatically", `${count((a) => a.status === "auto_approved")} (${formatMoney(sum((a) => a.status === "auto_approved"), cur)})`);
    kv("Approved by a person", `${count((a) => a.status === "approved")} (${formatMoney(sum((a) => a.status === "approved"), cur)})`);
    kv("Rejected", String(count((a) => a.status === "rejected")));
    kv("Blocked", String(count((a) => a.status === "blocked")));
    kv("Waiting for review", String(count((a) => a.status === "pending_review")));
    const overridden = (a: any) => a.status === "approved" && a.ruleResults.some(isControlFailure);
    kv("Approved despite a failed check", `${count(overridden)} (${formatMoney(sum(overridden), cur)})`);
    const config = p.records.filter((r) => ["rule.changed", "rule.created", "autonomy.changed", "workflow.settings_changed"].includes(r.eventType));
    heading("Policy and autonomy changes in this period");
    if (!config.length) text("None.", { color: muted });
    for (const r of config) {
      const pl = r.payload as any;
      const what = r.eventType === "autonomy.changed" ? `Autonomy Level ${pl.fromLevel} -> ${pl.toLevel} by ${pl.confirmedBy?.name}: ${pl.reason}`
        : r.eventType === "rule.changed" ? `Rule "${pl.rule?.name}" v${pl.before?.version} -> v${pl.after?.version} by ${pl.changedBy?.name}: ${pl.changeNote}`
        : r.eventType === "rule.created" ? `Rule "${pl.rule?.name}" created`
        : `Workflow settings changed${pl.reason ? `: ${pl.reason}` : ""}`;
      text(`#${r.seq}  ${formatDateTime(r.occurredAt)}  ${what}`, { size: 9 });
    }
    heading("Invoices (first 150; all are in actions.csv)");
    for (const a of p.actions.slice(0, 150)) {
      text(`${formatDate(a.createdAt)}  ${a.externalRef}  ${a.counterpartyName}  ${formatMoney(a.amountMinor, a.currency)}  ${STATUS_LABEL[a.status] ?? a.status}${a.review ? `  (${a.review.reviewer.name})` : ""}`, { size: 8 });
    }
  }

  heading("Audit records in this pack");
  for (const r of p.records.slice(0, p.single ? 50 : 60)) {
    text(`#${r.seq}  ${formatDateTime(r.occurredAt)}  ${r.eventType}`, { size: 9 });
    text(r.hash, { f: mono, size: 7, color: muted, x: M + 12 });
  }
  if (p.records.length > 60) text(`...and ${p.records.length - 60} more in audit_records.csv`, { color: muted });

  const pages = doc.getPages();
  pages.forEach((pg, i) => pg.drawText(`Page ${i + 1} of ${pages.length}`, { x: W - M - 60, y: 24, size: 8, font, color: muted }));
  return doc.save();
}

function wrap(s: string, f: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of s.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const candidate = line ? `${line} ${word}` : word;
      if (f.widthOfTextAtSize(candidate, size) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      // Hard-break very long tokens such as hashes.
      let w = word;
      while (f.widthOfTextAtSize(w, size) > maxWidth) {
        let cut = w.length;
        while (cut > 1 && f.widthOfTextAtSize(w.slice(0, cut), size) > maxWidth) cut--;
        out.push(w.slice(0, cut));
        w = w.slice(cut);
      }
      line = w;
    }
    out.push(line);
  }
  return out;
}
