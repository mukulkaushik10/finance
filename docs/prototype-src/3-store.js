/* ============================================================ state + services */
let S;

const GENESIS = "0".repeat(64);
function audit(type, entity, entityId, actor, payload, at = new Date()) {
  S.auditPending.push({ type, entity, entityId, actor, payload, at: new Date(at) });
}
function flushAudit(sort = false) {
  const list = S.auditPending; S.auditPending = [];
  if (sort) list.sort((a, b) => a.at - b.at);
  for (const e of list) {
    const prev = S.audit.length ? S.audit[S.audit.length - 1].hash : GENESIS;
    const rec = { seq: S.audit.length + 1, ...e, prevHash: prev };
    rec.hash = hashRecord(rec);
    S.audit.push(rec);
  }
}
const hashRecord = (r) => sha256(canon({ seq: r.seq, type: r.type, entity: r.entity, entityId: r.entityId, actor: r.actor, at: new Date(r.at).toISOString(), payload: r.payload, prevHash: r.prevHash }));
function verifyChain() {
  const problems = []; let prev = GENESIS;
  S.audit.forEach((r, i) => {
    if (r.seq !== i + 1) problems.push([r.seq, `Record #${i + 1} is missing`]);
    if (r.prevHash !== prev) problems.push([r.seq, `Record #${r.seq} does not link to the record before it`]);
    if (hashRecord(r) !== r.hash) problems.push([r.seq, `Record #${r.seq} was changed after it was written (its contents no longer match its fingerprint)`]);
    prev = r.hash;
  });
  return { ok: problems.length === 0, checked: S.audit.length, head: prev, problems, at: new Date() };
}

const vendorByCode = (c) => S.vendors.find((v) => v.code === c);
const vendorByName = (n) => S.vendors.find((v) => v.name.toLowerCase() === String(n).toLowerCase());
const userById = (id) => S.users.find((u) => u.id === id);
const agentById = (id) => S.agents.find((a) => a.id === id);
const activeRules = () => S.rules.filter((r) => r.enabled);

function buildCtx(subject, prior, confidence) {
  const vendor = vendorByCode(subject.vendorCode) ?? vendorByName(subject.vendorName) ?? null;
  const po = subject.po ? S.pos[subject.po] ?? null : null;
  const grnQty = po && S.grns[po.n] !== undefined ? S.grns[po.n] : null;
  return { subject, vendor, po, grnQty, prior, confidence };
}
function priorLive(subject) {
  return S.actions.filter((a) => a.vendorCode === subject.vendorCode && a.subjectId !== subject.id && a.status !== "rejected" && a.status !== "blocked")
    .map((a) => ({ number: a.number, amount: a.amount, date: a.invoiceDate }));
}

/** The /v1/actions/evaluate pipeline: rules + autonomy level, stored with an audit record. */
function evaluate(agent, subject, proposal, at = new Date()) {
  const ctx = buildCtx({ ...subject, at }, priorLive(subject), proposal.confidence);
  const rules = activeRules();
  const results = rules.map((r) => evalRule(r, ctx));
  const wf = S.workflow;
  const g = decideGate({ level: wf.level, limit: wf.limit, threshold: wf.threshold, decision: proposal.decision, confidence: proposal.confidence, amount: subject.amount, results });
  const a = {
    id: uid("act_"), subjectId: subject.id, number: subject.number, vendorCode: ctx.vendor?.code ?? subject.vendorName, vendorName: ctx.vendor?.name ?? subject.vendorName,
    amount: subject.amount, po: subject.po, grn: subject.grn, invoiceDate: subject.date, source: subject.source ?? "agent",
    agentId: agent.id, agentVersion: agent.version, proposed: proposal.decision, gl: proposal.gl ?? ctx.vendor?.gl ?? "6900", reason: proposal.reason, confidence: proposal.confidence,
    results, reasons: g.reasons, status: g.status, computed: g.computed, enforced: g.enforced, requiredRole: g.requiredRole, level: wf.level,
    ruleSet: rules.map((r) => `${r.id}@${r.version}`).join(","), createdAt: new Date(at), decidedAt: g.status === "pending_review" ? null : new Date(at),
    cost: agent.cost, review: null, truth: subject.truth ?? null,
  };
  S.actions.push(a);
  audit("action.evaluated", "action", a.id, { type: "agent", id: agent.id, name: agent.name }, {
    invoice: subject.number, vendor: a.vendorName, amount: a.amount, proposed: { decision: a.proposed, confidence: a.confidence, reason: a.reason },
    ruleResults: results.map((r) => ({ rule: r.name, version: r.version, result: r.result })), ruleSet: a.ruleSet, outcome: a.status, reasons: a.reasons, level: a.level,
  }, at);
  return a;
}

const isControlFailure = (r) => r.result === "fail" && !r.routing;

function reviewAction(user, actionId, { decision, reason, rightToEscalate = true }, at = new Date(), opts = {}) {
  const a = S.actions.find((x) => x.id === actionId);
  if (!a) throw new Error("Invoice not found");
  if (a.review) throw new Error("This invoice has already been reviewed");
  const spot = a.status === "logged";
  if (a.status !== "pending_review" && !spot) throw new Error("This invoice isn't waiting for review");
  if (!spot && RANK[user.role] < RANK[a.requiredRole ?? "reviewer"]) throw new Error(`This invoice needs a decision by ${APPROVER[a.requiredRole].toLowerCase()}`);
  if (user.role === "auditor") throw new Error("Auditors can't make decisions");
  if (!reason || reason.trim().length < 10) throw new Error("Please give a reason of at least a few words");
  const correct = a.proposed === "escalate" && rightToEscalate ? "escalate" : decision;
  a.review = { by: user.id, byName: user.name, decision, reason, correct, agentCorrect: a.proposed === correct, at: new Date(at), spot };
  if (!spot) { a.status = decision === "approve" ? "approved" : "rejected"; a.decidedAt = new Date(at); }
  const overridden = decision === "approve" ? a.results.filter(isControlFailure).map((r) => r.name) : [];
  audit("action.reviewed", "action", a.id, { type: "user", id: user.id, name: user.name }, {
    invoice: a.number, reviewer: `${user.name} (${ROLE_LABEL[user.role]})`, decision, reason, agentProposed: a.proposed, agentWasCorrect: a.review.agentCorrect, overriddenRules: overridden, spotCheck: spot,
  }, at);
  if (!opts.skipInvoiceSync) syncInvoice(a.id, at);
  return a;
}

/* ---- metrics shared by scorecard, autonomy and drill-downs */
function moneyAtRisk(a) { return (a.status === "approved" || a.status === "auto_approved") && a.results.some(isControlFailure); }
function accuracyOver(list) { const r = list.filter((a) => a.review); return r.length ? r.filter((a) => a.review.agentCorrect).length / r.length : null; }
function rollingAccuracy() {
  const reviewed = S.actions.filter((a) => a.review).sort((x, y) => y.review.at - x.review.at).slice(0, S.workflow.window);
  return { n: reviewed.length, acc: accuracyOver(reviewed) };
}
function weekStart(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
function weekly() {
  const map = new Map();
  for (const a of S.actions) {
    const k = weekStart(a.createdAt).getTime();
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(a);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([k, list]) => {
    const auto = list.filter((a) => a.status === "auto_approved");
    const people = list.filter((a) => a.review && !a.review.spot).length;
    const agentCost = list.reduce((t, a) => t + a.cost, 0);
    return {
      start: new Date(k), list, volume: list.length,
      accuracy: accuracyOver(list), escalation: list.filter((a) => a.computed === "needs_human").length / list.length,
      autoAmount: auto.reduce((t, a) => t + a.amount, 0), autoCount: auto.length,
      risk: list.filter(moneyAtRisk).reduce((t, a) => t + a.amount, 0), riskCount: list.filter(moneyAtRisk).length,
      blocked: list.filter((a) => a.status === "blocked").reduce((t, a) => t + a.amount, 0),
      costPer: Math.round((agentCost + people * 450) / list.length),
    };
  });
}

/* ---- autonomy */
function changeLevel(user, to, reason, at = new Date()) {
  const wf = S.workflow;
  if (!can(user.role, "autonomy:change")) throw new Error("Your role can't change the autonomy level");
  if (to === wf.level) throw new Error("That's already the current level");
  if (!reason || reason.trim().length < 10) throw new Error("Give a reason of at least a few words");
  if (to > wf.level && to > 0) {
    const r = rollingAccuracy();
    if (r.n < wf.window) throw new Error(`Promotion needs ${wf.window} reviewed invoices; there are ${r.n}`);
    if (r.acc < wf.target) throw new Error(`Accuracy over the last ${wf.window} reviewed invoices is ${pct(r.acc)}; promotion needs ${pct(wf.target)}`);
  }
  const from = wf.level; wf.level = to;
  S.autonomyHistory.unshift({ from, to, by: user.name, reason, at: new Date(at), accuracy: rollingAccuracy().acc });
  audit("autonomy.changed", "workflow", "wf_ap_main", { type: "user", id: user.id, name: user.name }, { from, to, reason, accuracy: rollingAccuracy().acc }, at);
}

/* ---- rules */
function saveRule(user, rule, params, reason, extra = {}) {
  if (!can(user.role, "rules:edit")) throw new Error("Your role can't change rules");
  if (!reason || reason.trim().length < 5) throw new Error("Say briefly why you're changing this rule");
  rule.version += 1; rule.params = params; Object.assign(rule, extra);
  rule.versions.unshift({ v: rule.version, params: JSON.parse(JSON.stringify(params)), reason, by: user.name, at: new Date(), enabled: rule.enabled, severity: rule.severity });
  audit("rule.changed", "rule", rule.id, { type: "user", id: user.id, name: user.name }, { rule: rule.name, version: rule.version, sentence: ruleSentence(rule), enabled: rule.enabled, reason });
}

/* ---- generator (replay set and live history) */
function genInvoices(seed, count, start, end, opts) {
  const r = rng(seed);
  const out = [];
  const span = end.getTime() - start.getTime();
  const pool = S.vendors.filter((v) => !["V-0002", "V-0005", "V-0009"].includes(v.code));
  for (let i = 0; i < count; i++) {
    const roll = r.next();
    let issue = roll < 0.80 ? null : roll < 0.84 ? "duplicate" : roll < 0.89 ? "over_po" : roll < 0.93 ? "missing_grn" : roll < 0.95 ? "blocked" : roll < 0.97 ? "bank_changed" : "no_po";
    let vendor = issue === "blocked" ? r.pick(pool.filter((v) => v.blocked)) : issue === "bank_changed" ? r.pick(pool.filter((v) => !v.blocked)) : r.pick(pool.filter((v) => !v.blocked));
    const date = new Date(start.getTime() + (span * (i + r.next())) / count);
    let amount = Math.round(Math.exp(Math.log(18000) + r.next() * (Math.log(4200000) - Math.log(18000))) / 100) * 100 + r.int(0, 99);
    const id = `${opts.prefix}-${String(opts.startNo + i).padStart(5, "0")}`;
    let number = id;
    if (issue === "duplicate" && out.length) {
      const orig = r.pick(out.filter((x) => !x.issue).slice(-25));
      if (orig) { vendor = vendorByCode(orig.vendorCode); amount = orig.amount; number = r.next() < 0.5 ? orig.number : orig.number + "-A"; }
      else issue = null;
    } else if (issue === "duplicate") issue = null;
    const n = `PO-${opts.poStart + i}`;
    const qty = r.int(1, 60);
    const poAmount = issue === "over_po" ? Math.round(amount / 1.12) : amount;
    let po = issue === "no_po" ? null : n;
    if (po && issue !== "duplicate") {
      S.pos[n] = { n, vendorCode: vendor.code, amount: poAmount, qty, unit: Math.round(poAmount / qty), closed: opts.closed, raised: new Date(date.getTime() - 9 * DAY) };
      S.grns[n] = issue === "missing_grn" ? (r.next() < 0.5 ? undefined : Math.max(0, qty - r.int(1, qty))) : qty;
      if (S.grns[n] === undefined) delete S.grns[n];
    }
    if (issue === "duplicate") { const orig = out.find((x) => x.number === number || x.number + "-A" === number); po = orig?.po ?? null; }
    out.push({
      id, number, vendorCode: vendor.code, vendorName: vendor.name, amount, po, grn: po && S.grns[po] !== undefined ? po.replace("PO", "GRN") : null,
      date: iso(date), at: date, bankFp: issue === "bank_changed" ? fingerprint(vendor.code + ":unknown") : vendor.bankFp, issue, correct: correctFor(issue), gl: vendor.gl,
    });
  }
  return out;
}

/* ---- seeding */
function seed() {
  S = {
    org: { name: "Harbor & Pine Manufacturing", billing: "400 Dockside Ave, Suite 210, Portland, OR 97209" },
    users: [
      { id: "u_dana", name: "Dana Whitfield", email: "controller@harborpine.example", role: "controller", active: true },
      { id: "u_alex", name: "Alex Morgan", email: "admin@harborpine.example", role: "admin", active: true },
      { id: "u_sam", name: "Sam Okafor", email: "auditor@harborpine.example", role: "auditor", active: true },
      { id: "u_riley", name: "Riley Chen", email: "reviewer@harborpine.example", role: "reviewer", active: true },
    ],
    vendors: [], agents: [], rules: [], actions: [], audit: [], auditPending: [], autonomyHistory: [], pos: {}, grns: {},
    workflow: { id: "wf_ap_main", name: "Accounts payable: invoice approval", level: 1, limit: 500000, threshold: 0.85, window: 50, target: 0.95, connector: "QuickBooks Online (demo)", primaryAgent: "agt_cautious" },
    datasets: [], comparisons: [],
    bankAccounts: [], connections: [], supplierAccounts: [], supplierUsers: [], supplierBanks: [], bankChanges: [], invoices: [], notices: [],
  };
  VENDOR_NAMES.forEach((name, i) => {
    const [category, gl] = CATEGORIES[i % CATEGORIES.length];
    const code = `V-${String(i + 1).padStart(4, "0")}`;
    S.vendors.push({ code, name, category, gl, bankFp: fingerprint(code + ":original"), bankChangedAt: null, blocked: false, blockedReason: null });
  });
  S.vendors[10].blocked = true; S.vendors[10].blockedReason = "Failed sanctions screening";
  S.vendors[16].blocked = true; S.vendors[16].blockedReason = "Suspected fraudulent invoicing";
  S.vendors[12].bankChangedAt = new Date(NOW.getTime() - 20 * DAY); S.vendors[12].bankFp = fingerprint("V-0013:changed");
  S.vendors[1].category = "Facilities & utilities"; S.vendors[1].gl = "6200";
  S.vendors[4].category = "Professional services"; S.vendors[4].gl = "6400"; S.vendors[5].category = "Professional services"; S.vendors[5].gl = "6400";

  S.agents.push(
    { id: "agt_cautious", name: "Cautious Co. AP Agent", builder: "Cautious Co.", kind: "mock", profile: "cautious", errorRate: 0.07, seed: "cautious-v1", version: "2.3.0", cost: 4, keyPrefix: "cr_demo_caut", active: true, created: new Date(NOW.getTime() - 70 * DAY) },
    { id: "agt_fastpay", name: "Fast-Pay AI", builder: "FastPay Labs", kind: "mock", profile: "fast_pay", errorRate: 0.06, seed: "fastpay-v1", version: "0.9.4", cost: 2, keyPrefix: "cr_demo_fast", active: true, created: new Date(NOW.getTime() - 70 * DAY) },
  );
  const t0 = new Date(NOW.getTime() - 60 * DAY);
  const mk = (id, type, name, severity, params) => ({ id, type, name, severity, params, version: 1, enabled: true, versions: [{ v: 1, params: JSON.parse(JSON.stringify(params)), reason: "Default rule", by: "System", at: t0, enabled: true, severity }] });
  S.rules.push(
    mk("rule_3wm", "three_way_match", "Three-way match", "review", { tolPct: 5 }),
    mk("rule_lim", "approval_limits", "Approval limits", "review", { bands: [[1000000, null], [5000000, "controller"], [null, "admin"]] }),
    mk("rule_dup", "duplicate_invoice", "Duplicate invoice check", "block", { windowDays: 30 }),
    mk("rule_bank", "bank_details_change", "New or changed bank details", "review", { lookbackDays: 90 }),
    mk("rule_blk", "blocked_vendor", "Blocked vendors", "block", {}),
  );
  const sys = { type: "system", id: "seed", name: "System" };
  audit("workflow.created", "workflow", "wf_ap_main", sys, { name: S.workflow.name, level: 1, autoApproveLimit: S.workflow.limit, confidenceThreshold: S.workflow.threshold }, t0);
  for (const rule of S.rules) audit("rule.created", "rule", rule.id, sys, { rule: rule.name, version: 1, sentence: ruleSentence(rule) }, t0);
  for (const a of S.agents) audit("agent.created", "agent", a.id, { type: "user", id: "u_alex", name: "Alex Morgan" }, { agent: a.name, version: a.version }, t0);

  // Replay set: 1,000 past invoices with known outcomes (their POs are closed).
  const rs = genInvoices("replay-v1", 1000, new Date(NOW.getTime() - 160 * DAY), new Date(NOW.getTime() - 65 * DAY), { prefix: "INV", startNo: 1, poStart: 40000, closed: true });
  S.datasets.push({ id: "ds_seed", name: "Past invoices, Jun–Sep (seed)", uploadedBy: "Dana Whitfield", at: new Date(NOW.getTime() - 3 * DAY), cases: rs });

  // Eight weeks of live history through the real gate.
  const live = genInvoices("live-v1", 170, new Date(NOW.getTime() - 56 * DAY), new Date(NOW.getTime() - 3 * 3600e3), { prefix: "LIV", startNo: 1, poStart: 70000, closed: false });
  const dana = userById("u_dana"), riley = userById("u_riley");
  const promoteAt = new Date(NOW.getTime() - 35 * DAY);
  let promoted = false;
  const rr = rng("reviews-v1");
  const OVERRIDE = ["Price increase agreed with buyer by email, OK to pay", "Partial delivery accepted by warehouse; remainder cancelled", "Freight surcharge confirmed with logistics team", "Called vendor on number from master file; bank change is genuine"];
  for (const inv of live) {
    if (!promoted && inv.at > promoteAt) {
      flushAudit(true);
      S.workflow.level = 2; promoted = true;
      S.autonomyHistory.unshift({ from: 1, to: 2, by: "Dana Whitfield", reason: "Three weeks at Level 1 with 96% agreement; auto-approve small clean invoices", at: promoteAt, accuracy: 0.96 });
      audit("autonomy.changed", "workflow", "wf_ap_main", { type: "user", id: dana.id, name: dana.name }, { from: 1, to: 2, reason: S.autonomyHistory[0].reason, accuracy: 0.96 }, promoteAt);
    }
    const agent = agentById("agt_cautious");
    const p = mockDecide({ ...agent, errorRate: 0.02 }, inv, inv.issue); // v2.3.0 in production: fewer errors than the replay set's older version
    const a = evaluate(agent, { ...inv, truth: inv.correct }, { decision: p.decision, confidence: p.confidence, reason: p.reason, gl: inv.gl }, inv.at);
    if (a.status === "pending_review" && inv.at < new Date(NOW.getTime() - 5 * DAY)) {
      const who = a.requiredRole === "reviewer" && rr.next() < 0.5 ? riley : dana;
      const reviewer = RANK[who.role] >= RANK[a.requiredRole] ? who : userById("u_alex");
      let decision = inv.correct === "approve" ? "approve" : inv.correct === "reject" ? "reject" : rr.next() < 0.55 ? "approve" : "reject";
      const reason = decision === "approve" ? (a.results.some(isControlFailure) ? rr.pick(OVERRIDE) : rr.pick(["Checked against PO and receipt, all fine", "Matches PO, goods received in full", "Verified with budget owner, OK to pay"])) : rr.pick(["Duplicate of an invoice already paid", "No PO and the budget owner doesn't recognise it", "Could not verify with vendor; rejected"]);
      reviewAction(reviewer, a.id, { decision, reason, rightToEscalate: inv.correct !== "approve" }, new Date(inv.at.getTime() + rr.int(2, 40) * 3600e3), { skipInvoiceSync: true });
    }
  }
  flushAudit(true);
  seedPortal();
  flushAudit(true);
}

function seedPortal() {
  const t = (d, h = 10) => new Date(Math.floor((NOW.getTime() - d * DAY) / DAY) * DAY + h * 3600e3);
  const alex = userById("u_alex"), dana = userById("u_dana");
  addBankAccount(alex, { nickname: "Operating account", holder: "Harbor & Pine Manufacturing Inc.", bank: "Pacific Commerce Bank", routing: "123000848", account: "000123456789", isDefault: true }, t(45));
  addBankAccount(alex, { nickname: "Supplier payments", holder: "Harbor & Pine Manufacturing Inc.", bank: "Columbia Business Bank", routing: "121000358", account: "550099887766" }, t(45));
  const connect = (code, user, legal, ein, phone, addr, bank, daysAgo) => {
    const v = vendorByCode(code);
    const acct = { id: uid("sa_"), legalName: legal, ein, email: user.email, phone, address: addr };
    S.supplierAccounts.push(acct);
    S.supplierUsers.push({ id: user.id, accountId: acct.id, name: user.name, email: user.email, password: "demo1234", role: "owner" });
    const b = { id: uid("sb_"), accountId: acct.id, holder: legal, bank: bank.bank, routing: bank.routing, last4: bank.account.slice(-4), fp: fingerprint(bank.routing + ":" + bank.account), at: t(daysAgo) };
    S.supplierBanks.push(b);
    v.bankFp = b.fp;
    const c = { id: uid("conn_"), vendorCode: code, accountId: acct.id, status: "active", inviteEmail: user.email, invitedAt: t(daysAgo + 2), acceptedAt: t(daysAgo), bankId: b.id, terms: 30, token: null };
    S.connections.push(c);
    audit("supplier.connected", "vendor", code, { type: "supplier", id: user.id, name: user.name }, { vendor: v.name, supplierAccount: legal }, t(daysAgo));
    return { v, acct, c };
  };
  const main = connect("V-0002", { id: "su_priya", name: "Priya Raman", email: "priya@supplier.example" }, "Brightpath Cleaning Services LLC", "84-2210937", "(503) 555-0142", "1180 Industrial Way, Tacoma, WA 98421", { bank: "First Cascade Bank", routing: "121000358", account: "4402119876" }, 40);
  const second = connect("V-0005", { id: "su_marco", name: "Marco Diaz", email: "marco@supplier.example" }, "Copperleaf Consulting LLC", "47-1188203", "(206) 555-0187", "92 Harbor Loop, Seattle, WA 98121", { bank: "Summit Trust", routing: "021000021", account: "7781203344" }, 25);
  const po = (n, qty, unitPrice, received, daysAgo) => { S.pos[n] = { n, vendorCode: "V-0002", amount: qty * unitPrice, qty, unit: unitPrice, closed: false, raised: t(daysAgo) }; if (received !== null) S.grns[n] = received; };
  po("PO-90001", 40, 8500, 40, 30); po("PO-90002", 120, 6250, 80, 14); po("PO-90003", 10, 120000, 10, 6); po("PO-90004", 25, 4000, null, 3); po("PO-90005", 200, 1850, 200, 5); po("PO-90006", 12, 9900, 12, 2);

  const priya = supplierCtx("su_priya");
  const mkInv = (num, poN, daysAgo, lines, notes) => createDraft(priya, { connId: main.c.id, number: num, date: iso(t(daysAgo)), po: poN, lines, notes }, t(daysAgo, 9));
  const i1 = mkInv("BP-1001", "PO-90001", 28, [{ d: "Facilities & utilities, 40 units as ordered", q: 40, u: 8500, tax: 0 }]);
  submitInvoice(priya, i1.id, t(28, 11));
  const i2 = mkInv("BP-1002", "PO-90002", 9, [{ d: "Facilities & utilities, first delivery (60 of 120 units)", q: 60, u: 6250, tax: 0 }]);
  submitInvoice(priya, i2.id, t(9, 14));
  const i3 = mkInv("BP-1003", "PO-90003", 1, [{ d: "Facilities & utilities, 10 units, installed", q: 10, u: 120000, tax: 0 }], "Installation completed on site; sign-off attached to the delivery note.");
  submitInvoice(priya, i3.id, t(1, 10));
  const i4 = mkInv("BP-0998", null, 6, [{ d: "Rush freight surcharge", q: 1, u: 64000, tax: 0 }]);
  submitInvoice(priya, i4.id, t(6, 16));
  mkInv("BP-1004", "PO-90004", 0, [{ d: "Facilities & utilities, 25 units", q: 25, u: 4000, tax: 0 }]);
  for (const inv of [i1, i2]) if (inv.status === "under_review") decideInvoice(dana, inv.id, { decision: "approve", reason: "Matches the PO and the goods received note" }, t(inv === i1 ? 27 : 2, 15));
  schedulePayment(dana, i1.id, { from: S.bankAccounts[0].id, payOn: iso(t(10)) }, t(10, 15), true);
  markPaid(dana, i1.id, { paidOn: iso(t(7)), ref: "ACH-55102" }, t(7, 9));
  schedulePayment(dana, i2.id, { from: S.bankAccounts[0].id, payOn: iso(new Date(NOW.getTime() + 2 * DAY)) }, t(1, 16));
  if (i4.status === "under_review") decideInvoice(dana, i4.id, { decision: "send_back", reason: "No purchase order; freight should be billed against the PO", message: "Please add the PO number this freight relates to (it should be PO-90002) and send it again." }, t(5, 11));

  // Second supplier asks to be paid somewhere else (waiting for the buyer)
  requestBankChange(supplierCtx("su_marco"), { holder: "Copperleaf Consulting LLC", bank: "Evergreen Federal Credit Union", routing: "123000848", account: "991200457781", confirm: "991200457781", password: "demo1234" }, t(0, 8));
  // An invitation waiting to be accepted
  S.connections.push({ id: uid("conn_"), vendorCode: "V-0009", accountId: null, status: "invited", inviteEmail: "accounts@oakridgepaper.example", invitedAt: t(1), acceptedAt: null, bankId: null, terms: 30, token: "demo-invite-harbor-pine" });
  audit("supplier.invited", "vendor", "V-0009", { type: "user", id: dana.id, name: dana.name }, { vendor: "Oakridge Paper Co.", email: "accounts@oakridgepaper.example" }, t(1));
}

/* ---- buyer bank accounts */
function addBankAccount(user, d, at = new Date()) {
  if (!can(user.role, "*") && user.role !== "admin") throw new Error("Only admins can add bank accounts");
  if (!d.nickname || d.nickname.trim().length < 2) throw new Error("Give the account a name");
  if (!d.holder || !d.bank) throw new Error("Enter the account holder and bank");
  if (!routingValid(d.routing)) throw new Error("Enter a valid 9-digit US routing number");
  const acct = String(d.account).replace(/\D/g, "");
  if (acct.length < 4 || acct.length > 17) throw new Error("Account numbers are 4 to 17 digits");
  const fp = fingerprint(d.routing + ":" + acct);
  if (S.bankAccounts.some((b) => b.fp === fp && b.state === "active")) throw new Error("This account is already set up");
  const def = d.isDefault || !S.bankAccounts.some((b) => b.state === "active");
  if (def) S.bankAccounts.forEach((b) => (b.isDefault = false));
  const b = { id: uid("ba_"), nickname: d.nickname.trim(), holder: d.holder, bank: d.bank, routing: String(d.routing).replace(/\D/g, ""), last4: acct.slice(-4), fp, isDefault: def, state: "active", at: new Date(at) };
  S.bankAccounts.push(b);
  audit("bank_account.added", "bank_account", b.id, { type: "user", id: user.id, name: user.name }, { nickname: b.nickname, bank: b.bank, routing: b.routing, last4: b.last4, isDefault: def }, at);
  return b;
}

/* ---- supplier portal */
function supplierCtx(supUserId) {
  const u = S.supplierUsers.find((x) => x.id === supUserId);
  return { user: u, account: S.supplierAccounts.find((a) => a.id === u.accountId) };
}
const connsFor = (sctx) => S.connections.filter((c) => c.accountId === sctx.account.id && c.status !== "invited");
const bankOf = (c) => S.supplierBanks.find((b) => b.id === c?.bankId) ?? null;
const invTotal = (inv) => inv.lines.reduce((t, l) => t + l.q * l.u + Math.round((l.q * l.u * (l.tax || 0)) / 10000), 0);
const invSubtotal = (inv) => inv.lines.reduce((t, l) => t + l.q * l.u, 0);
const connOf = (inv) => S.connections.find((c) => c.id === inv.connId);
function event(inv, status, note, who, at = new Date()) { inv.events.push({ status, note, who, at: new Date(at) }); }

function openPOs(sctx, connId) {
  const c = S.connections.find((x) => x.id === connId);
  return Object.values(S.pos).filter((p) => p.vendorCode === c.vendorCode && !p.closed).map((p) => {
    const billed = S.invoices.filter((i) => i.connId === c.id && i.kind === "invoice" && i.po === p.n && !["draft", "cancelled", "rejected"].includes(i.status));
    const qtyBilled = billed.reduce((t, i) => t + i.lines.reduce((q, l) => q + l.q, 0), 0);
    const amtBilled = billed.reduce((t, i) => t + invSubtotal(i), 0);
    return { ...p, received: S.grns[p.n] ?? 0, qtyBilled, amtBilled, remaining: Math.max(0, p.amount - amtBilled) };
  }).filter((p) => p.remaining > 0).sort((a, b) => b.raised - a.raised);
}

function createDraft(sctx, d, at = new Date()) {
  const c = S.connections.find((x) => x.id === d.connId);
  if (!c || c.accountId !== sctx.account.id) throw new Error("Choose one of your buyers");
  if (c.status !== "active") throw new Error("Your access to this buyer is suspended");
  if (!d.number || !/^[A-Za-z0-9][A-Za-z0-9\-_/.]*$/.test(d.number)) throw new Error("Enter your invoice number (letters, numbers and - _ / . only)");
  if (S.invoices.some((i) => i.connId === c.id && i.kind === (d.kind ?? "invoice") && i.number === d.number)) throw new Error(`You've already used number ${d.number} with ${S.org.name}. Each invoice needs its own number.`);
  if (!d.lines.length) throw new Error("Add at least one line");
  for (const l of d.lines) { if (!l.d) throw new Error("Describe what each line is for"); if (!(l.q >= 1)) throw new Error("Quantities must be at least 1"); if (!(l.u >= 0)) throw new Error("Enter a unit price for every line"); }
  const inv = {
    id: uid("inv_"), connId: c.id, accountId: sctx.account.id, vendorCode: c.vendorCode, kind: d.kind ?? "invoice", creditFor: d.creditFor ?? null,
    number: d.number, status: "draft", po: d.po || null, grn: null, date: d.date, due: d.due || iso(new Date(new Date(d.date).getTime() + c.terms * DAY)), notes: d.notes || "",
    lines: d.lines.map((l) => ({ ...l })), revision: 0, actionId: null, supplierNote: null, events: [], msgs: [], createdAt: new Date(at),
    sentAt: null, payOn: null, payFrom: null, paidOn: null, ref: null, bankFp: null,
  };
  event(inv, "draft", null, sctx.user.name, at);
  S.invoices.unshift(inv);
  return inv;
}

function checksFor(sctx, inv) {
  const c = connOf(inv); const out = []; const bank = bankOf(c);
  if (!bank) out.push(["x", `${S.org.name} hasn't approved your bank details yet. Add them under Bank details; you can send once they approve.`]);
  else out.push(["ok", `Payment will go to ${bank.bank} account ending ${bank.last4}`]);
  if (new Date(inv.date) > new Date(NOW.getTime() + DAY)) out.push(["x", "The invoice date is in the future"]);
  if (invTotal(inv) <= 0) out.push(["x", "The total must be more than zero"]);
  if (inv.kind === "credit_note") {
    const orig = S.invoices.find((i) => i.id === inv.creditFor);
    if (orig && invTotal(inv) > invTotal(orig)) out.push(["x", `The credit is more than invoice ${orig.number} (${fmt(invTotal(orig))})`]);
    return out;
  }
  const dupe = S.invoices.find((i) => i.connId === c.id && i.id !== inv.id && i.kind === "invoice" && !["draft", "cancelled", "rejected"].includes(i.status) && invTotal(i) === invTotal(inv));
  if (dupe) out.push(["w", `You already sent invoice ${dupe.number} for the same amount. If this is a copy, don't send it; the buyer will hold it as a possible duplicate.`]);
  if (!inv.po) { out.push(["w", "There's no purchase order number. Invoices without one usually take longer to approve."]); return out; }
  const p = S.pos[inv.po];
  if (!p || p.vendorCode !== c.vendorCode) { out.push(["w", `${S.org.name} has no purchase order ${inv.po} for you. Check the number with your contact.`]); return out; }
  const open = openPOs(sctx, c.id).find((x) => x.n === inv.po);
  const mineBilled = ["needs_changes"].includes(inv.status) ? 0 : 0;
  if (!open) { out.push(["w", `${inv.po} has already been billed in full`]); return out; }
  out.push(invSubtotal(inv) > open.remaining + mineBilled ? ["w", `This is more than what's left on ${p.n} (${fmt(open.remaining)}). It will need extra approval.`] : ["ok", `Within what's left on ${p.n}`]);
  const qty = inv.lines.reduce((t, l) => t + l.q, 0); const ready = Math.max(0, open.received - open.qtyBilled);
  if (open.received === 0) out.push(["w", `${S.org.name} hasn't recorded a delivery for ${p.n} yet`]);
  else if (qty > ready) out.push(["w", `${S.org.name} has recorded ${ready} unbilled unit${ready === 1 ? "" : "s"} delivered on ${p.n}, and this invoice bills ${qty}`]);
  else out.push(["ok", "Matches what was delivered"]);
  return out;
}

function submitInvoice(sctx, invId, at = new Date()) {
  const inv = S.invoices.find((i) => i.id === invId && i.accountId === sctx.account.id);
  if (!inv) throw new Error("Invoice not found");
  if (!["draft", "needs_changes"].includes(inv.status)) throw new Error("This invoice has already been sent");
  const errs = checksFor(sctx, inv).filter((c) => c[0] === "x");
  if (errs.length) throw new Error(errs.map((e) => e[1]).join(" "));
  const c = connOf(inv); const v = vendorByCode(c.vendorCode);
  const resend = inv.revision > 0;
  inv.status = "submitted"; inv.revision += 1; inv.sentAt = new Date(at); inv.supplierNote = null; inv.bankFp = bankOf(c).fp;
  inv.grn = inv.po && S.grns[inv.po] !== undefined ? inv.po.replace("PO", "GRN") : null;
  event(inv, "submitted", resend ? "Corrected and sent again" : null, sctx.user.name, at);
  audit("invoice.submitted", "invoice", inv.id, { type: "supplier", id: sctx.user.id, name: sctx.user.name }, { invoice: inv.number, vendor: v.name, total: invTotal(inv), po: inv.po, revision: inv.revision, kind: inv.kind });
  const later = new Date(new Date(at).getTime() + 1000);
  if (inv.kind === "credit_note") { inv.status = "under_review"; event(inv, "under_review", `With ${S.org.name}'s accounts payable team for approval`, null, later); return inv; }
  const agent = agentById(S.workflow.primaryAgent);
  const subject = { id: inv.id, number: inv.number, vendorCode: v.code, vendorName: v.name, amount: invTotal(inv), po: inv.po, grn: inv.grn, date: inv.date, bankFp: inv.bankFp, source: "supplier portal" };
  const po = inv.po ? S.pos[inv.po] : null;
  const issue = !inv.po ? "no_po" : !po || Math.abs(subject.amount - po.amount) / po.amount > 0.05 ? "over_po" : S.grns[inv.po] === undefined || S.grns[inv.po] < po.qty ? "missing_grn" : null;
  const p = mockDecide(agent, { ...subject, id: inv.id + ":" + inv.revision }, issue);
  const a = evaluate(agent, { ...subject, truth: correctFor(issue) }, { decision: p.decision, confidence: p.confidence, reason: p.reason, gl: v.gl }, later);
  inv.actionId = a.id;
  syncInvoice(a.id, later);
  return inv;
}

function syncInvoice(actionId, at = new Date()) {
  const inv = S.invoices.find((i) => i.actionId === actionId);
  if (!inv || !["submitted", "under_review"].includes(inv.status)) return;
  const a = S.actions.find((x) => x.id === actionId);
  let next;
  if (a.status === "auto_approved" || a.status === "approved") next = "approved";
  else if (a.status === "rejected") next = "needs_changes";
  else if (a.status === "logged" && a.review) next = a.review.decision === "approve" ? "approved" : "needs_changes";
  else next = "under_review";
  if (next === inv.status) return;
  const notes = { under_review: `With ${S.org.name}'s accounts payable team for approval`, approved: "Approved for payment", needs_changes: "The buyer couldn't approve this invoice as sent. Check the messages, fix it and send it again." };
  inv.status = next; if (next !== "under_review") inv.supplierNote = notes[next];
  event(inv, next, notes[next], a.review ? a.review.byName : null, at);
}

function decideInvoice(user, invId, { decision, reason, message }, at = new Date()) {
  if (!can(user.role, "review")) throw new Error("Your role can't decide invoices");
  const inv = S.invoices.find((i) => i.id === invId);
  if (inv.status !== "under_review") throw new Error("This invoice isn't waiting for a decision");
  if (!reason || reason.trim().length < 10) throw new Error("Please give a reason of at least a few words");
  if (decision !== "approve" && (!message || message.trim().length < 5)) throw new Error("Tell the supplier what to fix or why");
  const a = inv.actionId ? S.actions.find((x) => x.id === inv.actionId) : null;
  if (a?.status === "blocked" && decision === "approve") throw new Error("A control blocked this invoice, so it can't be approved. Send it back or reject it.");
  if (a && !a.review && (a.status === "pending_review" || a.status === "logged")) reviewAction(user, a.id, { decision: decision === "approve" ? "approve" : "reject", reason }, at, { skipInvoiceSync: true });
  const next = { approve: "approved", send_back: "needs_changes", reject: "rejected" }[decision];
  const note = message || (next === "approved" ? "Approved for payment" : "The buyer rejected this invoice.");
  inv.status = next; inv.supplierNote = note;
  event(inv, next, note, user.name, at);
  if (message) inv.msgs.push({ from: "buyer", by: user.name, body: message, at: new Date(at) });
  audit("invoice.decided", "invoice", inv.id, { type: "user", id: user.id, name: user.name }, { invoice: inv.number, decision, reason, messageToSupplier: message ?? null }, at);
}

function schedulePayment(user, invId, { from, payOn }, at = new Date(), allowPast = false) {
  if (!can(user.role, "payments")) throw new Error("Your role can't schedule payments");
  const inv = S.invoices.find((i) => i.id === invId); const c = connOf(inv); const v = vendorByCode(c.vendorCode);
  if (inv.kind !== "invoice") throw new Error("Credit notes aren't paid; they reduce what you owe");
  if (!["approved", "scheduled"].includes(inv.status)) throw new Error("Only approved invoices can be scheduled");
  if (v.blocked) throw new Error(`${v.name} is blocked. Payments can't be scheduled.`);
  if (S.bankChanges.some((b) => b.connId === c.id && b.status === "pending")) throw new Error("This supplier has a bank detail change waiting for approval. Decide it first.");
  const bank = bankOf(c);
  if (!bank) throw new Error("The supplier has no approved bank account");
  if (inv.bankFp && bank.fp !== inv.bankFp) throw new Error("The supplier's bank details changed after this invoice was sent. Ask them to send it again.");
  const acct = S.bankAccounts.find((b) => b.id === from && b.state === "active");
  if (!acct) throw new Error("Choose one of your active bank accounts");
  if (!allowPast && new Date(payOn) < new Date(iso(NOW))) throw new Error("Choose today or a later date");
  inv.status = "scheduled"; inv.payOn = payOn; inv.payFrom = acct.id;
  event(inv, "scheduled", `Payment of ${fmt(invTotal(inv))} scheduled for ${dFmt(payOn + "T12:00")} to your account ending ${bank.last4}`, user.name, at);
  audit("invoice.payment_scheduled", "invoice", inv.id, { type: "user", id: user.id, name: user.name }, { invoice: inv.number, amount: invTotal(inv), payOn, payFrom: `${acct.nickname} ••${acct.last4}`, payTo: `${bank.bank} ••${bank.last4}` }, at);
}
function markPaid(user, invId, { paidOn, ref }, at = new Date()) {
  if (!can(user.role, "payments")) throw new Error("Your role can't record payments");
  const inv = S.invoices.find((i) => i.id === invId);
  if (inv.status !== "scheduled") throw new Error("Schedule the payment before recording it as paid");
  if (!ref || ref.trim().length < 3) throw new Error("Enter the payment reference from your bank");
  inv.status = "paid"; inv.paidOn = paidOn; inv.ref = ref.trim();
  event(inv, "paid", `Paid ${fmt(invTotal(inv))} on ${dFmt(paidOn + "T12:00")}. Payment reference ${inv.ref}`, user.name, at);
  audit("invoice.paid", "invoice", inv.id, { type: "user", id: user.id, name: user.name }, { invoice: inv.number, amount: invTotal(inv), paidOn, reference: inv.ref }, at);
}

function requestBankChange(sctx, d, at = new Date()) {
  if (d.password !== sctx.user.password) throw new Error("Your password is incorrect");
  if (!d.holder || d.holder.trim().length < 2 || !d.bank) throw new Error("Enter the account holder and bank name");
  if (!routingValid(d.routing)) throw new Error("Enter a valid 9-digit US routing number");
  const acct = String(d.account).replace(/\D/g, "");
  if (acct.length < 4 || acct.length > 17) throw new Error("Account numbers are 4 to 17 digits");
  if (acct !== String(d.confirm).replace(/\D/g, "")) throw new Error("The account numbers don't match");
  const fp = fingerprint(String(d.routing).replace(/\D/g, "") + ":" + acct);
  let b = S.supplierBanks.find((x) => x.accountId === sctx.account.id && x.fp === fp);
  if (!b) { b = { id: uid("sb_"), accountId: sctx.account.id, holder: d.holder, bank: d.bank, routing: String(d.routing).replace(/\D/g, ""), last4: acct.slice(-4), fp, at: new Date(at) }; S.supplierBanks.push(b); }
  const requested = [];
  for (const c of connsFor(sctx).filter((c) => c.status === "active")) {
    if (c.bankId === b.id) continue;
    S.bankChanges.filter((x) => x.connId === c.id && x.status === "pending").forEach((x) => (x.status = "withdrawn"));
    S.bankChanges.unshift({ id: uid("bc_"), connId: c.id, newBankId: b.id, prevBankId: c.bankId, status: "pending", requestedBy: sctx.user.name, at: new Date(at), decidedBy: null, verification: null, note: null });
    audit("supplier.bank_change_requested", "vendor", c.vendorCode, { type: "supplier", id: sctx.user.id, name: sctx.user.name }, { vendor: vendorByCode(c.vendorCode).name, newAccount: `${b.bank} ••${b.last4}`, routing: b.routing }, at);
    requested.push(c);
  }
  return requested;
}
function decideBankChange(user, id, { decision, verification, note }, at = new Date()) {
  if (!can(user.role, "suppliers:manage")) throw new Error("Your role can't decide bank changes");
  const ch = S.bankChanges.find((x) => x.id === id);
  if (ch.status !== "pending") throw new Error("This request has already been decided");
  if (decision === "approve" && (!verification || verification.trim().length < 10)) throw new Error("Say how you confirmed the change with the supplier");
  if (decision === "reject" && (!note || note.trim().length < 5)) throw new Error("Give a reason the supplier will see");
  const c = S.connections.find((x) => x.id === ch.connId); const v = vendorByCode(c.vendorCode); const b = S.supplierBanks.find((x) => x.id === ch.newBankId);
  ch.status = decision === "approve" ? "approved" : "rejected"; ch.decidedBy = user.name; ch.decidedAt = new Date(at); ch.verification = verification || null; ch.note = note || null;
  if (decision === "approve") { c.bankId = b.id; v.bankFp = b.fp; v.bankChangedAt = new Date(at); }
  audit("supplier.bank_change_decided", "vendor", v.code, { type: "user", id: user.id, name: user.name }, { vendor: v.name, decision, verification: verification ?? null, note: note ?? null, newAccount: `${b.bank} ••${b.last4}` }, at);
}
