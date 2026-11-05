import type { InvoiceStatus } from "@prisma/client";
import { forOrg, type Tx } from "../db/dal";

// Keeps a supplier invoice's status in step with the Control Room action that checked it.
// Called after the AI check, and after a person reviews the action in the review queue.

export async function addInvoiceEvent(
  tx: Tx,
  inv: { id: string; organisationId: string; vendorAccountId: string },
  status: InvoiceStatus,
  note: string | null,
  actor: { type: "supplier" | "buyer" | "system"; name?: string | null },
  at: Date = new Date(),
) {
  await tx.invoiceEvent.create({
    data: {
      organisationId: inv.organisationId, vendorAccountId: inv.vendorAccountId, invoiceId: inv.id, status, note,
      actorType: actor.type, actorName: actor.name ?? null, createdAt: at,
    },
  });
}

export const DEFAULT_NOTES = {
  under_review: (buyer: string) => `With ${buyer}'s accounts payable team for approval`,
  approved: "Approved for payment",
  needs_changes: "The buyer couldn't approve this invoice as sent. Check the messages, fix it and send it again.",
  rejected: "The buyer rejected this invoice.",
};

/** Map the action's state to the invoice. Returns the new status, or null if nothing changed. */
export async function syncInvoiceForAction(organisationId: string, actionId: string, opts: { tx?: Tx; now?: Date } = {}): Promise<InvoiceStatus | null> {
  const run = async (tx: Tx) => {
    const inv = await tx.invoice.findFirst({ where: { actionId }, include: { organisation: { select: { name: true } } } });
    if (!inv || !["submitted", "under_review"].includes(inv.status)) return null;
    const action = await tx.action.findFirst({ where: { id: actionId }, include: { review: true } });
    if (!action) return null;
    let next: InvoiceStatus;
    if (action.status === "auto_approved" || action.status === "approved") next = "approved";
    else if (action.status === "rejected") next = "needs_changes";
    else if (action.status === "logged" && action.review) next = action.review.decision === "approve" ? "approved" : "needs_changes";
    else next = "under_review"; // pending_review, blocked, or shadow mode: a person decides
    if (next === inv.status) return null;
    const now = opts.now ?? new Date();
    const note = next === "under_review" ? DEFAULT_NOTES.under_review(inv.organisation.name) : DEFAULT_NOTES[next as "approved" | "needs_changes"];
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: next, supplierNote: next === "under_review" ? inv.supplierNote : note, decidedAt: next === "under_review" ? null : now },
    });
    await addInvoiceEvent(tx, inv, next, note, { type: next === "under_review" || action.status === "auto_approved" ? "system" : "buyer" }, now);
    return next;
  };
  if (opts.tx) return run(opts.tx);
  return forOrg(organisationId).$transaction(run);
}
