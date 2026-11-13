/* ============================================================ UI state */
const U = { session: { kind: "staff", id: "u_dana" }, page: "scorecard", p: {}, flash: null, modal: null, issued: null, tamper: null, verify: null, running: null };
const me = () => (U.session?.kind === "staff" ? userById(U.session.id) : null);
const sme = () => (U.session?.kind === "supplier" ? supplierCtx(U.session.id) : null);

const ICON = {
  chart: '<path d="M3 3v18h18"/><path d="M7 15v3M12 10v8M17 6v12"/>', inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', receipt: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .5V2l-1 .5-3-2-3 2-3-2-3 2-3-2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  truck: '<path d="M1 4h13v11H1zM14 8h4l4 4v3h-8z"/><circle cx="5.5" cy="18" r="2"/><circle cx="17.5" cy="18" r="2"/>', flask: '<path d="M9 3h6M10 3v6L4 19a2 2 0 0 0 1.7 3h12.6a2 2 0 0 0 1.7-3L14 9V3"/>',
  rules: '<path d="M12 3v18M5 7h14M7 7l-3 7a3 3 0 0 0 6 0zM17 7l-3 7a3 3 0 0 0 6 0z"/>', gauge: '<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>', settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 4.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  code: '<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
const LOGO = `<svg viewBox="0 0 24 24"><path d="M6 12.5l4 4 8-9" stroke="white" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const statusBadge = (s) => badge(STATUS[s]);
const ruleIcon = (r) => `<span class="ic ${r === "pass" ? "ok" : r === "fail" ? "x" : "na"}">${r === "pass" ? "✓" : r === "fail" ? "✕" : "–"}</span>`;
const ph = (title, desc, acts = "") => `<div class="ph"><div><h1>${title}</h1>${desc ? `<p>${desc}</p>` : ""}</div>${acts ? `<div class="acts">${acts}</div>` : ""}</div>`;
const empty = (t, s = "") => `<div class="empty"><b>${t}</b>${s}</div>`;
const flashAlert = () => (U.flash ? `<div class="alert t-${U.flash[0]}">${U.flash[1]}</div>` : "");

/* ============================================================ staff shell */
function staffShell(body) {
  const u = me();
  const queue = S.actions.filter((a) => a.status === "pending_review").length;
  const waiting = S.invoices.filter((i) => i.status === "under_review").length;
  const changes = S.bankChanges.filter((b) => b.status === "pending").length;
  const items = [
    ["scorecard", "Scorecard", "chart", "scorecard"], ["review", "Review queue", "inbox", "actions", queue], ["actions", "All actions", "list", "actions"],
    ["invoices", "Supplier invoices", "receipt", "suppliers", waiting], ["suppliers", "Suppliers", "truck", "suppliers", changes],
    ["replay", "Replay testing", "flask", "actions"], ["rules", "Rules", "rules", "actions"], ["autonomy", "Autonomy", "gauge", "actions"],
    ["audit", "Audit trail", "shield", "audit"], ["settings", "Settings", "settings", "settings:view"], ["api", "Agent API", "code", "actions"],
  ].filter((x) => can(u.role, x[3]));
  const group = { review: "review", action: "actions", invoice: "invoices", comparison: "replay" };
  const active = group[U.page] ?? U.page;
  return `<div class="shell">
    <aside class="side"><div class="stick">
      <div class="brandrow"><div class="logo">${LOGO}</div><div style="min-width:0;line-height:1.2"><div style="font-weight:600;font-size:14px">Control Room</div><div class="small muted">${S.org.name}</div></div></div>
      <nav>${items.map(([k, l, ic, , n]) => `<button data-a="go" data-page="${k}" aria-current="${active === k}">${icon(ic)}<span class="lbl">${l}</span>${n ? `<span class="count">${n}</span>` : ""}</button>`).join("")}</nav>
      <div class="foot">Accounts payable · USD<br>Autonomy Level ${S.workflow.level}</div>
    </div></aside>
    <div class="main">
      <header class="topbar">${u.role === "auditor" ? `<span class="pill-ro">Read-only access</span>` : ""}<div style="text-align:right;line-height:1.2"><div style="font-weight:500">${u.name}</div><div class="small muted">${ROLE_LABEL[u.role]}</div></div><button class="btn ghost sm" data-a="signout">Sign out</button></header>
      <div class="content">${flashAlert()}${body}</div>
    </div></div>`;
}

/* ============================================================ scorecard */
function vScorecard() {
  const weeks = weekly().slice(-8);
  const sel = U.p.week !== undefined ? weeks[U.p.week] : weeks[weeks.length - 2]; // last full week
  const idx = weeks.indexOf(sel); const prev = weeks[idx - 1];
  const delta = (cur, p, f, good) => { if (!p || cur === null || p === null) return ""; const d = cur - p; if (Math.abs(d) < 1e-9) return "no change"; const up = d > 0; return `<span class="${up === good ? "good" : "bad"}">${up ? "▲" : "▼"} ${f(Math.abs(d))}</span> vs prior week`; };
  const drill = (flag, label, val, sub, tone = "") => `<button class="stat" data-a="drill" data-flag="${flag}" data-week="${iso(sel.start)}"><div class="l">${label}</div><div class="v ${tone}">${val}</div><div class="s">${sub}</div></button>`;
  const maxV = Math.max(...weeks.map((w) => w.volume));
  const W = 720, H = 220, pad = 34, bw = (W - pad * 2) / weeks.length;
  const chart = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Invoices per week and agent accuracy">
    ${[0, 0.5, 1].map((t) => `<line x1="${pad}" x2="${W - pad}" y1="${H - 28 - t * (H - 50)}" y2="${H - 28 - t * (H - 50)}" stroke="var(--border)"/><text x="${pad - 6}" y="${H - 24 - t * (H - 50)}" text-anchor="end">${Math.round(t * maxV)}</text><text x="${W - pad + 6}" y="${H - 24 - t * (H - 50)}">${Math.round(80 + t * 20)}%</text>`).join("")}
    ${weeks.map((w, i) => { const x = pad + i * bw + bw * 0.2, bwid = bw * 0.6; const hAuto = (w.autoCount / maxV) * (H - 50), hAll = (w.volume / maxV) * (H - 50);
      return `<rect x="${x}" y="${H - 28 - hAll}" width="${bwid}" height="${hAll - hAuto}" rx="2" fill="var(--border-strong)"/><rect x="${x}" y="${H - 28 - hAuto}" width="${bwid}" height="${hAuto}" rx="2" fill="var(--brand)" opacity="${w === sel ? 1 : 0.55}"/><text x="${x + bwid / 2}" y="${H - 10}" text-anchor="middle">${w.start.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</text>`; }).join("")}
    <polyline fill="none" stroke="var(--good)" stroke-width="2.5" points="${weeks.map((w, i) => w.accuracy === null ? "" : `${pad + i * bw + bw / 2},${H - 28 - ((Math.max(0.8, w.accuracy) - 0.8) / 0.2) * (H - 50)}`).join(" ")}"/>
    ${weeks.map((w, i) => w.accuracy === null ? "" : `<circle cx="${pad + i * bw + bw / 2}" cy="${H - 28 - ((Math.max(0.8, w.accuracy) - 0.8) / 0.2) * (H - 50)}" r="${w === sel ? 4.5 : 3}" fill="var(--good)"/>`).join("")}
  </svg>`;
  return ph("Scorecard", "How the AP agent did, week by week. Every number opens the invoices behind it.",
    `<select class="i" style="width:auto" data-a="week">${weeks.map((w, i) => `<option value="${i}" ${w === sel ? "selected" : ""}>Week of ${dFmt(w.start)}</option>`).join("")}</select>`) + `
  <div class="stats six">
    ${drill("all", "Invoices processed", sel.volume, delta(sel.volume, prev?.volume, (x) => x, true))}
    ${drill("reviewed", "Agent accuracy", pct(sel.accuracy), delta(sel.accuracy, prev?.accuracy, (x) => pct(x), true) || "Where a person checked its work", sel.accuracy >= S.workflow.target ? "good" : "")}
    ${drill("escalated", "Sent to a person", pct(sel.escalation), delta(sel.escalation, prev?.escalation, (x) => pct(x), false) || "Escalation rate")}
    ${drill("auto", "Approved automatically", fmtK(sel.autoAmount), `${sel.autoCount} invoices`)}
    ${drill("money_at_risk", "Money at risk", fmtK(sel.risk), sel.riskCount ? `${sel.riskCount} approved despite a failed check` : "Nothing approved past a failed check", sel.risk ? "bad" : "good")}
    ${drill("all", "Cost per invoice", fmt(sel.costPer), "Agent fee plus people's review time")}
  </div>
  <div class="card"><div class="ch"><div><h3>Volume and accuracy</h3><p>Bars: invoices per week (blue: approved automatically). Line: agent accuracy where a person checked.</p></div></div><div class="cb chart">${chart}</div></div>
  <div class="two"><div class="card"><div class="ch"><h3>Blocked before payment</h3></div><div class="cb"><div style="font-size:22px;font-weight:650" class="tab">${fmt(sel.blocked)}</div><div class="small muted">Stopped by blocking rules this week (duplicates, blocked vendors).</div></div></div>
  <div class="card"><div class="ch"><h3>Autonomy</h3><button class="lnk small" data-a="go" data-page="autonomy">Open →</button></div><div class="cb"><div>Level <b>${S.workflow.level}</b>: ${LEVELS[S.workflow.level][0]}</div><div class="small muted">Rolling accuracy ${pct(rollingAccuracy().acc)} over the last ${rollingAccuracy().n} reviewed invoices; promotion needs ${pct(S.workflow.target)}.</div></div></div></div>`;
}

/* ============================================================ actions */
function filterActions(f) {
  return S.actions.filter((a) => {
    if (f.status && a.status !== f.status) return false;
    if (f.vendor && !(`${a.vendorName} ${a.vendorCode}`.toLowerCase().includes(f.vendor.toLowerCase()))) return false;
    if (f.q && !a.number.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.week) { const s = new Date(f.week + "T00:00"); if (a.createdAt < s || a.createdAt >= new Date(s.getTime() + 7 * DAY)) return false; }
    if (f.source && a.source !== f.source) return false;
    switch (f.flag) {
      case "money_at_risk": return moneyAtRisk(a);
      case "overridden": return a.review?.decision === "approve" && a.results.some(isControlFailure);
      case "agent_wrong": return a.review && !a.review.agentCorrect;
      case "reviewed": return Boolean(a.review);
      case "escalated": return a.computed === "needs_human";
      case "auto": return a.status === "auto_approved";
    }
    return true;
  }).sort((x, y) => y.createdAt - x.createdAt);
}
const FLAGS = { money_at_risk: "Money at risk: went ahead despite a failed check", overridden: "Approved by a person despite a failed check", agent_wrong: "Agent was wrong (per reviewer)", reviewed: "Reviewed by a person", escalated: "Sent for review", auto: "Approved automatically" };
function vActions() {
  const f = U.p; const rows = filterActions(f); const page = f.pageNo ?? 0; const shown = rows.slice(page * 50, page * 50 + 50);
  return ph("All actions", "Every invoice an agent proposed to act on, with what Control Room decided.", can(me().role, "audit:export") ? `<button class="btn sec" data-a="evidence" data-scope="filter">Export evidence</button>` : "") + `
  <div class="filters">
    <label class="f">Invoice<input class="i" id="f-q" value="${esc(f.q ?? "")}" placeholder="Invoice number" style="width:150px"></label>
    <label class="f">Vendor<input class="i" id="f-vendor" value="${esc(f.vendor ?? "")}" placeholder="Name or code" style="width:160px"></label>
    <label class="f">Status<select class="i" id="f-status" style="width:190px"><option value="">Any</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${f.status === k ? "selected" : ""}>${v[0]}</option>`).join("")}</select></label>
    <label class="f">Show only<select class="i" id="f-flag" style="width:250px"><option value="">Everything</option>${Object.entries(FLAGS).map(([k, v]) => `<option value="${k}" ${f.flag === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <button class="btn sec" data-a="filter">Filter</button>${Object.keys(f).length ? `<button class="btn ghost" data-a="go" data-page="actions">Clear</button>` : ""}
  </div>
  <div class="small muted"><b class="tab" style="color:var(--ink)">${rows.length}</b> invoices · <b class="tab" style="color:var(--ink)">${fmt(rows.reduce((t, a) => t + a.amount, 0))}</b>${f.week ? ` · week of ${dFmt(f.week + "T00:00")}` : ""}${f.flag ? ` · ${FLAGS[f.flag]}` : ""}</div>
  <div class="card tw">${rows.length ? `<table><thead><tr><th>Invoice</th><th class="r">Amount</th><th>Agent proposed</th><th>Outcome</th><th>Failed checks</th><th>Reviewed by</th><th>Received</th></tr></thead><tbody>
  ${shown.map((a) => { const fails = a.results.filter((r) => r.result === "fail"); return `<tr class="hov"><td><button class="lnk" data-a="action" data-id="${a.id}">${esc(a.number)}</button><div class="small muted">${esc(a.vendorName)}${a.source === "supplier portal" ? ` · <span class="badge t-sup">portal</span>` : ""}</div></td><td class="r tab">${fmt(a.amount)}</td><td>${DECISION[a.proposed]} <span class="small muted">${pct(a.confidence, 0)}</span></td><td>${statusBadge(a.status)}</td><td class="small">${fails.length ? fails.map((r) => esc(r.name)).join(", ") : `<span class="muted">None</span>`}</td><td class="small">${a.review ? esc(a.review.byName) : "-"}</td><td class="small muted">${tFmt(a.createdAt)}</td></tr>`; }).join("")}
  </tbody></table>` : empty("No invoices match these filters")}</div>
  ${rows.length > 50 ? `<div class="btns"><button class="btn sec sm" data-a="page" data-n="${page - 1}" ${page === 0 ? "disabled" : ""}>Previous</button><span class="small muted" style="align-self:center">Page ${page + 1} of ${Math.ceil(rows.length / 50)}</span><button class="btn sec sm" data-a="page" data-n="${page + 1}" ${(page + 1) * 50 >= rows.length ? "disabled" : ""}>Next</button></div>` : ""}`;
}

function vReviewQueue() {
  const pend = S.actions.filter((a) => a.status === "pending_review").sort((a, b) => a.createdAt - b.createdAt);
  const spot = S.actions.filter((a) => a.status === "logged" && !a.review).slice(0, 20);
  const u = me();
  return ph("Review queue", "Invoices the gate sent to a person. Oldest first. Each decision needs a reason and becomes the agent's ground truth.") + `
  <div class="card tw">${pend.length ? `<table><thead><tr><th>Invoice</th><th class="r">Amount</th><th>Why it's here</th><th>Needs</th><th>Waiting since</th></tr></thead><tbody>
  ${pend.map((a) => `<tr class="hov"><td><button class="lnk" data-a="action" data-id="${a.id}">${esc(a.number)}</button><div class="small muted">${esc(a.vendorName)}</div></td><td class="r tab">${fmt(a.amount)}</td><td class="small">${esc(a.reasons[0])}${a.reasons.length > 1 ? ` <span class="muted">+${a.reasons.length - 1}</span>` : ""}</td><td>${RANK[u.role] >= RANK[a.requiredRole] ? badge([APPROVER[a.requiredRole], "neutral"]) : badge([APPROVER[a.requiredRole], "warn"])}</td><td class="small muted">${tFmt(a.createdAt)}</td></tr>`).join("")}
  </tbody></table>` : empty("Queue is empty", "Nothing is waiting for a person.")}</div>
  ${spot.length ? `<div class="card"><div class="ch"><div><h3>Spot checks (shadow mode)</h3><p>The agent went ahead on these. Say what should have happened to build its track record.</p></div></div><div class="cb">${spot.map((a) => `<button class="lnk" data-a="action" data-id="${a.id}">${esc(a.number)} · ${fmt(a.amount)}</button>`).join("")}</div></div>` : ""}`;
}

function vAction() {
  const a = S.actions.find((x) => x.id === U.p.id);
  if (!a) return empty("Invoice not found");
  const u = me(); const agent = agentById(a.agentId);
  const canDecide = (a.status === "pending_review" || (a.status === "logged" && !a.review)) && can(u.role, "review");
  const enough = a.status === "logged" || RANK[u.role] >= RANK[a.requiredRole ?? "reviewer"];
  const failed = a.results.filter(isControlFailure).length;
  const recs = S.audit.filter((r) => r.entityId === a.id);
  const inv = S.invoices.find((i) => i.actionId === a.id);
  const next = S.actions.filter((x) => x.status === "pending_review" && x.id !== a.id).sort((x, y) => x.createdAt - y.createdAt)[0];
  return `<button class="back" data-a="go" data-page="${U.p.from ?? "actions"}">← ${U.p.from === "review" ? "Review queue" : "All actions"}</button>` +
  ph(`Invoice ${esc(a.number)} ${statusBadge(a.status)}`, `${esc(a.vendorName)} · received ${tFmt(a.createdAt)}${inv ? ` · sent through the supplier portal` : ""}`, can(u.role, "audit:export") ? `<button class="btn sec" data-a="evidence" data-scope="action" data-id="${a.id}">Evidence pack</button>` : "") + `
  <div class="two"><div class="stack">
    <div class="card"><div class="cb"><dl class="meta">
      <div><dt>Amount</dt><dd class="tab">${fmt(a.amount)}</dd></div><div><dt>Vendor</dt><dd>${esc(a.vendorName)} <span class="muted small">${esc(a.vendorCode)}</span></dd></div>
      <div><dt>PO</dt><dd>${a.po ?? "None"}</dd></div><div><dt>Goods received note</dt><dd>${a.grn ?? "None"}</dd></div>
      <div><dt>Invoice date</dt><dd>${a.invoiceDate}</dd></div><div><dt>GL code</dt><dd>${a.gl}</dd></div>
      <div><dt>Autonomy level</dt><dd>Level ${a.level}</dd></div><div><dt>Agent</dt><dd>${esc(agent.name)} <span class="muted small">v${a.agentVersion}</span></dd></div>
    </dl>${inv ? `<div class="small"><button class="lnk" data-a="invoice" data-id="${inv.id}">Open the supplier's invoice →</button></div>` : ""}</div></div>
    <div class="card"><div class="ch"><h3>What the agent proposed</h3></div><div class="cb">
      <div><b>${DECISION[a.proposed]}</b> <span class="muted">· ${pct(a.confidence, 0)} sure · GL ${a.gl}</span></div>
      <div class="ink2">“${esc(a.reason)}”</div>
    </div></div>
    <div class="card"><div class="ch"><h3>What Control Room decided</h3>${statusBadge(a.status)}</div><div class="cb">
      <ul style="margin:0;padding-left:18px">${a.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
      ${a.requiredRole && a.status === "pending_review" ? `<div class="small">Needs: <b>${APPROVER[a.requiredRole]}</b></div>` : ""}
    </div></div>
    <div class="card"><div class="ch"><div><h3>Rule results</h3><p>Rule set ${esc(a.ruleSet)}</p></div></div><div class="cb"><ul class="rl">
      ${a.results.map((r) => `<li>${ruleIcon(r.result)}<div><b>${esc(r.name)}</b> <span class="small muted">v${r.version}</span> ${r.result === "fail" ? badge(r.severity === "block" ? ["Blocks", "bad"] : r.routing ? ["Routes approval", "info"] : ["Needs a person", "warn"]) : ""}<div class="small ink2">${esc(r.explanation)}</div></div></li>`).join("")}
    </ul></div></div>
    <div class="card"><div class="ch"><div><h3>Audit records</h3><p>Hash-chained and append-only</p></div><button class="lnk small" data-a="go" data-page="audit">Audit trail →</button></div><div class="tw"><table><thead><tr><th>#</th><th>Event</th><th>By</th><th>When</th><th>Fingerprint</th></tr></thead><tbody>${recs.map((r) => `<tr><td class="tab">${r.seq}</td><td>${esc(r.type)}</td><td>${esc(r.actor.name)}</td><td class="small muted">${tFmt(r.at)}</td><td class="mono muted">${r.hash.slice(0, 12)}…</td></tr>`).join("")}</tbody></table></div></div>
  </div><div class="stack">
    ${a.review ? `<div class="card"><div class="ch"><h3>${a.review.spot ? "Spot check" : "Decision"}</h3>${badge(a.review.decision === "approve" ? ["Approved", "good"] : ["Rejected", "bad"])}</div><div class="cb small">
      <div><b>${esc(a.review.byName)}</b> · ${tFmt(a.review.at)}</div><div class="ink2">“${esc(a.review.reason)}”</div>
      <div>Agent was ${a.review.agentCorrect ? `<span class="good">right</span>` : `<span class="bad">wrong</span>`} (should have: ${DECISION[a.review.correct].toLowerCase()})</div>
      ${moneyAtRisk(a) ? `<div class="alert t-bad">Approved despite a failed check. Counts as money at risk.</div>` : ""}</div></div>` : ""}
    ${canDecide ? (enough ? `<div class="card" style="border-color:var(--brand)"><div class="ch"><h3>${a.status === "logged" ? "Spot check this decision" : "Your decision"}</h3></div><div class="cb">
      ${failed && a.status !== "logged" ? `<div class="alert t-warn">${failed} check${failed > 1 ? "s" : ""} failed. Approving overrides ${failed > 1 ? "them" : "it"} and counts as money at risk.</div>` : ""}
      <label class="f">Reason <span class="h">Required. The auditor will see this.</span><textarea class="i" id="rv-reason" rows="3" placeholder="e.g. Confirmed price change with the buyer"></textarea></label>
      ${a.proposed === "escalate" ? `<label class="chk-l"><input type="checkbox" id="rv-right" checked> The agent was right to send this to a person</label>` : ""}
      <div class="grid2"><button class="btn good" data-a="review" data-id="${a.id}" data-d="approve" data-next="${next?.id ?? ""}">${a.status === "logged" ? "Should approve" : "Approve"}</button><button class="btn sec" data-a="review" data-id="${a.id}" data-d="reject" data-next="${next?.id ?? ""}">${a.status === "logged" ? "Should reject" : "Reject"}</button></div>
    </div></div>` : `<div class="alert t-info">This invoice needs a decision by ${APPROVER[a.requiredRole].toLowerCase()}. Switch to Dana (controller) or Alex (admin) in the bar above.</div>`) : ""}
  </div></div>`;
}

/* ============================================================ supplier invoices (buyer) */
const BUY_STATUS = { draft: ["Draft", "neutral"], submitted: ["Received", "info"], under_review: ["Waiting for a decision", "warn"], approved: ["Approved, not yet scheduled", "good"], needs_changes: ["Sent back to supplier", "warn"], rejected: ["Rejected", "bad"], scheduled: ["Payment scheduled", "brand"], paid: ["Paid", "good"], cancelled: ["Cancelled", "neutral"] };
const SUP_STATUS = { ...BUY_STATUS, submitted: ["Sent", "info"], under_review: ["With buyer for approval", "info"], approved: ["Approved", "good"], needs_changes: ["Needs changes", "warn"] };
function vInvoices() {
  const tabs = [["under_review", "Waiting for a decision"], ["approved", "Ready to pay"], ["scheduled", "Scheduled"], ["paid", "Paid"], ["needs_changes", "Sent back"], ["all", "All"]];
  const t = U.p.tab ?? "under_review";
  const visible = S.invoices.filter((i) => i.status !== "draft");
  const rows = visible.filter((i) => t === "all" || i.status === t);
  return ph("Supplier invoices", "Invoices your suppliers sent through the supplier portal. Each one goes through the same AI check, rules and approval limits as any other invoice.", `<button class="btn sec" data-a="go" data-page="suppliers">Suppliers & bank changes</button>`) + `
  <div class="tabs">${tabs.map(([k, l]) => `<button aria-selected="${t === k}" data-a="invtab" data-tab="${k}">${l}<span class="n tab">${visible.filter((i) => k === "all" || i.status === k).length}</span></button>`).join("")}</div>
  <div class="card tw">${rows.length ? `<table><thead><tr><th>Invoice</th><th>Supplier</th><th>PO</th><th class="r">Amount</th><th>Status</th><th>Received</th><th>Due</th></tr></thead><tbody>
  ${rows.map((i) => { const v = vendorByCode(i.vendorCode); const a = S.actions.find((x) => x.id === i.actionId); return `<tr class="hov"><td><button class="lnk" data-a="invoice" data-id="${i.id}">${esc(i.number)}</button>${i.kind === "credit_note" ? ` <span class="badge t-info">Credit note</span>` : ""}${i.revision > 1 ? ` <span class="small muted">resent</span>` : ""}</td><td>${esc(v.name)}<div class="small muted">${v.code}</div></td><td class="muted">${i.po ?? "None"}</td><td class="r tab">${i.kind === "credit_note" ? "−" : ""}${fmt(invTotal(i))}</td><td>${badge(BUY_STATUS[i.status])}${a?.status === "blocked" ? ` <span class="small bad">blocked by a rule</span>` : ""}</td><td class="small muted">${dFmt(i.sentAt)}</td><td class="small muted">${i.status === "scheduled" ? "Paying " + dFmt(i.payOn + "T12:00") : i.status === "paid" ? "Paid " + dFmt(i.paidOn + "T12:00") : dFmt(i.due + "T12:00")}</td></tr>`; }).join("")}
  </tbody></table>` : empty("Nothing here", "No supplier invoices with this status.")}</div>`;
}

function linesTable(inv) {
  return `<div class="tw"><table><thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Unit price</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead><tbody>
  ${inv.lines.map((l) => `<tr><td>${esc(l.d)}</td><td class="r tab">${l.q}</td><td class="r tab">${fmt(l.u)}</td><td class="r tab muted">${l.tax ? (l.tax / 100).toFixed(2) + "%" : "-"}</td><td class="r tab">${fmt(l.q * l.u)}</td></tr>`).join("")}
  </tbody></table></div><div class="tot"><div><span class="muted">Subtotal</span><span class="tab">${fmt(invSubtotal(inv))}</span></div><div><span class="muted">Tax</span><span class="tab">${fmt(invTotal(inv) - invSubtotal(inv))}</span></div><div class="big"><span>${inv.kind === "credit_note" ? "Total credit" : "Total"}</span><span class="tab">${fmt(invTotal(inv))}</span></div></div>`;
}
const timeline = (inv, map) => `<ol class="tl">${inv.events.map((e) => `<li><span class="dot"></span><div><div style="font-weight:500">${map[e.status][0]}</div>${e.note ? `<div class="small ink2">${esc(e.note)}</div>` : ""}<div class="small muted">${tFmt(e.at)}${e.who ? " · " + esc(e.who) : ""}</div></div></li>`).join("")}</ol>`;
const thread = (inv, mine, canPost, emptyText) => `<div class="msgs">${inv.msgs.length ? inv.msgs.map((m) => `<div class="msg ${m.from === mine ? "me" : ""}">${esc(m.body)}<div class="by">${esc(m.by)} · ${tFmt(m.at)}</div></div>`).join("") : `<div class="small muted">${emptyText}</div>`}</div>
  ${canPost ? `<div style="display:flex;gap:8px"><input class="i" id="msg-${inv.id}" placeholder="Write a message"><button class="btn sec" data-a="msg" data-id="${inv.id}" data-from="${mine}">Send</button></div>` : ""}`;

function vInvoice() {
  const inv = S.invoices.find((i) => i.id === U.p.id); if (!inv) return empty("Invoice not found");
  const u = me(); const c = connOf(inv); const v = vendorByCode(c.vendorCode); const acct = S.supplierAccounts.find((x) => x.id === inv.accountId);
  const a = S.actions.find((x) => x.id === inv.actionId); const bank = bankOf(c);
  const pendingChange = S.bankChanges.find((b) => b.connId === c.id && b.status === "pending");
  const failed = a ? a.results.filter(isControlFailure).length : 0;
  const enough = !a || a.status !== "pending_review" || RANK[u.role] >= RANK[a.requiredRole ?? "reviewer"];
  const canDecide = inv.status === "under_review" && can(u.role, "review") && enough;
  const canPay = can(u.role, "payments") && inv.kind === "invoice" && ["approved", "scheduled"].includes(inv.status);
  const payFrom = S.bankAccounts.find((b) => b.id === inv.payFrom);
  const blockReason = pendingChange ? "A bank detail change for this supplier is waiting for a decision." : v.blocked ? `Vendor is blocked: ${v.blockedReason}` : !bank ? "The supplier has no approved bank account." : null;
  return `<button class="back" data-a="go" data-page="invoices">← Supplier invoices</button>` +
  ph(`${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${esc(inv.number)} ${badge(BUY_STATUS[inv.status])}`, `From ${esc(v.name)} (${v.code})${inv.revision > 1 ? ` · sent ${inv.revision} times` : ""}`, `<button class="btn sec" data-a="pdf" data-id="${inv.id}">View PDF</button>`) + `
  ${pendingChange ? `<div class="alert t-warn"><b>Bank detail change waiting</b>This supplier asked to change where they're paid. Payments are on hold until someone decides it on the Suppliers page.</div>` : ""}
  <div class="two"><div class="stack">
    <div class="card"><div class="cb"><dl class="meta"><div><dt>Invoice date</dt><dd>${dFmt(inv.date + "T12:00")}</dd></div><div><dt>Due</dt><dd>${dFmt(inv.due + "T12:00")}</dd></div><div><dt>PO</dt><dd>${inv.po ?? "None"}</dd></div><div><dt>Delivery record</dt><dd>${inv.grn ?? "None"}</dd></div><div><dt>Pay to</dt><dd>${bank ? `${esc(bank.bank)} ••${bank.last4}` : "No approved account"}</dd></div>${payFrom ? `<div><dt>Pay from</dt><dd>${esc(payFrom.nickname)} ••${payFrom.last4}</dd></div>` : ""}${inv.payOn ? `<div><dt>Payment date</dt><dd>${dFmt(inv.payOn + "T12:00")}</dd></div>` : ""}${inv.ref ? `<div><dt>Payment reference</dt><dd>${esc(inv.ref)}</dd></div>` : ""}</dl>
    ${linesTable(inv)}${inv.notes ? `<div class="sentence"><span class="muted">Supplier's note: </span>${esc(inv.notes)}</div>` : ""}</div></div>
    <div class="card"><div class="ch"><div><h3>AI check and rules</h3><p>${a ? `Checked by ${esc(agentById(a.agentId).name)} and your rules. The supplier doesn't see any of this.` : "Credit notes are checked by a person."}</p></div>${a ? `<button class="lnk small" data-a="action" data-id="${a.id}">Full detail →</button>` : ""}</div>
    ${a ? `<div class="cb"><div class="small">Agent proposed: <b>${DECISION[a.proposed]}</b> · ${pct(a.confidence, 0)} sure · Outcome: ${statusBadge(a.status)}${a.requiredRole && a.status === "pending_review" ? ` · needs ${APPROVER[a.requiredRole].toLowerCase()}` : ""}</div>
      <div class="small ink2">“${esc(a.reason)}”</div><ul class="rl">${a.results.map((r) => `<li>${ruleIcon(r.result)}<div><b>${esc(r.name)}</b> <span class="small muted">v${r.version}</span><div class="small ink2">${esc(r.explanation)}</div></div></li>`).join("")}</ul></div>` : ""}</div>
    <div class="card"><div class="ch"><h3>Messages with the supplier</h3></div><div class="cb">${thread(inv, "buyer", can(u.role, "review") || can(u.role, "suppliers:manage"), "No messages yet.")}</div></div>
  </div><div class="stack">
    ${canDecide ? `<div class="card" style="border-color:var(--brand)"><div class="ch"><h3>Your decision</h3></div><div class="cb">
      ${a?.status === "blocked" ? `<div class="alert t-bad">A control blocked this invoice, so it can't be approved. Send it back or reject it.</div>` : failed ? `<div class="alert t-warn">${failed} check${failed > 1 ? "s" : ""} failed. Approving overrides ${failed > 1 ? "them" : "it"}.</div>` : ""}
      <label class="f">Reason <span class="h">Kept internal; the auditor sees it</span><textarea class="i" id="dc-reason" rows="2">Matches the PO and the delivery record</textarea></label>
      <label class="f">Message to the supplier <span class="h">Needed to send back or reject. The supplier sees it.</span><textarea class="i" id="dc-msg" rows="2" placeholder="e.g. Please add the PO number and send it again"></textarea></label>
      ${a?.status !== "blocked" ? `<button class="btn good full" data-a="decide" data-id="${inv.id}" data-d="approve">Approve</button>` : ""}
      <div class="grid2"><button class="btn sec" data-a="decide" data-id="${inv.id}" data-d="send_back">Send back</button><button class="btn bad" data-a="decide" data-id="${inv.id}" data-d="reject">Reject</button></div>
    </div></div>` : inv.status === "under_review" && !enough ? `<div class="alert t-info">This invoice needs a decision by ${APPROVER[a.requiredRole].toLowerCase()}.</div>` : ""}
    ${canPay ? `<div class="card"><div class="ch"><div><h3>${inv.status === "scheduled" ? "Payment scheduled" : "Pay this invoice"}</h3><p>${fmt(invTotal(inv))} to ${bank ? `${esc(bank.bank)} ••${bank.last4}` : "no approved account"}</p></div></div><div class="cb">
      ${blockReason ? `<div class="alert t-warn">${blockReason}</div>` : ""}
      <label class="f">Pay from<select class="i" id="pay-from">${S.bankAccounts.filter((b) => b.state === "active").map((b) => `<option value="${b.id}" ${b.isDefault ? "selected" : ""}>${esc(b.nickname)} · ${esc(b.bank)} ••${b.last4}</option>`).join("")}</select></label>
      <label class="f">${inv.status === "scheduled" ? "Move payment date to" : "Payment date"}<input class="i" type="date" id="pay-on" value="${inv.payOn ?? iso(new Date(NOW.getTime() + 2 * DAY))}"></label>
      <button class="btn p full" data-a="schedule" data-id="${inv.id}" ${blockReason ? "disabled" : ""}>${inv.status === "scheduled" ? "Reschedule" : "Schedule payment"}</button>
      ${inv.status === "scheduled" ? `<div style="border-top:1px solid var(--border);padding-top:12px;display:grid;gap:10px"><div class="small muted">Control Room records payments; your bank sends them. Once sent, record it here so the supplier sees it.</div>
        <div class="grid2"><label class="f">Paid on<input class="i" type="date" id="paid-on" value="${iso(NOW)}"></label><label class="f">Bank reference<input class="i" id="paid-ref" value="ACH-${Math.floor(10000 + Math.random() * 89999)}"></label></div>
        <button class="btn good full" data-a="paid" data-id="${inv.id}">Mark as paid</button></div>` : ""}
    </div></div>` : ""}
    <div class="card"><div class="ch"><h3>Supplier</h3></div><div class="cb small"><b>${esc(acct.legalName)}</b><div class="muted">EIN ${esc(acct.ein ?? "-")}</div><div class="muted">${esc(acct.email)}${acct.phone ? " · " + esc(acct.phone) : ""}</div><div class="muted">${esc(acct.address ?? "")}</div></div></div>
    <div class="card"><div class="ch"><div><h3>Timeline</h3><p>What the supplier sees, in their words</p></div></div><div class="cb">${timeline(inv, BUY_STATUS)}</div></div>
  </div></div>`;
}

function vSuppliers() {
  const u = me(); const manage = can(u.role, "suppliers:manage");
  const pend = S.bankChanges.filter((b) => b.status === "pending");
  const done = S.bankChanges.filter((b) => b.status !== "pending").slice(0, 8);
  const connected = new Set(S.connections.map((c) => c.vendorCode));
  const bankTxt = (id) => { const b = S.supplierBanks.find((x) => x.id === id); return b ? `${esc(b.bank)} ••${b.last4}` : "No approved account"; };
  return ph("Suppliers", "Invite suppliers to send invoices through the supplier portal, and approve any change to where they're paid.") + `
  <div class="card"><div class="ch"><div><h3>Bank detail changes waiting (${pend.length})</h3><p>Changing where a supplier is paid is the most common way invoice fraud happens. Before approving, call the supplier on a number from your own records, not one from the request.</p></div></div><div class="cb">
  ${pend.length ? pend.map((ch) => { const c = S.connections.find((x) => x.id === ch.connId); const v = vendorByCode(c.vendorCode); const acct = S.supplierAccounts.find((x) => x.id === c.accountId); const nb = S.supplierBanks.find((x) => x.id === ch.newBankId);
    return `<div class="card" style="border-color:var(--warn)"><div class="cb">
      <div><b>${esc(v.name)}</b> <span class="muted">${v.code}</span><div class="small muted">Requested by ${esc(ch.requestedBy)} on ${tFmt(ch.at)} · contact on file: ${esc(acct.email)}${acct.phone ? ", " + esc(acct.phone) : ""}</div></div>
      <div class="cmp"><div><div class="small muted">Currently paid into</div><b>${bankTxt(ch.prevBankId)}</b></div><div class="new"><div class="small muted">Wants to be paid into</div><b>${esc(nb.bank)} ••${nb.last4}</b><div class="small muted">Routing ${nb.routing} · holder ${esc(nb.holder)}</div></div></div>
      ${manage ? `<label class="f">How did you confirm this with the supplier? <span class="h">Required to approve</span><textarea class="i" id="ver-${ch.id}" rows="2" placeholder="e.g. Called ${esc(ch.requestedBy)} on ${esc(acct.phone ?? "the number in our vendor file")}; confirmed the new account"></textarea></label>
      <label class="f">Note to the supplier (if rejecting)<input class="i" id="note-${ch.id}"></label>
      <div class="btns"><button class="btn good" data-a="bankdecide" data-id="${ch.id}" data-d="approve">Approve new bank details</button><button class="btn sec" data-a="bankdecide" data-id="${ch.id}" data-d="reject">Reject</button></div>
      <div class="small muted">Approving updates the vendor record. The bank-change rule then sends this supplier's next payments to a person as an extra check.</div>` : ""}
    </div></div>`; }).join("") : empty("Nothing waiting", "New requests from suppliers appear here.")}
  </div></div>
  <div class="card"><div class="ch"><h3>Suppliers on the portal</h3>${manage ? `<button class="btn p sm" data-a="toggle" data-k="invite">Invite a supplier</button>` : ""}</div>
    ${U.p.invite ? `<div class="cb" style="border-bottom:1px solid var(--border)"><div class="form">
      <label class="f">Vendor<select class="i" id="inv-vendor"><option value="">Choose a vendor…</option>${S.vendors.filter((v) => !v.blocked && !connected.has(v.code)).map((v) => `<option value="${v.code}">${esc(v.name)} (${v.code})</option>`).join("")}</select></label>
      <label class="f">Supplier's email<input class="i" id="inv-email" type="email" placeholder="accounts@supplier.com"></label>
      <label class="f">Payment terms<select class="i" id="inv-terms">${[15, 30, 45, 60].map((d) => `<option value="${d}" ${d === 30 ? "selected" : ""}>${d} days</option>`).join("")}</select></label></div>
      <div class="btns"><button class="btn p" data-a="invite">Create invitation</button><button class="btn ghost" data-a="toggle" data-k="invite">Cancel</button></div></div>` : ""}
    ${U.issued?.invite ? `<div class="cb" style="border-bottom:1px solid var(--border)"><div class="alert t-good"><b>Invitation created for ${esc(U.issued.invite.name)}</b>In the real app this link is emailed to ${esc(U.issued.invite.email)}. It works once and expires in 14 days.<div class="secret" style="margin-top:6px">https://controlroom.app/portal/invite/${esc(U.issued.invite.token)}</div><div style="margin-top:8px"><button class="btn sec sm" data-a="openinvite" data-token="${esc(U.issued.invite.token)}">Open it as the supplier</button></div></div></div>` : ""}
    <div class="tw"><table><thead><tr><th>Supplier</th><th>Status</th><th>Portal account</th><th>Paid into</th><th>Terms</th><th class="r">Invoices</th><th></th></tr></thead><tbody>
    ${S.connections.map((c) => { const v = vendorByCode(c.vendorCode); const acct = S.supplierAccounts.find((x) => x.id === c.accountId);
      return `<tr><td><b>${esc(v.name)}</b><div class="small muted">${v.code} · ${esc(v.category)}</div></td><td>${badge(c.status === "active" ? ["Connected", "good"] : c.status === "invited" ? ["Invited", "warn"] : ["Suspended", "bad"])}<div class="small muted">${c.status === "invited" ? "Sent " + dFmt(c.invitedAt) + " to " + esc(c.inviteEmail) : "Since " + dFmt(c.acceptedAt)}</div></td><td>${acct ? `${esc(acct.legalName)}<div class="small muted">${esc(acct.email)}</div>` : `<span class="muted">Not yet</span>`}</td><td>${c.bankId ? bankTxt(c.bankId) : `<span class="muted">None approved</span>`}</td><td class="muted">${c.terms} days</td><td class="r tab">${S.invoices.filter((i) => i.connId === c.id && i.status !== "draft").length}</td>
      <td class="r">${manage && c.status === "invited" ? `<button class="btn ghost sm" data-a="openinvite" data-token="${c.token}">Open invitation</button>` : manage ? `<button class="btn ghost sm" data-a="suspend" data-id="${c.id}">${c.status === "active" ? "Suspend" : "Restore"}</button>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div></div>
  ${done.length ? `<div class="card"><div class="ch"><h3>Recent bank detail decisions</h3></div><div class="tw"><table><thead><tr><th>Supplier</th><th>New account</th><th>Decision</th><th>How it was verified</th><th>When</th></tr></thead><tbody>${done.map((h) => { const c = S.connections.find((x) => x.id === h.connId); const nb = S.supplierBanks.find((x) => x.id === h.newBankId); return `<tr><td>${esc(vendorByCode(c.vendorCode).name)}</td><td>${esc(nb.bank)} ••${nb.last4}</td><td>${badge(h.status === "approved" ? ["Approved", "good"] : h.status === "withdrawn" ? ["Replaced", "neutral"] : ["Rejected", "bad"])}<div class="small muted">${esc(h.decidedBy ?? "")}</div></td><td class="small">${esc(h.verification ?? h.note ?? "-")}</td><td class="small muted">${tFmt(h.decidedAt ?? h.at)}</td></tr>`; }).join("")}</tbody></table></div></div>` : ""}`;
}
