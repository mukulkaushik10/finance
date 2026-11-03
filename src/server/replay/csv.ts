import Papa from "papaparse";
import type { Decision } from "@prisma/client";
import { parseMoney } from "@/lib/money";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";

// Parse a replay CSV of historical invoices with known correct outcomes.
// Column names are matched loosely ("PO number", "po_number", "PO" all work).

const COLUMNS: Record<string, string[]> = {
  invoice_id: ["invoice_id", "invoice id", "id", "invoice"],
  invoice_number: ["invoice_number", "invoice number", "invoice no", "vendor invoice number"],
  vendor: ["vendor", "vendor_name", "vendor name", "supplier", "supplier name"],
  vendor_id: ["vendor_id", "vendor id", "vendor code", "supplier id"],
  amount: ["amount", "invoice_amount", "invoice amount", "total", "gross amount"],
  currency: ["currency", "ccy"],
  po_number: ["po_number", "po number", "po", "purchase order", "po no"],
  grn_number: ["grn_number", "grn number", "grn", "goods receipt", "goods received note", "grn no"],
  invoice_date: ["invoice_date", "invoice date", "date"],
  correct_decision: ["correct_decision", "correct decision", "expected_decision", "expected decision", "decision", "outcome"],
  correct_gl_code: ["correct_gl_code", "correct gl code", "gl_code", "gl code", "expected gl code", "gl"],
};
const REQUIRED = ["invoice_id", "vendor", "amount", "currency", "invoice_date", "correct_decision"];

export interface ParsedCase {
  rowNumber: number;
  subject: InvoiceSubject;
  amountMinor: bigint;
  expectedDecision: Decision;
  expectedGlCode: string | null;
}
export interface CsvIssue { row: number; message: string }

const norm = (h: string) => h.trim().toLowerCase().replace(/[_\s]+/g, " ");

export function parseReplayCsv(text: string, opts: { maxRows?: number } = {}): { cases: ParsedCase[]; errors: CsvIssue[]; columns: Record<string, string | null> } {
  const maxRows = opts.maxRows ?? 20_000;
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: "greedy" });
  const errors: CsvIssue[] = [];
  const [header, ...rows] = parsed.data;
  if (!header) return { cases: [], errors: [{ row: 0, message: "The file is empty" }], columns: {} };

  const idx: Record<string, number> = {};
  const columns: Record<string, string | null> = {};
  for (const [key, aliases] of Object.entries(COLUMNS)) {
    const i = header.findIndex((h) => aliases.map(norm).includes(norm(h)));
    idx[key] = i;
    columns[key] = i >= 0 ? header[i] : null;
  }
  const missing = REQUIRED.filter((k) => idx[k] < 0);
  if (missing.length) {
    return { cases: [], errors: [{ row: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` }], columns };
  }
  if (rows.length > maxRows) errors.push({ row: 0, message: `Only the first ${maxRows} rows will be used` });

  const seen = new Set<string>();
  const cases: ParsedCase[] = [];
  rows.slice(0, maxRows).forEach((r, i) => {
    const rowNumber = i + 2; // 1-based, after header
    const get = (k: string) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");
    const problems: string[] = [];
    const id = get("invoice_id");
    if (!id) problems.push("invoice_id is empty");
    else if (seen.has(id)) problems.push(`invoice_id ${id} appears more than once`);
    const currency = get("currency").toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) problems.push(`"${get("currency")}" is not a 3-letter currency code`);
    let amountMinor = 0n;
    try {
      amountMinor = parseMoney(get("amount"), currency || "USD");
      if (amountMinor <= 0n) problems.push("amount must be more than zero");
    } catch (e) { problems.push((e as Error).message); }
    const date = normaliseDate(get("invoice_date"));
    if (!date) problems.push(`"${get("invoice_date")}" is not a date (use YYYY-MM-DD)`);
    const decision = get("correct_decision").toLowerCase();
    if (!["approve", "reject", "escalate"].includes(decision)) problems.push(`correct_decision must be approve, reject or escalate (got "${get("correct_decision")}")`);
    if (!get("vendor")) problems.push("vendor is empty");
    if (problems.length) {
      errors.push({ row: rowNumber, message: problems.join("; ") });
      return;
    }
    seen.add(id);
    cases.push({
      rowNumber,
      amountMinor,
      expectedDecision: decision as Decision,
      expectedGlCode: get("correct_gl_code") || null,
      subject: {
        type: "invoice",
        invoice_id: id,
        invoice_number: get("invoice_number") || id,
        vendor_id: get("vendor_id") || undefined,
        vendor_name: get("vendor"),
        amount: { minor: Number(amountMinor), currency },
        po_number: get("po_number") || null,
        grn_number: get("grn_number") || null,
        invoice_date: date!,
        bank_account: null,
      },
    });
  });
  return { cases, errors, columns };
}

function normaliseDate(s: string): string | null {
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);
  if (m) return valid(m[1], m[2], m[3]);
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return valid(m[1], m[2], m[3]);
  return null;
}
function valid(y: string, mo: string, d: string) {
  const iso = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  const t = new Date(iso + "T00:00:00Z");
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}
