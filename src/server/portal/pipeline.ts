import { forOrg } from "../db/dal";
import { getErpConnector } from "../connectors/erp";
import { agentConnector } from "../agents/connector";
import { evaluateAction } from "../gate/evaluate";
import { liveLookup } from "../workflows/ap_invoice/context";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";
import { addInvoiceEvent, DEFAULT_NOTES, syncInvoiceForAction } from "./sync";

// A submitted supplier invoice enters the same pipeline as any other invoice:
// the workflow's primary AI agent proposes a decision, Control Room's rules and autonomy
// level decide the outcome, and the result is written to the audit trail.

export function invoiceSubject(inv: {
  id: string; invoiceNumber: string; totalMinor: bigint; currency: string; poNumber: string | null; grnNumber: string | null;
  invoiceDate: Date; bankFingerprint: string | null; vendor: { code: string; name: string }; lines: { description: string }[];
}): InvoiceSubject {
  return {
    type: "invoice",
    invoice_id: inv.id,
    invoice_number: inv.invoiceNumber,
    vendor_id: inv.vendor.code,
    vendor_name: inv.vendor.name,
    amount: { minor: Number(inv.totalMinor), currency: inv.currency },
    po_number: inv.poNumber,
    grn_number: inv.grnNumber,
    invoice_date: inv.invoiceDate.toISOString().slice(0, 10),
    bank_account: inv.bankFingerprint ? { fingerprint: inv.bankFingerprint } : null,
    description: inv.lines.map((l) => l.description).join("; ").slice(0, 500),
  };
}

export interface ProcessResult { status: string; actionId: string | null; error?: string }

/** Run the AI check on a submitted invoice. Never throws: if the agent fails, a person takes over. */
export async function processSubmittedInvoice(organisationId: string, invoiceId: string, opts: { now?: Date } = {}): Promise<ProcessResult> {
  const db = forOrg(organisationId);
  // The check's result is recorded a moment after the submission, so timelines read in order.
  const now = new Date((opts.now ?? new Date()).getTime() + 1);
  const inv = await db.invoice.findFirst({ where: { id: invoiceId }, include: { vendor: true, lines: { orderBy: { position: "asc" } }, organisation: { select: { name: true } } } });
  if (!inv || inv.status !== "submitted") return { status: inv?.status ?? "missing", actionId: inv?.actionId ?? null };

  const toPerson = async (why: string) => {
    await db.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id: inv.id }, data: { status: "under_review" } });
      await addInvoiceEvent(tx, inv, "under_review", DEFAULT_NOTES.under_review(inv.organisation.name), { type: "system" }, now);
    });
    return { status: "under_review", actionId: null, error: why };
  };

  if (inv.kind === "credit_note") return toPerson("Credit notes are checked by a person");
  const workflow = await db.workflow.findFirst({ where: { type: "ap_invoice" }, include: { primaryAgent: true }, orderBy: { createdAt: "asc" } });
  const agent = workflow?.primaryAgent;
  if (!workflow || !agent || !agent.active) return toPerson("No active AI agent is set for invoice approval");

  try {
    const subject = invoiceSubject(inv);
    const lookup = liveLookup(db, getErpConnector(workflow.erpConnector, db), workflow.id);
    const answer = await agentConnector(agent)(subject, lookup, now);
    const res = await evaluateAction(agent, {
      workflow_id: workflow.id,
      agent_version: agent.version,
      proposed: { decision: answer.decision, gl_code: answer.gl_code, reason: answer.reason, confidence: answer.confidence },
      subject,
    }, { idempotencyKey: `portal:${inv.id}:r${inv.revision}`, now });
    await db.invoice.update({ where: { id: inv.id }, data: { actionId: res.action_id } });
    const status = (await syncInvoiceForAction(organisationId, res.action_id, { now })) ?? "submitted";
    return { status, actionId: res.action_id };
  } catch (e) {
    console.error(`[portal] AI check failed for invoice ${inv.id}`, e);
    return toPerson(e instanceof Error ? e.message : String(e));
  }
}
