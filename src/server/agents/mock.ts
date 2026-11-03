import { z } from "zod";
import type { Decision } from "@prisma/client";
import { formatMoney, withinTolerance } from "@/lib/money";
import { unitHash } from "../seed/random";
import { CATEGORIES } from "../seed/generator";
import { normaliseInvoiceNumber, daysBetween } from "../rules/text";
import type { ContextLookup } from "../workflows/ap_invoice/context";
import { vendorKeyOf } from "../workflows/ap_invoice/context";
import { invoiceNumberOf, type InvoiceSubject } from "../workflows/ap_invoice/subject";

// Built-in mock AP agent, so the product can be demoed without a real agent.
// It works out the "right" answer from the same reference data a real agent would see,
// then makes mistakes according to its error profile. Deterministic per (seed, invoice).

export const MockConfigSchema = z.object({
  profile: z.enum(["cautious", "fast_pay"]),
  errorRate: z.number().min(0).max(1),
  seed: z.string().min(1),
});
export type MockConfig = z.infer<typeof MockConfigSchema>;

export interface AgentAnswer {
  decision: Decision;
  gl_code: string | null;
  reason: string;
  confidence: number;
}

type Issue = "duplicate" | "over_limit" | "po_mismatch" | "missing_grn" | "blocked_vendor" | "bank_changed" | "unknown_vendor";

interface Profile {
  label: string;
  description: string;
  defaultErrorRate: number;
  /** Probability of missing each kind of problem (approving anyway), at the default error rate. */
  blindSpots: Record<Issue, number>;
  /** On a clean invoice, when the agent errs: share of errors that are escalations (rest are rejections). */
  cleanErrorEscalateShare: number;
  glErrorRate: number;
  confidence: { right: [number, number]; wrong: [number, number] };
}

export const MOCK_PROFILES: Record<MockConfig["profile"], Profile> = {
  cautious: {
    label: "Cautious",
    description: "Rarely approves anything risky, but escalates or rejects many clean invoices.",
    defaultErrorRate: 0.07,
    blindSpots: { duplicate: 0.08, over_limit: 0, po_mismatch: 0.05, missing_grn: 0.05, blocked_vendor: 0, bank_changed: 0, unknown_vendor: 0 },
    cleanErrorEscalateShare: 0.7,
    glErrorRate: 0.03,
    confidence: { right: [0.86, 0.99], wrong: [0.68, 0.9] },
  },
  fast_pay: {
    label: "Fast payer",
    description: "Approves quickly and confidently; misses duplicates and bank detail changes.",
    defaultErrorRate: 0.06,
    blindSpots: { duplicate: 0.5, over_limit: 0.15, po_mismatch: 0.3, missing_grn: 0.35, blocked_vendor: 0.1, bank_changed: 0.75, unknown_vendor: 0.5 },
    cleanErrorEscalateShare: 0.25,
    glErrorRate: 0.06,
    confidence: { right: [0.9, 0.99], wrong: [0.88, 0.98] },
  },
};

const AUTHORITY_LIMIT_MINOR = 5_000_000n; // the mock agent's delegated authority: $50,000

async function findIssue(s: InvoiceSubject, lookup: ContextLookup, asOf: Date): Promise<{ issue: Issue; reason: string; decision: Decision } | null> {
  const vendor = await lookup.vendor(s);
  const amount = BigInt(s.amount.minor);
  if (!vendor) return { issue: "unknown_vendor", reason: `${s.vendor_name} is not a known vendor`, decision: "escalate" };
  if (vendor.blocked) return { issue: "blocked_vendor", reason: `${vendor.name} is on the blocked list`, decision: "reject" };
  const prior = await lookup.priorInvoices(vendorKeyOf(s, vendor), s);
  const myNorm = normaliseInvoiceNumber(invoiceNumberOf(s));
  const dup = prior.find((p) => p.ref !== s.invoice_id && (
    normaliseInvoiceNumber(p.invoiceNumber) === myNorm ||
    (p.amountMinor === amount && daysBetween(p.invoiceDate, s.invoice_date) <= 30)));
  if (dup) return { issue: "duplicate", reason: `Looks like a duplicate of ${dup.ref}`, decision: "reject" };
  if (vendor.bankChangedAt && vendor.bankChangedAt <= asOf && daysBetween(vendor.bankChangedAt, asOf) <= 90) {
    return { issue: "bank_changed", reason: "Vendor's bank details changed recently; needs a person to confirm", decision: "escalate" };
  }
  if (s.bank_account?.fingerprint && s.bank_account.fingerprint !== vendor.bankFingerprint) {
    return { issue: "bank_changed", reason: "Bank details on the invoice don't match our records", decision: "escalate" };
  }
  if (amount > AUTHORITY_LIMIT_MINOR) return { issue: "over_limit", reason: `${formatMoney(amount, s.amount.currency)} is above my approval authority`, decision: "escalate" };
  const po = s.po_number ? await lookup.po(s.po_number) : null;
  if (!po) return { issue: "po_mismatch", reason: s.po_number ? `Can't find ${s.po_number}` : "No PO on the invoice", decision: "escalate" };
  if (!withinTolerance(amount, po.amountMinor, 500)) return { issue: "po_mismatch", reason: `Invoice doesn't match ${po.poNumber} (${formatMoney(po.amountMinor, po.currency)})`, decision: "escalate" };
  const grn = s.grn_number ? await lookup.grn(s.grn_number) : null;
  if (!grn || grn.quantityReceived < po.quantity) return { issue: "missing_grn", reason: grn ? `Only ${grn.quantityReceived} of ${po.quantity} units received` : "Goods haven't been received yet", decision: "escalate" };
  return null;
}

export async function mockAgentDecide(subject: InvoiceSubject, lookup: ContextLookup, config: MockConfig, asOf: Date): Promise<AgentAnswer> {
  const profile = MOCK_PROFILES[config.profile];
  const scale = profile.defaultErrorRate > 0 ? config.errorRate / profile.defaultErrorRate : 0;
  const u = (salt: string) => unitHash(config.seed, subject.invoice_id, salt);
  const issue = await findIssue(subject, lookup, asOf);
  const vendor = await lookup.vendor(subject);
  const rightGl = vendor?.defaultGlCode ?? "6900";

  let decision: Decision;
  let reason: string;
  let wrong = false;
  if (issue) {
    const miss = Math.min(1, profile.blindSpots[issue.issue] * scale);
    if (u("miss") < miss) {
      decision = "approve";
      reason = subject.po_number ? `Matches ${subject.po_number}; OK to pay` : "Looks fine to pay";
      wrong = true;
    } else {
      decision = issue.decision;
      reason = issue.reason;
    }
  } else if (u("clean") < config.errorRate) {
    wrong = true;
    if (u("which") < profile.cleanErrorEscalateShare) {
      decision = "escalate";
      reason = "Unusual amount for this vendor; would like a person to check";
    } else {
      decision = "reject";
      reason = "Could not match this invoice to a purchase order";
    }
  } else {
    decision = "approve";
    reason = `Matches ${subject.po_number} and goods received; within tolerance`;
  }

  let gl = rightGl;
  if (decision === "approve" && u("gl") < profile.glErrorRate * Math.max(scale, 0.0001)) {
    const others = CATEGORIES.map((c) => c.gl).filter((g) => g !== rightGl);
    gl = others[Math.floor(u("glpick") * others.length)];
  }
  const [lo, hi] = wrong ? profile.confidence.wrong : profile.confidence.right;
  const confidence = Math.round((lo + (hi - lo) * u("conf")) * 100) / 100;
  return { decision, gl_code: decision === "approve" ? gl : null, reason, confidence };
}
