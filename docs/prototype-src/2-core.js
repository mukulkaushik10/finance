"use strict";
/* ============================================================ utilities */
const DAY = 864e5;
const NOW = new Date();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (c, cur = "USD") => (c < 0 ? "−" : "") + "$" + (Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtK = (c) => { const d = Math.abs(c) / 100; const s = d >= 1e6 ? (d / 1e6).toFixed(2) + "M" : d >= 1e4 ? (d / 1e3).toFixed(1) + "k" : d.toLocaleString("en-US", { maximumFractionDigits: 0 }); return (c < 0 ? "−$" : "$") + s; };
const pct = (x, d = 1) => (x === null || x === undefined || isNaN(x) ? "-" : (x * 100).toFixed(d) + "%");
const dFmt = (d) => d ? new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "-";
const tFmt = (d) => d ? new Date(d).toLocaleString("en-US", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "-";
const iso = (d) => new Date(d).toISOString().slice(0, 10);
const parseMoney = (s) => { const r = String(s).trim().replace(/[$,\s]/g, ""); if (!/^-?\d+(\.\d{1,2})?$/.test(r)) return null; return Math.round(parseFloat(r) * 100); };
const uid = (p) => p + Math.random().toString(36).slice(2, 10);

function rng(seed) { // mulberry32 seeded from a string
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  const next = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), pick: (arr) => arr[Math.floor(next() * arr.length)] };
}
const unit = (...parts) => rng(parts.join("|")).next();

/* SHA-256 (sync), for the audit hash chain */
const sha256 = (() => {
  const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
  const enc = new TextEncoder();
  return (str) => {
    const msg = enc.encode(str); const l = msg.length;
    const n = ((l + 9 + 63) >> 6) << 6; const buf = new Uint8Array(n); buf.set(msg); buf[l] = 0x80;
    const dv = new DataView(buf.buffer); dv.setUint32(n - 4, l * 8); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
    const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
    const W = new Uint32Array(64);
    for (let o = 0; o < n; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) { const a = W[i-15], b = W[i-2]; const s0 = ((a>>>7)|(a<<25)) ^ ((a>>>18)|(a<<14)) ^ (a>>>3); const s1 = ((b>>>17)|(b<<15)) ^ ((b>>>19)|(b<<13)) ^ (b>>>10); W[i] = (W[i-16] + s0 + W[i-7] + s1) | 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e>>>6)|(e<<26)) ^ ((e>>>11)|(e<<21)) ^ ((e>>>25)|(e<<7)); const ch = (e & f) ^ (~e & g);
        const t1 = (h + S1 + ch + K[i] + W[i]) | 0; const S0 = ((a>>>2)|(a<<30)) ^ ((a>>>13)|(a<<19)) ^ ((a>>>22)|(a<<10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0]+=a; H[1]+=b; H[2]+=c; H[3]+=d; H[4]+=e; H[5]+=f; H[6]+=g; H[7]+=h;
    }
    return Array.from(H, (x) => x.toString(16).padStart(8, "0")).join("");
  };
})();
const canon = (v) => Array.isArray(v) ? "[" + v.map(canon).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}" : JSON.stringify(v ?? null);
const fingerprint = (s) => "sha256:" + sha256("bank:" + s).slice(0, 32);
const routingValid = (r) => { const s = String(r).replace(/\D/g, ""); if (s.length !== 9) return false; const d = [...s].map(Number); return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0; };

/* ============================================================ reference data */
const CATEGORIES = [
  ["Office supplies", "6100"], ["Facilities & utilities", "6200"], ["IT & software", "6300"], ["Professional services", "6400"],
  ["Raw materials", "5100"], ["Freight & logistics", "5200"], ["Maintenance & repairs", "6500"], ["Marketing", "6600"],
];
const VENDOR_NAMES = [
  "Northwind Office Supply", "Brightpath Cleaning Services", "Cobalt Cloud Systems", "Meridian Legal Partners", "Ironline Steel Co.",
  "Copperleaf Consulting", "Swiftlane Freight", "Keystone Repairs", "Oakridge Paper Co.", "Bluefin Media", "Atlas Fasteners",
  "Harborview Couriers", "Granite Facility Group", "Pinecrest IT Services", "Summit Packaging", "Redwood Advisory", "Lakeside Electric",
  "Vertex Polymers", "Clearwater Utilities", "Beacon Print Works", "Trident Logistics", "Maple & Finch Catering", "Quarry Stone Supply", "Ember Analytics",
];
const PROFILES = {
  cautious: { label: "Cautious", errorRate: 0.07, blind: { duplicate: 0.08, over_po: 0.05, missing_grn: 0.05, blocked: 0, bank_changed: 0, no_po: 0 }, escShare: 0.7, conf: { right: [0.86, 0.99], wrong: [0.68, 0.9] } },
  fast_pay: { label: "Fast payer", errorRate: 0.06, blind: { duplicate: 0.5, over_po: 0.3, missing_grn: 0.35, blocked: 0.1, bank_changed: 0.75, no_po: 0.5 }, escShare: 0.25, conf: { right: [0.9, 0.99], wrong: [0.88, 0.98] } },
};
const ROLE_LABEL = { admin: "Admin", controller: "Controller", reviewer: "Reviewer", auditor: "Auditor (read-only)" };
const RANK = { auditor: 0, reviewer: 1, controller: 2, admin: 3 };
const PERMS = {
  admin: ["*"],
  controller: ["scorecard", "actions", "review", "rules:edit", "autonomy:change", "replay:run", "audit", "audit:export", "settings:view", "suppliers", "suppliers:manage", "payments"],
  reviewer: ["scorecard", "actions", "review", "audit", "suppliers"],
  auditor: ["scorecard", "actions", "audit", "audit:export", "suppliers"],
};
const can = (role, p) => PERMS[role].includes("*") || PERMS[role].includes(p);
const STATUS = {
  auto_approved: ["Approved automatically", "good"], pending_review: ["Waiting for review", "warn"], approved: ["Approved by a person", "good"],
  rejected: ["Rejected", "bad"], blocked: ["Blocked", "bad"], logged: ["Recorded (shadow)", "neutral"],
};
const DECISION = { approve: "Approve", reject: "Reject", escalate: "Send to a person" };
const APPROVER = { reviewer: "Any reviewer", controller: "Controller or above", admin: "CFO / admin" };
const badge = (pair, extra = "") => `<span class="badge t-${pair[1]}" ${extra}>${pair[0]}</span>`;

/* ============================================================ rules engine (pure) */
const RULE_TYPES = {
  three_way_match: { label: "Three-way match", desc: "Invoice must match its purchase order (within a tolerance) and goods must have been received." },
  approval_limits: { label: "Approval limits", desc: "Who must approve, by amount." },
  duplicate_invoice: { label: "Duplicate invoice check", desc: "Catches the same invoice sent twice." },
  bank_details_change: { label: "Bank detail change review", desc: "Sends invoices to a person when the vendor's bank details differ or changed recently." },
  blocked_vendor: { label: "Blocked vendor list", desc: "Never pays a blocked vendor." },
  custom: { label: "Custom condition", desc: "Your own condition." },
};
const CUSTOM_FIELDS = { amount: "Invoice amount", vendor: "Vendor name", category: "Vendor category", confidence: "Agent confidence (%)" };
const CUSTOM_OPS = { gt: "is more than", lt: "is less than", eq: "is", contains: "contains" };

function ruleSentence(r) {
  const p = r.params;
  switch (r.type) {
    case "three_way_match": return `Send to a person unless the invoice is within ${p.tolPct}% of its PO and the goods have been received in full`;
    case "approval_limits": return p.bands.map((b, i) => { const lo = i === 0 ? 0 : p.bands[i - 1][0]; return `${fmt(lo)}${b[0] ? ` – ${fmt(b[0])}` : " and above"}: ${b[1] ? APPROVER[b[1]].toLowerCase() : "no approval needed"}`; }).join("; ");
    case "duplicate_invoice": return `Block an invoice with the same number, or the same vendor and amount within ${p.windowDays} days, as an earlier one`;
    case "bank_details_change": return `Send to a person when bank details differ from the vendor record or changed in the last ${p.lookbackDays} days`;
    case "blocked_vendor": return "Block any invoice from a vendor on the blocked list";
    case "custom": return `${p.severity === "block" ? "Block" : "Send to a person"} when ${CUSTOM_FIELDS[p.field].toLowerCase()} ${CUSTOM_OPS[p.op]} ${p.field === "amount" ? fmt(p.value) : esc(p.value)}`;
  }
}

/** ctx: { subject, vendor, po, grnQty, prior: [{number, amount, date}], confidence } */
function evalRule(r, ctx) {
  const s = ctx.subject, p = r.params;
  const out = (result, explanation, extra = {}) => ({ ruleId: r.id, name: r.name, type: r.type, version: r.version, severity: r.severity, result, explanation, ...extra });
  switch (r.type) {
    case "three_way_match": {
      if (!s.po) return out("fail", "No purchase order on the invoice");
      const po = ctx.po;
      if (!po) return out("fail", `Can't find ${s.po} in the system of record`);
      const diff = (s.amount - po.amount) / po.amount;
      if (Math.abs(diff) * 100 > p.tolPct) return out("fail", `Invoice ${fmt(s.amount)} is ${(Math.abs(diff) * 100).toFixed(1)}% ${diff > 0 ? "above" : "below"} ${po.n} (${fmt(po.amount)}); tolerance is ${p.tolPct}%`);
      if (ctx.grnQty === null) return out("fail", `No goods received note for ${po.n}`);
      if (ctx.grnQty < po.qty) return out("fail", `Only ${ctx.grnQty} of ${po.qty} units received on ${po.n}`);
      return out("pass", `Matches ${po.n} and goods received in full`);
    }
    case "approval_limits": {
      let lo = 0;
      for (const [upTo, role] of p.bands) {
        if (upTo === null || s.amount < upTo) {
          const band = `${fmt(lo)}${upTo ? ` – ${fmt(upTo)}` : " and above"}`;
          return role ? out("fail", `${fmt(s.amount)} is in the ${band} band and needs approval by ${APPROVER[role].toLowerCase()}`, { requiredRole: role, routing: true })
                      : out("pass", `${fmt(s.amount)} is in the ${band} band, which needs no approval`);
        }
        lo = upTo;
      }
      return out("pass", "Within limits");
    }
    case "duplicate_invoice": {
      const t = new Date(s.date).getTime();
      const m = ctx.prior.find((x) => x.number === s.number) || ctx.prior.find((x) => x.amount === s.amount && Math.abs(new Date(x.date).getTime() - t) <= p.windowDays * DAY);
      if (m) return out("fail", m.number === s.number ? `Same invoice number ${s.number} as an earlier invoice from this vendor` : `Same vendor and amount (${fmt(s.amount)}) as invoice ${m.number} on ${iso(m.date)}`);
      return out("pass", `No earlier invoice from this vendor with the same amount within ${p.windowDays} days or a matching number`);
    }
    case "bank_details_change": {
      const v = ctx.vendor;
      if (!v) return out("fail", "Vendor isn't in the vendor master; bank details can't be checked");
      if (s.bankFp && s.bankFp !== v.bankFp) return out("fail", `The bank details on this invoice don't match the details on file for ${v.name}`);
      if (v.bankChangedAt && (new Date(s.at ?? NOW).getTime() - new Date(v.bankChangedAt).getTime()) <= p.lookbackDays * DAY && new Date(v.bankChangedAt) <= new Date(s.at ?? NOW))
        return out("fail", `${v.name} changed its bank details on ${iso(v.bankChangedAt)}; payments within ${p.lookbackDays} days of a change need review`);
      return out("pass", `Bank details match the vendor record and have not changed in the last ${p.lookbackDays} days`);
    }
    case "blocked_vendor": {
      if (ctx.vendor?.blocked) return out("fail", `${ctx.vendor.name} is blocked: ${ctx.vendor.blockedReason}`);
      return out("pass", "Vendor is not on the blocked list");
    }
    case "custom": {
      const v = p.field === "amount" ? s.amount : p.field === "vendor" ? s.vendorName : p.field === "category" ? ctx.vendor?.category ?? "" : Math.round((ctx.confidence ?? 0) * 100);
      let hit = false;
      if (p.op === "gt") hit = Number(v) > Number(p.value); else if (p.op === "lt") hit = Number(v) < Number(p.value);
      else if (p.op === "eq") hit = String(v).toLowerCase() === String(p.value).toLowerCase(); else hit = String(v).toLowerCase().includes(String(p.value).toLowerCase());
      const shown = p.field === "amount" ? fmt(v) : esc(v);
      return out(hit ? "fail" : "pass", hit ? `${CUSTOM_FIELDS[p.field]} ${shown} ${CUSTOM_OPS[p.op]} ${p.field === "amount" ? fmt(p.value) : esc(p.value)}` : "Condition not met");
    }
  }
}

function decideGate({ level, limit, threshold, decision, confidence, amount, results }) {
  const eff = level === 0 ? 3 : level;
  const reasons = [];
  const failed = results.filter((r) => r.result === "fail");
  const reqRole = failed.reduce((m, r) => (r.requiredRole && (!m || RANK[r.requiredRole] > RANK[m]) ? r.requiredRole : m), null);
  const confOk = confidence !== null && confidence >= threshold;
  const confReason = `Agent confidence ${pct(confidence, 0)} is below the ${pct(threshold, 0)} threshold`;
  let computed;
  if (decision === "approve") {
    const blocking = failed.filter((r) => r.severity === "block");
    if (blocking.length) { computed = "block"; reasons.push(...blocking.map((r) => r.explanation)); }
    else {
      reasons.push(...failed.map((r) => r.explanation));
      if (!confOk) reasons.push(confReason);
      if (reasons.length) computed = "needs_human";
      else if (eff === 1) { computed = "needs_human"; reasons.push("Level 1: a person approves every invoice"); }
      else if (eff === 2 && amount > limit) { computed = "needs_human"; reasons.push(`${fmt(amount)} is above the ${fmt(limit)} auto-approve limit`); }
      else { computed = "auto_approve"; reasons.push(eff === 2 ? `Passed every rule and is within the ${fmt(limit)} auto-approve limit` : "Passed every rule"); }
    }
  } else if (decision === "escalate") { computed = "needs_human"; reasons.push("The agent asked for a person to decide"); }
  else {
    if (eff === 3 && confOk) { computed = "auto_approve"; reasons.push("Rejection applied automatically at Level 3"); }
    else { computed = "needs_human"; reasons.push(confOk ? "A person confirms every rejection below Level 3" : confReason); }
  }
  const shadow = level === 0;
  let status;
  if (shadow) status = "logged";
  else if (computed === "block") status = "blocked";
  else if (computed === "needs_human") status = "pending_review";
  else status = decision === "reject" ? "rejected" : "auto_approved";
  const OUT = { auto_approve: "approved automatically", needs_human: "sent to a person", block: "blocked" };
  return { computed, status, enforced: !shadow, requiredRole: computed === "needs_human" ? reqRole ?? "reviewer" : null,
    reasons: shadow ? [`Shadow mode: recorded only. Would have been ${OUT[computed]}`, ...reasons] : reasons };
}

/* ============================================================ mock agents */
function correctFor(issue) { return !issue ? "approve" : issue === "duplicate" || issue === "blocked" ? "reject" : "escalate"; }
function mockDecide(agent, inv, issue) {
  const prof = PROFILES[agent.profile];
  const scale = agent.errorRate / prof.errorRate;
  const u = (salt) => unit(agent.seed, inv.id, salt);
  const right = correctFor(issue);
  let decision = right, wrong = false, reason;
  if (issue) {
    if (u("miss") < Math.min(1, prof.blind[issue] * scale)) { decision = "approve"; wrong = true; reason = inv.po ? `Matches ${inv.po}; OK to pay` : "Looks fine to pay"; }
    else reason = { duplicate: "Looks like a duplicate of an earlier invoice", blocked: "Vendor is blocked", over_po: `Doesn't match ${inv.po}`, missing_grn: "Goods haven't been received yet", bank_changed: "Bank details differ from our records", no_po: "No PO on the invoice" }[issue];
  } else if (u("clean") < agent.errorRate) {
    wrong = true;
    if (u("which") < prof.escShare) { decision = "escalate"; reason = "Unusual amount for this vendor; would like a person to check"; }
    else { decision = "reject"; reason = "Could not match this invoice to a purchase order"; }
  } else reason = `Matches ${inv.po} and goods received; within tolerance`;
  const [lo, hi] = wrong ? prof.conf.wrong : prof.conf.right;
  return { decision, reason, confidence: Math.round((lo + u("conf") * (hi - lo)) * 100) / 100, wrong };
}
