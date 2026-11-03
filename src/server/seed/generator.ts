import { createHash } from "node:crypto";
import type { Decision } from "@prisma/client";
import { rng } from "./random";
import type { InvoiceSubject } from "../workflows/ap_invoice/subject";

// Deterministic synthetic AP data: vendors, purchase orders, goods receipts and invoices with
// realistic errors. Every injected error is tagged, so we know the correct decision.

export type Anomaly =
  | "none"
  | "within_tolerance"
  | "duplicate"
  | "over_limit"
  | "po_mismatch"
  | "missing_grn"
  | "blocked_vendor"
  | "bank_changed";

export interface GenVendor {
  code: string; name: string; category: string; defaultGlCode: string;
  bankFingerprint: string; bankChangedAt: Date | null; blocked: boolean; blockedReason: string | null;
}
export interface GenPO { poNumber: string; vendorCode: string; amountMinor: bigint; currency: string; quantity: number; unitPriceMinor: bigint }
export interface GenGRN { grnNumber: string; poNumber: string; quantityReceived: number; receivedAt: Date }
export interface GenInvoice {
  subject: InvoiceSubject;
  anomaly: Anomaly;
  correctDecision: Decision;
  correctGlCode: string;
  note: string; // why this is the correct decision, for humans
}

export const CATEGORIES = [
  { category: "Office supplies", gl: "6100" },
  { category: "Facilities & utilities", gl: "6200" },
  { category: "Travel", gl: "6300" },
  { category: "IT & software", gl: "6400" },
  { category: "Professional services", gl: "6500" },
  { category: "Marketing", gl: "6600" },
  { category: "Raw materials", gl: "5000" },
  { category: "Freight & logistics", gl: "5200" },
] as const;

const NAME_A = ["Northwind", "Bluefin", "Granite", "Cedar", "Summit", "Harbor", "Ironwood", "Silverline", "Meridian", "Copperleaf", "Redwood", "Lakeside", "Brightpath", "Oakridge", "Pinnacle", "Riverbend", "Stonegate", "Westfield", "Evergreen", "Falcon"];
const NAME_B: Record<string, string[]> = {
  "Office supplies": ["Office Supply", "Stationers", "Paper Co."],
  "Facilities & utilities": ["Facilities", "Power & Water", "Cleaning Services"],
  "Travel": ["Travel", "Hotels", "Air Charter"],
  "IT & software": ["Software", "Cloud Systems", "IT Services"],
  "Professional services": ["Consulting", "Legal LLP", "Advisory"],
  "Marketing": ["Media", "Creative Studio", "Print & Promo"],
  "Raw materials": ["Steel", "Polymers", "Timber Supply"],
  "Freight & logistics": ["Freight", "Logistics", "Haulage"],
};

/** Agent's delegated authority in the seed scenario: invoices above this must be escalated. */
export const SEED_AUTHORITY_LIMIT_MINOR = 5_000_000n; // $50,000.00
export const SEED_BANK_LOOKBACK_DAYS = 90;
export const SEED_TOLERANCE_BPS = 500; // 5%

export function fingerprint(s: string) {
  return "sha256:" + createHash("sha256").update(s).digest("hex").slice(0, 32);
}

const DAY = 86_400_000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export function generateVendors(count = 120, seed = "vendors-v1"): GenVendor[] {
  const r = rng(seed);
  const vendors: GenVendor[] = [];
  const used = new Set<string>();
  for (let i = 0; i < count; i++) {
    const cat = CATEGORIES[i % CATEGORIES.length];
    let name = "";
    for (let tries = 0; tries < 50; tries++) {
      name = `${r.pick(NAME_A)} ${r.pick(NAME_B[cat.category])}`;
      if (!used.has(name)) break;
      name = `${name} ${r.int(2, 9)}`;
      if (!used.has(name)) break;
    }
    used.add(name);
    const code = `V-${String(i + 1).padStart(4, "0")}`;
    vendors.push({
      code, name, category: cat.category, defaultGlCode: cat.gl,
      bankFingerprint: fingerprint(`bank:${code}:original`),
      bankChangedAt: null, blocked: false, blockedReason: null,
    });
  }
  // Three blocked vendors.
  vendors[7].blocked = true; vendors[7].blockedReason = "Failed sanctions screening";
  vendors[33].blocked = true; vendors[33].blockedReason = "Suspected fraudulent invoicing";
  vendors[58].blocked = true; vendors[58].blockedReason = "Contract terminated";
  // One vendor whose bank details changed recently (the classic payment-diversion pattern).
  vendors[12].bankChangedAt = new Date("2026-08-20T00:00:00Z");
  vendors[12].bankFingerprint = fingerprint(`bank:${vendors[12].code}:changed`);
  return vendors;
}

interface GenOptions {
  seed: string;
  count: number;
  start: Date;
  end: Date;
  idPrefix: string;   // e.g. "INV" or "LIV"
  poStart: number;
  includeBankFingerprint: boolean;
  /** Approximate shares of each error type. */
  mix?: Partial<Record<Exclude<Anomaly, "none">, number>>;
}

const DEFAULT_MIX = {
  duplicate: 0.06, over_limit: 0.05, po_mismatch: 0.07, missing_grn: 0.03,
  blocked_vendor: 0.02, within_tolerance: 0.04,
};

export function generateInvoices(vendors: GenVendor[], opt: GenOptions) {
  const r = rng(opt.seed);
  const mix = { ...DEFAULT_MIX, ...(opt.mix ?? {}) };
  const pos: GenPO[] = [];
  const grns: GenGRN[] = [];
  const invoices: GenInvoice[] = [];
  const active = vendors.filter((v) => !v.blocked);
  const blocked = vendors.filter((v) => v.blocked);
  const bankVendor = vendors.find((v) => v.bankChangedAt);
  const span = opt.end.getTime() - opt.start.getTime();
  let poSeq = opt.poStart;

  // Fixed counts (deterministic): duplicates and bank-change invoices are placed after the base set.
  const n = opt.count;
  const nDup = Math.round(n * mix.duplicate);
  const bankCount = bankVendor ? 8 : 0;
  const nBase = n - nDup - bankCount;

  const makeAmount = (): bigint => {
    // Mostly a few hundred to a few thousand dollars, with a long tail.
    const roll = r.next();
    let dollars: number;
    if (roll < 0.55) dollars = r.int(120, 4_800);
    else if (roll < 0.85) dollars = r.int(4_800, 12_000);
    else dollars = r.int(12_000, 46_000);
    return BigInt(dollars) * 100n + BigInt(r.int(0, 99));
  };

  const newPo = (vendorCode: string, amountMinor: bigint) => {
    const quantity = r.pick([1, 2, 4, 5, 10, 12, 20, 25, 50, 100]);
    // Unit price * quantity == amount exactly (round amount to a multiple of quantity).
    const unit = amountMinor / BigInt(quantity);
    const po: GenPO = {
      poNumber: `PO-${poSeq++}`, vendorCode, amountMinor: unit * BigInt(quantity),
      currency: "USD", quantity, unitPriceMinor: unit,
    };
    pos.push(po);
    return po;
  };

  const sortedDates = Array.from({ length: n }, () => new Date(opt.start.getTime() + Math.floor(r.next() * span)))
    .sort((a, b) => a.getTime() - b.getTime());
  let dateIdx = 0;

  const anomalies: Anomaly[] = [];
  for (let i = 0; i < nBase; i++) {
    const roll = r.next() * (nBase / n);
    let acc = 0;
    let picked: Anomaly = "none";
    for (const [k, share] of Object.entries(mix)) {
      if (k === "duplicate") continue;
      acc += share;
      if (roll < acc) { picked = k as Anomaly; break; }
    }
    anomalies.push(picked);
  }

  let invSeq = 10000;
  const nextId = () => `${opt.idPrefix}-${invSeq++}`;

  for (const anomaly of anomalies) {
    const date = sortedDates[dateIdx++] ?? opt.end;
    const vendor = anomaly === "blocked_vendor" ? r.pick(blocked) : pickActive();
    let amount = anomaly === "over_limit" ? BigInt(r.int(52_000, 180_000)) * 100n + BigInt(r.int(0, 99)) : makeAmount();
    const po = newPo(vendor.code, amount);
    amount = po.amountMinor;
    let invoiceAmount = amount;
    let poNumber: string | null = po.poNumber;
    let grnNumber: string | null = `GRN-${po.poNumber.slice(3)}`;
    let received = po.quantity;
    let decision: Decision = "approve";
    let note = "Clean invoice: matches PO and goods received";

    switch (anomaly) {
      case "within_tolerance": {
        const bps = r.int(50, 400); // 0.5% – 4% over, e.g. freight surcharge
        invoiceAmount = amount + (amount * BigInt(bps)) / 10_000n;
        note = `Invoice is ${(bps / 100).toFixed(1)}% above PO, within the 5% tolerance`;
        break;
      }
      case "over_limit":
        decision = "escalate";
        note = "Amount is above the $50,000 delegated authority limit";
        break;
      case "po_mismatch": {
        if (r.chance(0.7)) {
          const bps = r.int(800, 4000);
          invoiceAmount = amount + (amount * BigInt(bps)) / 10_000n;
          note = `Invoice is ${(bps / 100).toFixed(1)}% above the PO amount`;
        } else {
          poNumber = `PO-9${r.int(10000, 99999)}`;
          note = "PO number on the invoice does not exist";
        }
        decision = "escalate";
        break;
      }
      case "missing_grn":
        decision = "escalate";
        if (r.chance(0.5)) { grnNumber = null; note = "No goods receipt for this PO"; }
        else { received = Math.max(0, Math.floor(po.quantity * 0.5)); note = `Only ${received} of ${po.quantity} units received`; }
        break;
      case "blocked_vendor":
        decision = "reject";
        note = `Vendor is blocked: ${vendor.blockedReason}`;
        break;
    }
    if (grnNumber) grns.push({ grnNumber, poNumber: po.poNumber, quantityReceived: received, receivedAt: new Date(date.getTime() - r.int(1, 10) * DAY) });
    // A vendor with recently changed bank details must always go to a person.
    if (vendor.bankChangedAt && decision === "approve" && date >= vendor.bankChangedAt && date.getTime() - vendor.bankChangedAt.getTime() <= SEED_BANK_LOOKBACK_DAYS * DAY) {
      decision = "escalate"; note = "Vendor bank details changed recently";
    }
    const id = nextId();
    invoices.push({
      subject: subject(id, id, vendor, invoiceAmount, poNumber, grnNumber, date),
      anomaly: decision === "escalate" && anomaly === "none" ? "bank_changed" : anomaly,
      correctDecision: decision,
      correctGlCode: vendor.defaultGlCode,
      note,
    });
  }

  // Bank-detail-change invoices: placed after the change date.
  if (bankVendor && bankVendor.bankChangedAt) {
    const from = Math.max(opt.start.getTime(), bankVendor.bankChangedAt.getTime());
    for (let i = 0; i < bankCount; i++) {
      const date = new Date(from + Math.floor(r.next() * Math.max(DAY, opt.end.getTime() - from)));
      const po = newPo(bankVendor.code, makeAmount());
      const grnNumber = `GRN-${po.poNumber.slice(3)}`;
      grns.push({ grnNumber, poNumber: po.poNumber, quantityReceived: po.quantity, receivedAt: new Date(date.getTime() - 2 * DAY) });
      const id = nextId();
      const s = subject(id, id, bankVendor, po.amountMinor, po.poNumber, grnNumber, date);
      invoices.push({ subject: s, anomaly: "bank_changed", correctDecision: "escalate", correctGlCode: bankVendor.defaultGlCode, note: `Vendor bank details changed on ${isoDate(bankVendor.bankChangedAt)}` });
    }
  }

  // Duplicates: resubmissions of earlier approvable invoices, same vendor and amount, a few days later.
  const originals = invoices.filter((i) => i.correctDecision === "approve");
  for (let i = 0; i < nDup; i++) {
    const orig = r.pick(originals);
    const o = orig.subject;
    const date = new Date(new Date(o.invoice_date + "T00:00:00Z").getTime() + r.int(0, 12) * DAY);
    const origNumber = o.invoice_number ?? o.invoice_id;
    const variant = r.int(0, 3);
    const number =
      variant === 0 ? origNumber :
      variant === 1 ? origNumber.replace(/^[A-Z]+-/, "") :
      variant === 2 ? origNumber + "A" :
      origNumber.replace(/0/, "O");
    const id = nextId();
    invoices.push({
      subject: { ...o, invoice_id: id, invoice_number: number, invoice_date: isoDate(date) },
      anomaly: "duplicate",
      correctDecision: "reject",
      correctGlCode: orig.correctGlCode,
      note: `Duplicate of ${o.invoice_id} (invoice number "${number}")`,
    });
  }

  invoices.sort((a, b) => a.subject.invoice_date.localeCompare(b.subject.invoice_date) || a.subject.invoice_id.localeCompare(b.subject.invoice_id));
  return { pos, grns, invoices };

  function pickActive() {
    // Skip the bank-change vendor for base invoices half the time so its invoices stay rare.
    return r.pick(active.filter((v) => !v.bankChangedAt));
  }

  function subject(id: string, number: string, v: GenVendor, amountMinor: bigint, po: string | null, grn: string | null, date: Date): InvoiceSubject {
    return {
      type: "invoice",
      invoice_id: id,
      invoice_number: number,
      vendor_id: v.code,
      vendor_name: v.name,
      amount: { minor: Number(amountMinor), currency: "USD" },
      po_number: po,
      grn_number: grn,
      invoice_date: isoDate(date),
      bank_account: opt.includeBankFingerprint ? { fingerprint: v.bankFingerprint } : null,
      description: `${v.category} — ${po ?? "no PO"}`,
    };
  }
}

export const REPLAY_CSV_HEADER = [
  "invoice_id", "invoice_number", "vendor", "amount", "currency", "po_number", "grn_number",
  "invoice_date", "correct_decision", "correct_gl_code",
];

export function toCsv(invoices: GenInvoice[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [REPLAY_CSV_HEADER.join(",")];
  for (const inv of invoices) {
    const s = inv.subject;
    const minor = BigInt(s.amount.minor);
    const amount = `${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
    lines.push([
      s.invoice_id, s.invoice_number ?? "", s.vendor_name, amount, s.amount.currency, s.po_number ?? "",
      s.grn_number ?? "", s.invoice_date, inv.correctDecision, inv.correctGlCode,
    ].map((x) => esc(String(x))).join(","));
  }
  return lines.join("\n") + "\n";
}
