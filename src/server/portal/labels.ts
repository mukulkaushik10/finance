import type { InvoiceStatus } from "@prisma/client";

// Plain-language invoice statuses. The supplier wording never reveals internal checks,
// AI confidence or rule names.

export const SUPPLIER_STATUS: Record<InvoiceStatus, { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" | "brand" }> = {
  draft: { label: "Draft", tone: "neutral" },
  submitted: { label: "Sent", tone: "info" },
  under_review: { label: "With buyer for approval", tone: "info" },
  approved: { label: "Approved", tone: "good" },
  needs_changes: { label: "Needs changes", tone: "warn" },
  rejected: { label: "Rejected", tone: "bad" },
  scheduled: { label: "Payment scheduled", tone: "brand" },
  paid: { label: "Paid", tone: "good" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const BUYER_STATUS: Record<InvoiceStatus, { label: string; tone: "good" | "warn" | "bad" | "info" | "neutral" | "brand" }> = {
  ...SUPPLIER_STATUS,
  submitted: { label: "Received", tone: "info" },
  under_review: { label: "Waiting for a decision", tone: "warn" },
  approved: { label: "Approved, not yet scheduled", tone: "good" },
  needs_changes: { label: "Sent back to supplier", tone: "warn" },
};

/** Statuses where money is still owed to the supplier. */
export const OUTSTANDING: InvoiceStatus[] = ["submitted", "under_review", "approved", "scheduled"];
