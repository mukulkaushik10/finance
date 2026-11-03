import { describe, expect, it } from "vitest";
import { parseReplayCsv } from "@/server/replay/csv";
import { signPayload, verifySignature } from "@/server/agents/webhook";

const HEADER = "invoice_id,vendor,amount,currency,po_number,grn_number,invoice_date,correct_decision,correct_gl_code";

describe("replay CSV parsing", () => {
  it("parses a valid file into minor units", () => {
    const { cases, errors } = parseReplayCsv(`${HEADER}\nINV-1,Acme,"1,234.50",usd,PO-1,GRN-1,2026-09-01,approve,6100\n`);
    expect(errors).toEqual([]);
    expect(cases[0]).toMatchObject({ rowNumber: 2, amountMinor: 123450n, expectedDecision: "approve", expectedGlCode: "6100" });
    expect(cases[0].subject).toMatchObject({ invoice_id: "INV-1", invoice_number: "INV-1", amount: { minor: 123450, currency: "USD" } });
  });
  it("accepts friendly column names in any order, and an optional invoice_number", () => {
    const csv = "Correct Decision,Supplier,Invoice ID,Total,Currency,Invoice Date,PO Number,Invoice Number\nreject,Acme,A1,10,EUR,2026/9/1,,X-9\n";
    const { cases, errors } = parseReplayCsv(csv);
    expect(errors).toEqual([]);
    expect(cases[0].subject).toMatchObject({ invoice_id: "A1", invoice_number: "X-9", invoice_date: "2026-09-01", po_number: null });
  });
  it("reports missing columns", () => {
    const { cases, errors } = parseReplayCsv("invoice_id,vendor\nA,B\n");
    expect(cases).toEqual([]);
    expect(errors[0].message).toMatch(/Missing columns: amount, currency, invoice_date, correct_decision/);
  });
  it("reports bad rows by row number and keeps the good ones", () => {
    const csv = [
      HEADER,
      "INV-1,Acme,100.00,USD,PO-1,GRN-1,2026-09-01,approve,6100",
      "INV-2,Acme,abc,USD,PO-1,GRN-1,2026-09-01,approve,6100",
      "INV-3,Acme,10.00,USD,PO-1,GRN-1,2026-02-30,maybe,6100",
      "INV-1,Acme,10.00,USD,PO-1,GRN-1,2026-09-01,approve,6100",
    ].join("\n");
    const { cases, errors } = parseReplayCsv(csv);
    expect(cases.map((c) => c.subject.invoice_id)).toEqual(["INV-1"]);
    expect(errors.map((e) => e.row)).toEqual([3, 4, 5]);
    expect(errors[1].message).toContain("not a date");
    expect(errors[1].message).toContain("approve, reject or escalate");
    expect(errors[2].message).toContain("appears more than once");
  });
});

describe("webhook signatures", () => {
  it("signs and verifies, rejecting tampering and stale timestamps", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = signPayload("whsec_x", ts, '{"a":1}');
    expect(verifySignature("whsec_x", ts, '{"a":1}', sig)).toBe(true);
    expect(verifySignature("whsec_x", ts, '{"a":2}', sig)).toBe(false);
    expect(verifySignature("whsec_y", ts, '{"a":1}', sig)).toBe(false);
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifySignature("whsec_x", old, '{"a":1}', signPayload("whsec_x", old, '{"a":1}'))).toBe(false);
  });
});
