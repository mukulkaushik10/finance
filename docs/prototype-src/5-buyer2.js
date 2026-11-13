/* ============================================================ replay testing */
function runReplay(ds, agentIds) {
  const reports = agentIds.map((id) => {
    const agent = agentById(id);
    let right = 0, misApproved = 0, misApprovedN = 0, wrongBlocked = 0, wrongBlockedN = 0, caught = 0, escalated = 0;
    const errors = [];
    const seen = new Map();
    ds.cases.forEach((c) => {
      const p = mockDecide(agent, c, c.issue);
      const prior = seen.get(c.vendorCode) ?? [];
      const ctx = { subject: { ...c, at: c.at }, vendor: vendorByCode(c.vendorCode), po: c.po ? S.pos[c.po] ?? null : null, grnQty: c.po && S.grns[c.po] !== undefined ? S.grns[c.po] : null, prior, confidence: p.confidence };
      const results = activeRules().map((r) => evalRule(r, ctx));
      prior.push({ number: c.number, amount: c.amount, date: c.date }); seen.set(c.vendorCode, prior);
      if (p.decision === "escalate") escalated++;
      if (p.decision === c.correct) { right++; return; }
      const ruleCatch = results.some(isControlFailure);
      if (p.decision === "approve") { misApproved += c.amount; misApprovedN++; if (ruleCatch) caught += c.amount; }
      if (c.correct === "approve" && p.decision !== "approve") { wrongBlocked += c.amount; wrongBlockedN++; }
      errors.push({ c, said: p.decision, conf: p.confidence, ruleCatch, rules: results.filter((r) => r.result === "fail").map((r) => r.name) });
    });
    errors.sort((a, b) => b.c.amount - a.c.amount);
    return { agentId: id, name: agent.name, n: ds.cases.length, accuracy: right / ds.cases.length, misApproved, misApprovedN, wrongBlocked, wrongBlockedN, caught, escalation: escalated / ds.cases.length, cost: agent.cost * ds.cases.length, worst: errors.slice(0, 20) };
  });
  return reports;
}
function vReplay() {
  const u = me(); const run = can(u.role, "replay:run");
  return ph("Replay testing", "Run past invoices with known outcomes through one or more agents before they touch real money. Compare accuracy, money mis-approved and good invoices wrongly blocked.") + `
  ${U.running ? `<div class="card"><div class="cb"><b>Replaying ${U.running.n.toLocaleString()} invoices through ${U.running.agents} agent${U.running.agents > 1 ? "s" : ""}…</b><div class="prog"><div style="width:${U.running.pct}%"></div></div><div class="small muted">${U.running.pct}% · runs in the background; you can leave this page</div></div></div>` : ""}
  <div class="card"><div class="ch"><div><h3>Replay sets</h3><p>CSV columns: invoice_id, vendor, amount, currency, po_number, grn_number, invoice_date, correct_decision</p></div>${run ? `<label class="btn sec sm" style="cursor:pointer">Upload CSV<input type="file" accept=".csv,text/csv" id="csv-file" hidden></label>` : ""}</div>
  <div class="tw"><table><thead><tr><th>Set</th><th class="r">Invoices</th><th>Mix</th><th>Uploaded</th><th>Compare agents</th></tr></thead><tbody>
  ${S.datasets.map((ds) => { const mix = { approve: 0, reject: 0, escalate: 0 }; ds.cases.forEach((c) => mix[c.correct]++);
    return `<tr><td><b>${esc(ds.name)}</b></td><td class="r tab">${ds.cases.length.toLocaleString()}</td><td class="small">${mix.approve} approve · ${mix.reject} reject · ${mix.escalate} send to a person</td><td class="small muted">${esc(ds.uploadedBy)} · ${dFmt(ds.at)}</td>
    <td>${run ? `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">${S.agents.filter((a) => a.active).map((a) => `<label class="chk-l"><input type="checkbox" class="rp-agent" data-ds="${ds.id}" value="${a.id}" checked> ${esc(a.name)}</label>`).join("")}<button class="btn p sm" data-a="replay" data-ds="${ds.id}" ${U.running ? "disabled" : ""}>Run</button></div>` : `<span class="muted small">Controllers run replays</span>`}</td></tr>`; }).join("")}
  </tbody></table></div></div>
  <div class="card"><div class="ch"><h3>Comparisons</h3></div>${S.comparisons.length ? `<div class="tw"><table><thead><tr><th>Run</th><th>Set</th><th>Agents</th><th>Best accuracy</th><th></th></tr></thead><tbody>${S.comparisons.map((c) => `<tr><td class="small muted">${tFmt(c.at)} · ${esc(c.by)}</td><td>${esc(c.dsName)}</td><td>${c.reports.map((r) => esc(r.name)).join(" vs ")}</td><td class="tab">${pct(Math.max(...c.reports.map((r) => r.accuracy)))}</td><td class="r"><button class="lnk" data-a="comparison" data-id="${c.id}">Open report →</button></td></tr>`).join("")}</tbody></table></div>` : empty("No comparisons yet", "Pick agents above and click Run. 1,000 invoices take a few seconds.")}</div>`;
}
function vComparison() {
  const c = S.comparisons.find((x) => x.id === U.p.id); if (!c) return empty("Report not found");
  const best = Math.max(...c.reports.map((r) => r.accuracy));
  return `<button class="back" data-a="go" data-page="replay">← Replay testing</button>` + ph("Replay comparison", `${esc(c.dsName)} · ${c.reports[0].n.toLocaleString()} invoices · run by ${esc(c.by)} ${tFmt(c.at)}`) + `
  <div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">${c.reports.map((r) => `<div class="card"><div class="ch"><h3>${esc(r.name)}</h3>${r.accuracy === best ? badge(["Most accurate", "good"]) : ""}</div><div class="cb">
    <dl class="meta"><div><dt>Accuracy</dt><dd style="font-size:22px" class="tab">${pct(r.accuracy)}</dd></div><div><dt>Sent to a person</dt><dd class="tab">${pct(r.escalation)}</dd></div>
    <div><dt>Money mis-approved</dt><dd class="tab bad">${fmt(r.misApproved)}</dd><dd class="small muted">${r.misApprovedN} invoices</dd></div><div><dt>Good invoices wrongly stopped</dt><dd class="tab warn">${fmt(r.wrongBlocked)}</dd><dd class="small muted">${r.wrongBlockedN} invoices</dd></div>
    <div><dt>Mis-approvals your rules would catch</dt><dd class="tab good">${fmt(r.caught)}</dd><dd class="small muted">${r.misApproved ? pct(r.caught / r.misApproved, 0) : "-"} of the money</dd></div><div><dt>Agent cost</dt><dd class="tab">${fmt(r.cost)}</dd></div></dl></div></div>`).join("")}</div>
  ${c.reports.map((r) => `<div class="card"><div class="ch"><div><h3>${esc(r.name)}: 20 most expensive errors</h3><p>Largest amounts where the agent disagreed with the known right answer</p></div></div><div class="tw"><table><thead><tr><th>Invoice</th><th>Vendor</th><th class="r">Amount</th><th>Right answer</th><th>Agent said</th><th>Your rules</th></tr></thead><tbody>
  ${r.worst.map((e) => `<tr><td class="mono">${esc(e.c.number)}</td><td>${esc(e.c.vendorName)}</td><td class="r tab">${fmt(e.c.amount)}</td><td>${DECISION[e.c.correct]}</td><td>${DECISION[e.said]} <span class="small muted">${pct(e.conf, 0)}</span></td><td class="small">${e.said === "approve" ? (e.ruleCatch ? `<span class="good">Would stop it: ${esc(e.rules.filter((x) => x !== "Approval limits").join(", "))}</span>` : `<span class="bad">Would not catch it</span>`) : `<span class="muted">n/a (agent didn't approve)</span>`}</td></tr>`).join("")}
  </tbody></table></div></div>`).join("")}`;
}

/* ============================================================ rules */
function vRules() {
  const u = me(); const edit = can(u.role, "rules:edit");
  const editing = U.p.edit ? S.rules.find((r) => r.id === U.p.edit) : null;
  return ph("Rules", "Your organisation's controls, written as plain sentences. Every change is a new version; each invoice records the exact versions it was judged by.", edit ? `<button class="btn p" data-a="toggle" data-k="newrule">Add a custom rule</button>` : "") + `
  ${U.p.newrule ? `<div class="card" style="border-color:var(--brand)"><div class="ch"><h3>New custom rule</h3></div><div class="cb">
    <div class="form"><label class="f">Name<input class="i" id="nr-name" value="Large invoices from new categories"></label>
    <label class="f">When<select class="i" id="nr-field">${Object.entries(CUSTOM_FIELDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="f">Condition<select class="i" id="nr-op">${Object.entries(CUSTOM_OPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <label class="f">Value <span class="h">Dollars for amounts</span><input class="i" id="nr-value" value="20000"></label>
    <label class="f">Then<select class="i" id="nr-sev"><option value="review">Send to a person</option><option value="block">Block it</option></select></label></div>
    <label class="f">Why are you adding this rule?<input class="i" id="nr-reason" placeholder="e.g. Audit committee asked for a second look over $20k"></label>
    <div class="btns"><button class="btn p" data-a="addrule">Add rule</button><button class="btn ghost" data-a="toggle" data-k="newrule">Cancel</button></div></div></div>` : ""}
  ${S.rules.map((r) => `<div class="card"><div class="ch"><div><h3>${esc(r.name)} <span class="small muted" style="font-weight:400">v${r.version}</span></h3><p>${RULE_TYPES[r.type].desc}</p></div>
    <div class="btns">${badge(r.enabled ? (r.severity === "block" ? ["Blocks payment", "bad"] : r.type === "approval_limits" ? ["Routes approval", "info"] : ["Sends to a person", "warn"]) : ["Off", "neutral"])}${edit ? `<button class="btn sec sm" data-a="editrule" data-id="${r.id}">Edit</button>` : ""}<button class="btn ghost sm" data-a="toggle" data-k="hist_${r.id}">History (${r.versions.length})</button></div></div>
    <div class="cb"><div class="sentence">${ruleSentence(r)}</div>
    ${editing === r ? ruleEditor(r) : ""}
    ${U.p["hist_" + r.id] ? `<div class="tw"><table><thead><tr><th>Version</th><th>Rule</th><th>Why</th><th>By</th><th>When</th></tr></thead><tbody>${r.versions.map((v) => `<tr><td class="tab">v${v.v}${v.enabled === false ? " (off)" : ""}</td><td class="small">${ruleSentence({ ...r, params: v.params, severity: v.severity })}</td><td class="small">${esc(v.reason)}</td><td class="small">${esc(v.by)}</td><td class="small muted">${tFmt(v.at)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    </div></div>`).join("")}
  <div class="card"><div class="ch"><div><h3>Try an invoice</h3><p>See what the current rules and autonomy level would do. Nothing is saved.</p></div></div><div class="cb">
    <div class="form"><label class="f">Vendor<select class="i" id="try-vendor">${S.vendors.map((v) => `<option value="${v.code}">${esc(v.name)}${v.blocked ? " (blocked)" : ""}</option>`).join("")}</select></label>
    <label class="f">Amount ($)<input class="i" id="try-amount" value="7,500.00"></label>
    <label class="f">Agent proposes<select class="i" id="try-dec"><option value="approve">Approve</option><option value="escalate">Send to a person</option><option value="reject">Reject</option></select></label>
    <label class="f">Agent confidence (%)<input class="i" id="try-conf" value="95"></label></div>
    <div class="btns"><button class="btn sec" data-a="tryrule">Check it</button></div>${U.p.tryResult ?? ""}</div></div>`;
}
function ruleEditor(r) {
  const p = r.params; let fields = "";
  if (r.type === "three_way_match") fields = `<label class="f">Tolerance (%)<input class="i" id="re-tol" value="${p.tolPct}"></label>`;
  if (r.type === "approval_limits") fields = p.bands.map((b, i) => `<label class="f">Band ${i + 1} up to ($) <span class="h">${i === p.bands.length - 1 ? "Top band has no upper limit" : ""}</span><input class="i" id="re-up-${i}" value="${b[0] === null ? "" : (b[0] / 100).toFixed(0)}" ${b[0] === null ? "disabled" : ""}></label><label class="f">Who approves<select class="i" id="re-role-${i}"><option value="">No approval needed</option>${["reviewer", "controller", "admin"].map((x) => `<option value="${x}" ${b[1] === x ? "selected" : ""}>${APPROVER[x]}</option>`).join("")}</select></label>`).join("");
  if (r.type === "duplicate_invoice") fields = `<label class="f">Window (days)<input class="i" id="re-win" value="${p.windowDays}"></label>`;
  if (r.type === "bank_details_change") fields = `<label class="f">Look-back (days)<input class="i" id="re-look" value="${p.lookbackDays}"></label>`;
  if (r.type === "blocked_vendor") fields = `<div class="small muted">Which vendors are blocked is managed in Settings → Vendors.</div>`;
  if (r.type === "custom") fields = `<label class="f">Value<input class="i" id="re-val" value="${p.field === "amount" ? (p.value / 100).toFixed(0) : esc(p.value)}"></label>`;
  return `<div style="border:1px solid var(--brand);border-radius:10px;padding:12px;display:grid;gap:10px"><div class="form">${fields}<label class="f">Rule is<select class="i" id="re-enabled"><option value="1" ${r.enabled ? "selected" : ""}>On</option><option value="0" ${!r.enabled ? "selected" : ""}>Off</option></select></label></div>
  <label class="f">Why are you changing it? <span class="h">Required; recorded in the version history and audit trail</span><input class="i" id="re-reason"></label>
  <div class="btns"><button class="btn p" data-a="saverule" data-id="${r.id}">Save new version</button><button class="btn ghost" data-a="editrule" data-id="">Cancel</button></div>
  <div class="small muted">Takes effect on the next invoice. No deploy.</div></div>`;
}

/* ============================================================ autonomy */
const LEVELS = [
  ["Shadow", "The agent's decisions are recorded but not enforced. People do the work; their answers build the track record."],
  ["Humans approve all", "Every invoice the agent proposes goes to a person."],
  ["Auto under a limit", "Clean invoices under the auto-approve limit go through. Everything else goes to a person."],
  ["Auto when every rule passes", "Any invoice that passes every rule goes through. Rules still block and route."],
];
function vAutonomy() {
  const u = me(); const wf = S.workflow; const r = rollingAccuracy(); const change = can(u.role, "autonomy:change");
  const ready = r.n >= wf.window && r.acc >= wf.target;
  return ph("Autonomy", "How much the agent may do on its own. Promotion is only offered when its track record supports it, and a person always confirms.") + `
  <div class="lvl">${LEVELS.map(([t, d], i) => `<div class="${wf.level === i ? "on" : ""}"><div class="k">LEVEL ${i}</div><div style="font-weight:600">${t}</div><div class="small muted">${d}</div></div>`).join("")}</div>
  <div class="two"><div class="stack">
    <div class="card"><div class="ch"><h3>Track record</h3></div><div class="cb">
      <div class="stats"><div class="stat"><div class="l">Rolling accuracy</div><div class="v ${r.acc >= wf.target ? "good" : ""}">${pct(r.acc)}</div><div class="s">Last ${r.n} reviewed invoices</div></div><div class="stat"><div class="l">Promotion target</div><div class="v">${pct(wf.target)}</div><div class="s">Over ${wf.window} reviewed invoices</div></div></div>
      ${wf.level < 3 ? (ready ? `<div class="alert t-good"><b>Ready for Level ${wf.level + 1}</b>The agent met the target. A controller can confirm the promotion.</div>` : `<div class="alert t-info">Not ready for Level ${wf.level + 1} yet: needs ${pct(wf.target)} over ${wf.window} reviewed invoices.</div>`) : ""}
    </div></div>
    <div class="card"><div class="ch"><h3>History</h3></div><div class="tw"><table><thead><tr><th>Change</th><th>Why</th><th>By</th><th>Accuracy then</th><th>When</th></tr></thead><tbody>${S.autonomyHistory.map((h) => `<tr><td>Level ${h.from} → ${h.to}</td><td class="small">${esc(h.reason)}</td><td>${esc(h.by)}</td><td class="tab">${pct(h.accuracy)}</td><td class="small muted">${tFmt(h.at)}</td></tr>`).join("")}</tbody></table></div></div>
  </div><div class="stack">
    ${change ? `<div class="card" style="border-color:var(--brand)"><div class="ch"><h3>Change level</h3></div><div class="cb">
      <label class="f">New level<select class="i" id="lv-to">${LEVELS.map((l, i) => `<option value="${i}" ${i === Math.min(3, wf.level + (ready ? 1 : 0)) ? "selected" : ""}>Level ${i}: ${l[0]}</option>`).join("")}</select></label>
      <label class="f">Reason<textarea class="i" id="lv-reason" rows="2" placeholder="e.g. Met 95% over 50 invoices; audit committee agreed"></textarea></label>
      <button class="btn p full" data-a="level">Confirm change</button><div class="small muted">Moving down is always allowed. Moving up needs the target met.</div></div></div>` : ""}
    <div class="card"><div class="ch"><h3>Settings</h3></div><div class="cb">
      <div class="form"><label class="f">Auto-approve limit ($)<input class="i" id="wf-limit" value="${(wf.limit / 100).toFixed(0)}" ${change ? "" : "disabled"}></label>
      <label class="f">Confidence threshold (%)<input class="i" id="wf-thr" value="${Math.round(wf.threshold * 100)}" ${change ? "" : "disabled"}></label>
      <label class="f">Promotion window<input class="i" id="wf-win" value="${wf.window}" ${change ? "" : "disabled"}></label>
      <label class="f">Promotion target (%)<input class="i" id="wf-tgt" value="${Math.round(wf.target * 100)}" ${change ? "" : "disabled"}></label></div>
      ${change ? `<button class="btn sec" data-a="wfsave">Save settings</button>` : ""}</div></div>
  </div></div>`;
}

/* ============================================================ audit */
const EVENT_LABEL = (t) => t.replace(/[._]/g, " ");
function vAudit() {
  const u = me(); const v = U.verify; const types = [...new Set(S.audit.map((r) => r.type))].sort();
  const rows = S.audit.filter((r) => !U.p.type || r.type === U.p.type).slice().reverse();
  const page = U.p.pageNo ?? 0; const shown = rows.slice(page * 40, page * 40 + 40);
  return ph("Audit trail", "Append-only and hash-chained: each record's fingerprint covers its contents and the record before it, so any edit, re-hash or deletion is detectable.",
    `<button class="btn p" data-a="verify">Verify chain</button>${can(u.role, "audit:export") ? `<button class="btn sec" data-a="evidence" data-scope="month">Evidence pack</button>` : ""}`) + `
  ${v ? (v.ok ? `<div class="alert t-good"><b>Chain verified</b>${v.checked.toLocaleString()} records checked ${tFmt(v.at)}. Head fingerprint <span class="mono">${v.head.slice(0, 16)}…</span></div>` : `<div class="alert t-bad"><b>Chain broken</b>${v.problems.map((p) => esc(p[1])).join("<br>")}</div>`) : ""}
  <div class="card"><div class="ch"><div><h3>Tamper test</h3><p>Pretend someone edits a record directly in the database, then verify again.</p></div><div class="btns">${U.tamper ? `<button class="btn sec sm" data-a="untamper">Undo the edit</button>` : `<button class="btn sec sm" data-a="tamper">Edit a record in the database</button>`}</div></div>${U.tamper ? `<div class="cb small">Record #${U.tamper.seq}'s amount was changed from ${fmt(U.tamper.from)} to ${fmt(U.tamper.to)} without updating its fingerprint. Click Verify chain.</div>` : ""}</div>
  <div class="filters"><label class="f">Event<select class="i" id="au-type" style="width:260px"><option value="">All events</option>${types.map((t) => `<option value="${t}" ${U.p.type === t ? "selected" : ""}>${EVENT_LABEL(t)}</option>`).join("")}</select></label><button class="btn sec" data-a="aufilter">Filter</button><span class="small muted" style="align-self:center">${rows.length.toLocaleString()} records</span></div>
  <div class="card tw"><table><thead><tr><th>#</th><th>When</th><th>Event</th><th>About</th><th>By</th><th>Fingerprint</th></tr></thead><tbody>
  ${shown.map((r) => `<tr class="hov"><td class="tab">${r.seq}</td><td class="small muted">${tFmt(r.at)}</td><td>${esc(EVENT_LABEL(r.type))}</td><td class="small">${r.entity === "action" ? `<button class="lnk" data-a="action" data-id="${r.entityId}">${esc(r.payload.invoice ?? r.entityId)}</button>` : esc(r.payload.invoice ?? r.payload.rule ?? r.payload.vendor ?? r.payload.agent ?? r.payload.nickname ?? r.entityId)}</td><td class="small">${esc(r.actor.name)} <span class="muted">(${r.actor.type})</span></td><td><button class="lnk mono" data-a="toggle" data-k="rec_${r.seq}">${r.hash.slice(0, 10)}…</button></td></tr>
  ${U.p["rec_" + r.seq] ? `<tr><td colspan="6"><div class="secret">prev ${r.prevHash}<br>hash ${r.hash}<br><br>${esc(JSON.stringify(r.payload, null, 1))}</div></td></tr>` : ""}`).join("")}
  </tbody></table></div>
  <div class="btns"><button class="btn sec sm" data-a="page" data-n="${page - 1}" ${page === 0 ? "disabled" : ""}>Newer</button><span class="small muted" style="align-self:center">Page ${page + 1} of ${Math.max(1, Math.ceil(rows.length / 40))}</span><button class="btn sec sm" data-a="page" data-n="${page + 1}" ${(page + 1) * 40 >= rows.length ? "disabled" : ""}>Older</button></div>`;
}
function evidenceModal(scope, id) {
  let list, title;
  if (scope === "action") { list = S.actions.filter((a) => a.id === id); title = `Evidence pack: invoice ${list[0].number}`; }
  else if (scope === "filter") { list = filterActions(U.p); title = "Evidence pack: current filter"; }
  else { const s = new Date(NOW.getTime() - 30 * DAY); list = S.actions.filter((a) => a.createdAt >= s); title = "Evidence pack: last 30 days"; }
  const ids = new Set(list.map((a) => a.id)); const recs = S.audit.filter((r) => ids.has(r.entityId)); const v = verifyChain();
  const files = [["summary.pdf", "Plain-language summary: totals, outcomes, overrides, reviewers"], ["actions.csv", `${list.length} invoices`], ["rule_results.csv", `${list.reduce((t, a) => t + a.results.length, 0)} rule results`], ["reviews.csv", `${list.filter((a) => a.review).length} decisions by people`], ["audit_records.csv", `${recs.length} records with fingerprints`], ["chain_verification.json", v.ok ? "Chain verified" : "Chain broken"], ["manifest.json", "SHA-256 of every file in the pack"]];
  return `<div class="ch"><h3>${esc(title)}</h3><button class="btn ghost sm" data-a="closemodal">Close</button></div><div class="cb">
  <div class="small muted">In the app this downloads as a ZIP. This shared preview can't download files, so here is what's in it.</div>
  <div class="tw"><table><tbody>${files.map(([f, d]) => `<tr><td class="mono">${f}</td><td class="small">${d}</td></tr>`).join("")}</tbody></table></div>
  <div class="small">Total ${fmt(list.reduce((t, a) => t + a.amount, 0))} · ${list.filter(moneyAtRisk).length} approved despite a failed check</div></div>`;
}

/* ============================================================ settings */
function vSettings() {
  const u = me(); const edit = can(u.role, "*"); const tab = U.p.tab ?? "agents";
  const tabs = [["agents", "Agents"], ["erp", "System of record"], ["vendors", "Vendors"], ["bank", "Bank accounts"], ["users", "Users & roles"]];
  let body = "";
  if (tab === "agents") body = `<div class="card"><div class="ch"><div><h3>Agents</h3><p>AI agents that call Control Room before acting. The primary agent checks supplier-portal invoices.</p></div>${edit ? `<button class="btn p sm" data-a="toggle" data-k="newagent">Connect an agent</button>` : ""}</div>
    ${U.issued?.key ? `<div class="cb"><div class="alert t-good"><b>Copy these now; they won't be shown again</b>API key for ${esc(U.issued.key.name)}<div class="secret">${esc(U.issued.key.key)}</div>${U.issued.key.secret ? `Signing secret<div class="secret">${esc(U.issued.key.secret)}</div>` : ""}</div></div>` : ""}
    ${U.p.newagent ? `<div class="cb" style="border-bottom:1px solid var(--border)"><div class="form"><label class="f">Name<input class="i" id="ag-name" value="Acme AP Copilot"></label><label class="f">Built by<input class="i" id="ag-builder" value="Acme AI"></label><label class="f">Type<select class="i" id="ag-kind"><option value="webhook">Webhook (your agent)</option><option value="mock">Demo agent</option></select></label><label class="f">Endpoint URL<input class="i" id="ag-url" value="https://agent.acme.example/decide"></label></div><div class="btns"><button class="btn p" data-a="addagent">Connect</button><button class="btn ghost" data-a="toggle" data-k="newagent">Cancel</button></div></div>` : ""}
    <div class="tw"><table><thead><tr><th>Agent</th><th>Type</th><th>Version</th><th>API key</th><th class="r">Cost / invoice</th><th></th></tr></thead><tbody>${S.agents.map((a) => `<tr><td><b>${esc(a.name)}</b> ${S.workflow.primaryAgent === a.id ? badge(["Primary", "brand"]) : ""}<div class="small muted">${esc(a.builder)}</div></td><td>${a.kind === "mock" ? `Demo (${PROFILES[a.profile]?.label ?? "custom"}, ${pct(a.errorRate, 0)} errors)` : `Webhook<div class="small muted">${esc(a.url)}</div>`}</td><td>${esc(a.version)}</td><td class="mono">${esc(a.keyPrefix)}…</td><td class="r tab">${fmt(a.cost)}</td><td class="r">${edit ? `<button class="btn ghost sm" data-a="rotate" data-id="${a.id}">New key</button>${S.workflow.primaryAgent !== a.id ? `<button class="btn ghost sm" data-a="primary" data-id="${a.id}">Make primary</button>` : ""}` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  if (tab === "erp") body = `<div class="card"><div class="ch"><div><h3>System of record</h3><p>Where vendors, purchase orders and goods receipts come from, and where approved invoices are posted.</p></div></div><div class="cb">${["QuickBooks Online (demo)", "Xero (demo)", "NetSuite (demo)"].map((n) => `<label class="chk-l"><input type="radio" name="erp" value="${n}" ${S.workflow.connector === n ? "checked" : ""} ${edit ? "" : "disabled"} data-a="erp"> ${n}</label>`).join("")}<div class="small muted">Demo connectors read the sample vendor master and POs. Real connectors plug in behind the same interface.</div></div></div>`;
  if (tab === "vendors") { const q = (U.p.vq ?? "").toLowerCase(); body = `<div class="card"><div class="ch"><div><h3>Vendors</h3><p>Block a vendor or record that its bank details changed. Both feed the rules immediately.</p></div><div style="display:flex;gap:6px"><input class="i" id="vq" placeholder="Search" value="${esc(U.p.vq ?? "")}" style="width:180px"><button class="btn sec sm" data-a="vsearch">Search</button></div></div>
    <div class="tw"><table><thead><tr><th>Vendor</th><th>Category</th><th>Status</th><th>Bank details</th><th></th></tr></thead><tbody>${S.vendors.filter((v) => !q || `${v.name} ${v.code}`.toLowerCase().includes(q)).sort((a, b) => b.blocked - a.blocked).map((v) => `<tr><td><b>${esc(v.name)}</b><div class="small muted">${v.code}</div></td><td class="small">${esc(v.category)} · GL ${v.gl}</td><td>${v.blocked ? badge(["Blocked", "bad"]) + `<div class="small muted">${esc(v.blockedReason)}</div>` : badge(["Active", "good"])}</td><td class="small">${v.bankChangedAt ? `<span class="warn">Changed ${dFmt(v.bankChangedAt)}</span>` : "Unchanged"}</td><td class="r">${edit ? `<button class="btn ghost sm" data-a="vblock" data-code="${v.code}">${v.blocked ? "Unblock" : "Block"}</button><button class="btn ghost sm" data-a="vbank" data-code="${v.code}">Bank changed</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`; }
  if (tab === "bank") body = `<div class="card"><div class="ch"><div><h3>Bank accounts</h3><p>The accounts you pay supplier invoices from. Account numbers are stored encrypted and only the last four digits are ever shown. Control Room records payments; it doesn't move money.</p></div>${edit ? `<button class="btn p sm" data-a="toggle" data-k="newbank">Add account</button>` : ""}</div>
    ${U.p.newbank ? `<div class="cb" style="border-bottom:1px solid var(--border)"><div class="form"><label class="f">Name for this account<input class="i" id="bk-nick" placeholder="Payroll reserve"></label><label class="f">Account holder<input class="i" id="bk-holder" value="Harbor & Pine Manufacturing Inc."></label><label class="f">Bank<input class="i" id="bk-bank" placeholder="Pacific Commerce Bank"></label><label class="f">Routing number <span class="h">9 digits, e.g. 021000021</span><input class="i" id="bk-routing" inputmode="numeric"></label><label class="f">Account number<input class="i" id="bk-acct" inputmode="numeric"></label></div><label class="chk-l"><input type="checkbox" id="bk-def"> Use as the default for payments</label><div class="btns"><button class="btn p" data-a="addbank">Save account</button><button class="btn ghost" data-a="toggle" data-k="newbank">Cancel</button></div></div>` : ""}
    <div class="tw"><table><thead><tr><th>Account</th><th>Bank</th><th>Routing</th><th>Number</th><th>Added</th><th></th></tr></thead><tbody>${S.bankAccounts.map((b) => `<tr style="${b.state === "archived" ? "opacity:.55" : ""}"><td><b>${esc(b.nickname)}</b> ${b.isDefault ? badge(["Default", "brand"]) : ""} ${b.state === "archived" ? badge(["Archived", "neutral"]) : ""}<div class="small muted">${esc(b.holder)}</div></td><td>${esc(b.bank)}</td><td class="tab">${b.routing}</td><td class="tab">••••${b.last4}</td><td class="small muted">${dFmt(b.at)}</td><td class="r">${edit && b.state === "active" && !b.isDefault ? `<button class="btn ghost sm" data-a="bkdefault" data-id="${b.id}">Make default</button>` : ""}${edit && !b.isDefault ? `<button class="btn ghost sm" data-a="bkarchive" data-id="${b.id}">${b.state === "active" ? "Archive" : "Restore"}</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  if (tab === "users") body = `<div class="card"><div class="ch"><div><h3>Users & roles</h3><p>Admin: everything. Controller: rules, autonomy, replays, decisions at any amount, payments. Reviewer: decisions within limits. Auditor: sees and exports everything, changes nothing.</p></div>${edit ? `<button class="btn p sm" data-a="toggle" data-k="newuser">Add user</button>` : ""}</div>
    ${U.p.newuser ? `<div class="cb" style="border-bottom:1px solid var(--border)"><div class="form"><label class="f">Name<input class="i" id="us-name" placeholder="Jordan Lee"></label><label class="f">Email<input class="i" id="us-email" placeholder="jordan@harborpine.example"></label><label class="f">Role<select class="i" id="us-role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === "reviewer" ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><div class="btns"><button class="btn p" data-a="adduser">Add user</button><button class="btn ghost" data-a="toggle" data-k="newuser">Cancel</button></div></div>` : ""}
    <div class="tw"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead><tbody>${S.users.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.id === u.id ? ` <span class="small muted">(you)</span>` : ""}</td><td class="small">${esc(x.email)}</td><td>${edit && x.id !== u.id ? `<select class="i" style="width:190px" data-a="setrole" data-id="${x.id}">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${x.role === k ? "selected" : ""}>${v}</option>`).join("")}</select>` : ROLE_LABEL[x.role]}</td><td>${x.active ? badge(["Active", "good"]) : badge(["Disabled", "neutral"])} ${edit && x.id !== u.id ? `<button class="btn ghost sm" data-a="useractive" data-id="${x.id}">${x.active ? "Disable" : "Enable"}</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div>`;
  return ph("Settings", "Connect agents and your system of record, manage vendors flagged for control, set up the bank accounts you pay suppliers from, and decide who can do what.") + `
  ${!edit ? `<div class="alert t-info">Only admins can change settings.</div>` : ""}
  <div class="utabs">${tabs.map(([k, l]) => `<button aria-selected="${tab === k}" data-a="settab" data-tab="${k}">${l}</button>`).join("")}</div>${body}`;
}

function vApi() {
  const eps = [["POST", "/v1/actions/evaluate", "Ask permission before acting. Returns auto_approve, needs_human or block."], ["GET", "/v1/actions/{id}", "Poll for a person's decision."], ["GET", "/api/actions", "List actions with the scorecard's filters."], ["POST", "/api/actions/{id}/review", "Approve or reject a queued action (reason required)."], ["PUT", "/api/rules/{id}", "Edit a rule; writes a new version."], ["POST", "/api/workflows/{id}/autonomy", "Change level (promotion needs the target met)."], ["POST", "/api/replay/comparisons", "Replay a set against 1–3 agents."], ["GET", "/api/audit/verify", "Verify the hash chain."], ["GET", "/api/audit/export", "Download an evidence pack (ZIP)."], ["POST", "/api/portal/invoices", "Supplier: save a draft invoice or credit note."], ["POST", "/api/portal/invoices/{id}/submit", "Supplier: send the invoice to the buyer."], ["POST", "/api/supplier-invoices/{id}/decision", "Buyer: approve, send back or reject."], ["POST", "/api/supplier-invoices/{id}/schedule", "Buyer: schedule payment from your bank account."], ["POST", "/api/bank-changes/{id}/decision", "Buyer: approve a supplier's bank detail change."]];
  return ph("Agent API", "Agents call Control Room before acting on money. Full OpenAPI document and Swagger UI ship with the app at /api-docs.") + `
  <div class="card"><div class="ch"><h3>Ask permission before acting</h3></div><div class="cb"><div class="secret">curl https://controlroom.app/v1/actions/evaluate \\<br>&nbsp; -H 'Authorization: Bearer cr_live_…' -H 'Idempotency-Key: inv-1042' \\<br>&nbsp; -d '{"workflow_id":"wf_ap_main","proposed":{"decision":"approve","confidence":0.95,"gl_code":"6100"},<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; "subject":{"type":"invoice","invoice_id":"INV-1042","vendor_name":"Northwind Office Supply",<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; "amount":{"minor":750000,"currency":"USD"},"po_number":"PO-70012","invoice_date":"${iso(NOW)}"}}'</div>
  <div class="secret">{ "outcome": "needs_human", "status": "pending_review", "required_approver": "reviewer",<br>&nbsp; "reasons": ["$7,500.00 is above the $5,000.00 auto-approve limit"], "audit": { "seq": 1287, "hash": "9f2c…" } }</div>
  <div class="small muted">Money is always integer cents plus an ISO currency code.</div></div></div>
  <div class="card tw"><table><thead><tr><th>Method</th><th>Path</th><th>What it does</th></tr></thead><tbody>${eps.map(([m, p, d]) => `<tr><td>${badge([m, m === "GET" ? "info" : m === "PUT" ? "warn" : "good"])}</td><td class="mono">${p}</td><td class="small">${d}</td></tr>`).join("")}</tbody></table></div>`;
}
