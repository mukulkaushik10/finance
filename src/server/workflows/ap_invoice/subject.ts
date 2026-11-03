import { z } from "zod";

// The normalised "subject" of an AP invoice action. A refund workflow will define its own
// subject schema next to this one; the gate, rules, audit and replay only see `payload` JSON
// plus the generic columns (externalRef, counterparty, amount, currency).

export const MoneySchema = z.object({
  minor: z.number().int().describe("Amount in minor units (cents). 1234.50 USD = 123450"),
  currency: z.string().length(3).describe("ISO 4217 currency code"),
});

export const InvoiceSubjectSchema = z.object({
  type: z.literal("invoice"),
  invoice_id: z.string().min(1).describe("Your system's unique ID for this invoice"),
  invoice_number: z.string().optional().describe("The number printed on the vendor's invoice; defaults to invoice_id"),
  vendor_id: z.string().optional().describe("Vendor code in the system of record"),
  vendor_name: z.string().min(1),
  amount: MoneySchema,
  po_number: z.string().nullish(),
  grn_number: z.string().nullish().describe("Goods received note number"),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  bank_account: z.object({ fingerprint: z.string() }).nullish()
    .describe("A hash of the bank details on the invoice; compared with the vendor record"),
  description: z.string().optional(),
});

export type InvoiceSubject = z.infer<typeof InvoiceSubjectSchema>;

export function invoiceNumberOf(s: Pick<InvoiceSubject, "invoice_id" | "invoice_number">): string {
  return s.invoice_number || s.invoice_id;
}
