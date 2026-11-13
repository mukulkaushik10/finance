/* ============================================================ supplier portal */
function supShell(body) {
  const s = sme(); const att = S.invoices.filter((i) => i.accountId === s.account.id && ["draft", "needs_changes"].includes(i.status)).length;
  const items = [["s_home", "Home"], ["s_invoices", "Invoices"], ["s_bank", "Bank details"], ["s_company", "Company"]];
  const grp = { s_invoice: "s_invoices", s_new: "s_invoices", s_edit: "s_invoices" };
  const act = grp[U.page] ?? U.page;
  return `<div class="supmode"><header class="sup-top"><div class="in">
    <div style="display:flex;align-items:center;gap:10px"><div class="logo sup">${LOGO}</div><div style="line-height:1.2"><div style="font-weight:600">Supplier portal</div><div class="small muted">${esc(s.account.legalName)}</div></div></div>
    <nav>${items.map(([k, l]) => `<button data-a="go" data-page="${k}" aria-current="${act === k}">${l}${k === "s_home" && att ? ` <span class="count">${att}</span>` : ""}</button>`).join("")}</nav>
    <div style="margin-left:auto;display:flex;align-items:center;gap:10px"><span class="small ink2">${esc(s.user.name)}</span><button class="btn ghost sm" data-a="signout">Sign out</button></div>
  </div></header><div class="sup-content">${flashAlert()}${body}</div></div>`;
}
const myInvoices = () => S.invoices.filter((i) => i.accountId === sme().account.id);
function vSHome() {
  const s = sme(); const inv = myInvoices().filter((i) => i.kind === "invoice");
  const out = inv.filter((i) => ["submitted", "under_review", "approved", "scheduled"].includes(i.status));
  const paid = inv.filter((i) => i.status === "paid");
  const avg = paid.length ? paid.reduce((t, i) => t + (new Date(i.paidOn + "T12:00") - i.sentAt) / DAY, 0) / paid.length : null;
  const att = myInvoices().filter((i) => ["draft", "needs_changes"].includes(i.status));
  const conns = connsFor(s);
  return ph(`Hello, ${esc(s.user.name.split(" ")[0])}`, "What you're owed, what's on its way, and anything that needs you.", `<button class="btn p" data-a="go" data-page="s_new">+ New invoice</button>`) + `
  ${conns.filter((c) => !c.bankId).length ? `<div class="alert t-warn"><b>Add your bank details</b>${conns.filter((c) => !c.bankId).map((c) => S.org.name).join(", ")} can't pay you until you add bank details and they approve them. <button class="lnk" data-a="go" data-page="s_bank">Add bank details</button></div>` : ""}
  <div class="stats">
    <button class="stat" data-a="sinvtab" data-tab="outstanding"><div class="l">Owed to you</div><div class="v">${fmt(out.reduce((t, i) => t + invTotal(i), 0))}</div><div class="s">${out.length} sent, not yet paid</div></button>
    <button class="stat" data-a="sinvtab" data-tab="scheduled"><div class="l">Payment scheduled</div><div class="v">${fmt(inv.filter((i) => i.status === "scheduled").reduce((t, i) => t + invTotal(i), 0))}</div><div class="s">Buyer has set a date</div></button>
    <button class="stat" data-a="sinvtab" data-tab="paid"><div class="l">Paid, last 90 days</div><div class="v good">${fmt(paid.reduce((t, i) => t + invTotal(i), 0))}</div><div class="s">${paid.length} invoice${paid.length === 1 ? "" : "s"}</div></button>
    <div class="stat"><div class="l">Average time to get paid</div><div class="v">${avg === null ? "-" : avg.toFixed(0) + " days"}</div><div class="s">From sending to payment</div></div>
  </div>
  <div class="two"><div class="card"><div class="ch"><h3>Needs your attention</h3></div>${att.length ? `<div class="tw"><table><tbody>${att.map((i) => `<tr class="hov"><td><button class="lnk" data-a="sinvoice" data-id="${i.id}">${esc(i.number)}</button><div class="small muted">${S.org.name} · ${i.status === "draft" ? "Draft not sent yet" : "The buyer asked for changes"}</div></td><td class="r tab">${fmt(invTotal(i))}</td><td class="r">${badge(SUP_STATUS[i.status])}</td></tr>`).join("")}</tbody></table></div>` : empty("All clear", "Nothing is waiting for you.")}</div>
  <div class="card"><div class="ch"><h3>Your buyers</h3></div><div class="cb">${conns.map((c) => { const b = bankOf(c); const pend = S.bankChanges.find((x) => x.connId === c.id && x.status === "pending"); return `<div style="border:1px solid var(--border);border-radius:9px;padding:10px 12px" class="small"><b style="font-size:14px">${S.org.name}</b><div class="muted">Your vendor code: ${c.vendorCode} · ${c.terms}-day terms</div><div>${b ? `Pays into ${esc(b.bank)} ••${b.last4}` : `<span class="warn">No approved bank account</span>`}${pend ? ` <span class="warn">· change waiting for approval</span>` : ""}</div><button class="lnk" data-a="go" data-page="s_new">Bill a purchase order →</button></div>`; }).join("")}</div></div></div>`;
}
function vSInvoices() {
  const t = U.p.tab ?? "";
  const all = myInvoices().filter((i) => i.status !== "cancelled");
  const tabs = [["", "All"], ["outstanding", "Not yet paid"], ["needs_changes", "Needs changes"], ["draft", "Drafts"], ["scheduled", "Scheduled"], ["paid", "Paid"]];
  const pick = (k) => all.filter((i) => !k || (k === "outstanding" ? ["submitted", "under_review", "approved", "scheduled"].includes(i.status) : i.status === k));
  const rows = pick(t);
  return ph("Invoices", "Everything you've sent, and where it is.", `<button class="btn p" data-a="go" data-page="s_new">+ New invoice</button>`) + `
  <div class="tabs">${tabs.map(([k, l]) => `<button aria-selected="${t === k}" data-a="sinvtab" data-tab="${k}">${l}<span class="n">${pick(k).length}</span></button>`).join("")}</div>
  <div class="card tw">${rows.length ? `<table><thead><tr><th>Number</th><th>Buyer</th><th>PO</th><th class="r">Amount</th><th>Status</th><th>Sent</th><th>Due / paid</th></tr></thead><tbody>${rows.map((i) => `<tr class="hov"><td><button class="lnk" data-a="sinvoice" data-id="${i.id}">${esc(i.number)}</button>${i.kind === "credit_note" ? ` <span class="badge t-info">Credit note</span>` : ""}</td><td>${S.org.name}</td><td class="muted">${i.po ?? "-"}</td><td class="r tab">${fmt(invTotal(i))}</td><td>${badge(SUP_STATUS[i.status])}</td><td class="small muted">${dFmt(i.sentAt)}</td><td class="small muted">${i.status === "paid" ? "Paid " + dFmt(i.paidOn + "T12:00") : i.status === "scheduled" ? "Paying " + dFmt(i.payOn + "T12:00") : dFmt(i.due + "T12:00")}</td></tr>`).join("")}</tbody></table>` : empty("No invoices here")}</div>`;
}

/* invoice editor (new, edit, credit note) */
function draftFromPO(connId, poN) {
  const p = openPOs(sme(), connId).find((x) => x.n === poN);
  const ready = Math.max(0, p.received - p.qtyBilled);
  return { po: p.n, lines: [{ d: `${vendorByCode(p.vendorCode).category} as ordered on ${p.n}`, q: String(ready || Math.max(1, p.qty - p.qtyBilled)), u: (p.unit / 100).toFixed(2), tax: "0" }] };
}
function editorHTML(f) {
  const tot = f.lines.reduce((t, l) => { const u = parseMoney(l.u || "0"); const q = parseInt(l.q, 10); const tx = Math.round(parseFloat(l.tax || "0") * 100); if (u === null || !(q >= 1)) return t; const amt = u * q; return { sub: t.sub + amt, tax: t.tax + Math.round((amt * tx) / 10000) }; }, { sub: 0, tax: 0 });
  return `<div class="card"><div class="ch"><h3>${f.kind === "credit_note" ? "Credit note details" : "Invoice details"}</h3></div><div class="cb"><div class="form">
    <label class="f">Bill to<select class="i" disabled><option>${S.org.name}</option></select></label>
    <label class="f">${f.kind === "credit_note" ? "Credit note number" : "Invoice number"} <span class="h">${f.lock ? "Can't change after sending" : "Your own numbering, unique per buyer"}</span><input class="i" data-ed="number" value="${esc(f.number)}" placeholder="${f.kind === "credit_note" ? "CN-001" : "BP-2001"}" ${f.lock ? "disabled" : ""}></label>
    <label class="f">Purchase order <span class="h">Invoices with a PO are approved faster</span><input class="i" data-ed="po" value="${esc(f.po ?? "")}" placeholder="PO-90005" ${f.kind === "credit_note" ? "disabled" : ""}></label>
    <label class="f">Date<input class="i" type="date" data-ed="date" value="${f.date}"></label>
  </div></div></div>
  <div class="card"><div class="ch"><h3>Lines</h3></div><div class="cb">
    ${f.lines.map((l, i) => `<div class="form" style="grid-template-columns:minmax(180px,3fr) repeat(3,minmax(90px,1fr)) auto;align-items:end">
      <label class="f">Description<input class="i" data-line="${i}" data-k="d" value="${esc(l.d)}"></label><label class="f">Qty<input class="i" data-line="${i}" data-k="q" value="${esc(l.q)}" inputmode="numeric"></label>
      <label class="f">Unit price ($)<input class="i" data-line="${i}" data-k="u" value="${esc(l.u)}" inputmode="decimal"></label><label class="f">Tax %<input class="i" data-line="${i}" data-k="tax" value="${esc(l.tax)}" inputmode="decimal"></label>
      <button class="btn ghost sm" data-a="delline" data-i="${i}" ${f.lines.length === 1 ? "disabled" : ""} aria-label="Remove line">✕</button></div>`).join("")}
    <div><button class="btn ghost sm" data-a="addline">+ Add line</button></div>
    <div class="tot"><div><span class="muted">Subtotal</span><span class="tab" id="ed-sub">${fmt(tot.sub)}</span></div><div><span class="muted">Tax</span><span class="tab" id="ed-tax">${fmt(tot.tax)}</span></div><div class="big"><span>${f.kind === "credit_note" ? "Total credit" : "Total"}</span><span class="tab" id="ed-total">${fmt(tot.sub + tot.tax)}</span></div></div>
  </div></div>
  <div class="card"><div class="cb"><label class="f">Notes for the buyer (optional)<textarea class="i" data-ed="notes" rows="2">${esc(f.notes ?? "")}</textarea></label></div></div>
  <div class="btns" style="align-items:center"><button class="btn p" data-a="saveinvoice">Save and review</button><span class="small muted">Nothing is sent yet. You'll see the checks before sending.</span></div>`;
}
function vSNew() {
  const s = sme(); const c = connsFor(s).find((x) => x.status === "active");
  if (!c) return empty("You aren't connected to any buyers yet", "Buyers invite you to the portal.");
  if (!U.ed) U.ed = { mode: "new", kind: "invoice", connId: c.id, number: "", po: "", date: iso(NOW), notes: "", lines: [{ d: "", q: "1", u: "", tax: "0" }] };
  const f = U.ed;
  if (f.mode === "edit") { const inv = S.invoices.find((i) => i.id === f.id); return `<button class="back" data-a="sinvoice" data-id="${inv.id}">← Back</button>` + ph(`Edit ${inv.kind === "credit_note" ? "credit note" : "invoice"} ${esc(inv.number)}`, "") + (inv.status === "needs_changes" && inv.supplierNote ? `<div class="alert t-warn"><b>What ${S.org.name} asked for</b>${esc(inv.supplierNote)}</div>` : "") + editorHTML(f); }
  if (f.kind === "credit_note") { const orig = S.invoices.find((i) => i.id === f.creditFor); return `<button class="back" data-a="sinvoice" data-id="${orig.id}">← Invoice ${esc(orig.number)}</button>` + ph(`Credit note for ${esc(orig.number)}`, "Reduce what the buyer owes, for example for returned or damaged goods. Adjust the lines to the amount you're crediting.") + editorHTML(f); }
  const pos = openPOs(s, c.id);
  return ph("New invoice", "Start from one of the buyer's purchase orders and the lines are filled in for what's been delivered. Or fill in your own.") + `
  ${!c.bankId ? `<div class="alert t-warn">${S.org.name} hasn't approved your bank details yet. You can prepare invoices now and send them once they approve.</div>` : ""}
  <div class="card"><div class="ch"><div><h3>Open purchase orders from ${S.org.name}</h3><p>Pick one to bill what's been delivered.</p></div></div><div class="cb">${pos.length ? `<div class="po-grid">${pos.map((p) => { const ready = Math.max(0, p.received - p.qtyBilled); return `<button class="po ${f.po === p.n ? "sel" : ""}" data-a="pickpo" data-po="${p.n}"><div style="display:flex;justify-content:space-between;gap:6px"><b>${p.n}</b><span class="tab">${fmt(p.amount)}</span></div><div class="small muted">Raised ${dFmt(p.raised)} · ${p.qty} × ${fmt(p.unit)}</div><div class="small">${p.received === 0 ? `<span class="warn">Nothing delivered yet</span>` : `${p.received} delivered · ${p.qtyBilled} billed · <b>${ready} ready to bill</b>`}</div></button>`; }).join("")}</div>` : `<div class="muted">Everything ordered has been billed.</div>`}</div></div>` + editorHTML(f);
}
function vSInvoice() {
  const s = sme(); const inv = S.invoices.find((i) => i.id === U.p.id && i.accountId === s.account.id);
  if (!inv) return empty("Invoice not found");
  const c = connOf(inv); const bank = bankOf(c); const editable = ["draft", "needs_changes"].includes(inv.status);
  const checks = editable ? checksFor(s, inv) : [];
  const credits = S.invoices.filter((i) => i.creditFor === inv.id && i.status !== "draft");
  return `<button class="back" data-a="go" data-page="s_invoices">← Invoices</button>` +
  ph(`${inv.kind === "credit_note" ? "Credit note" : "Invoice"} ${esc(inv.number)} ${badge(SUP_STATUS[inv.status])}`, `To ${S.org.name}`,
    `${inv.kind === "invoice" && ["approved", "scheduled", "paid"].includes(inv.status) ? `<button class="btn sec" data-a="credit" data-id="${inv.id}">Issue a credit note</button>` : ""}<button class="btn sec" data-a="pdf" data-id="${inv.id}">View PDF</button>`) + `
  ${inv.status === "needs_changes" ? `<div class="alert t-warn"><b>${S.org.name} asked for changes</b>${esc(inv.supplierNote)}</div>` : ""}
  ${inv.status === "rejected" ? `<div class="alert t-bad"><b>Rejected</b>${esc(inv.supplierNote)}</div>` : ""}
  ${inv.status === "scheduled" ? `<div class="alert t-good"><b>Payment scheduled for ${dFmt(inv.payOn + "T12:00")}</b>${fmt(invTotal(inv))} to your account ending ${bank?.last4}.</div>` : ""}
  ${inv.status === "paid" ? `<div class="alert t-good"><b>Paid on ${dFmt(inv.paidOn + "T12:00")}</b>Payment reference ${esc(inv.ref)}.</div>` : ""}
  <div class="two"><div class="stack">
    <div class="card"><div class="cb"><dl class="meta"><div><dt>Date</dt><dd>${dFmt(inv.date + "T12:00")}</dd></div>${inv.kind === "invoice" ? `<div><dt>Due</dt><dd>${dFmt(inv.due + "T12:00")}</dd></div>` : ""}<div><dt>PO</dt><dd>${inv.po ?? "None"}</dd></div><div><dt>Your vendor code</dt><dd>${c.vendorCode}</dd></div><div><dt>Paid into</dt><dd>${bank ? `${esc(bank.bank)} ••${bank.last4}` : "Not approved yet"}</dd></div></dl>
    ${linesTable(inv)}${inv.notes ? `<div class="sentence"><span class="muted">Notes: </span>${esc(inv.notes)}</div>` : ""}${credits.length ? `<div class="small muted">Credit notes against this invoice: ${credits.map((x) => `<button class="lnk" data-a="sinvoice" data-id="${x.id}">${esc(x.number)} (${fmt(invTotal(x))})</button>`).join(" ")}</div>` : ""}</div></div>
    <div class="card"><div class="ch"><h3>Messages with ${S.org.name}</h3></div><div class="cb">${thread(inv, "supplier", inv.status !== "draft", inv.status === "draft" ? "You can message the buyer once you've sent the invoice." : "No messages yet. Ask a question about this invoice here.")}</div></div>
  </div><div class="stack">
    ${editable ? `<div class="card" style="border-color:var(--sup)"><div class="ch"><div><h3>Before you send</h3><p>We check the invoice against the buyer's records so it doesn't get held up.</p></div></div><div class="cb">
      <ul class="rl">${checks.map(([l, m]) => `<li><span class="ic ${l === "ok" ? "ok" : l === "w" ? "w" : "x"}">${l === "ok" ? "✓" : l === "w" ? "!" : "✕"}</span><span class="small">${esc(m)}</span></li>`).join("")}</ul>
      <button class="btn p full" data-a="send" data-id="${inv.id}" ${checks.some((c) => c[0] === "x") ? "disabled" : ""}>${inv.revision ? "Send again" : "Send to buyer"}</button>
      <div class="grid2"><button class="btn sec sm" data-a="editinv" data-id="${inv.id}">Edit</button><button class="btn ghost sm" data-a="cancelinv" data-id="${inv.id}">${inv.revision ? "Cancel invoice" : "Delete draft"}</button></div></div></div>` : ""}
    <div class="card"><div class="ch"><h3>Where it is</h3></div><div class="cb">${timeline(inv, SUP_STATUS)}</div></div>
  </div></div>`;
}
function vSBank() {
  const s = sme(); const conns = connsFor(s); const mine = S.supplierBanks.filter((b) => b.accountId === s.account.id);
  return ph("Bank details", "Where your buyers pay you. To protect you from payment fraud, each buyer confirms any new account with you before using it.") + `
  ${U.p.welcome ? `<div class="alert t-good"><b>Welcome to the supplier portal</b>Add the account you want to be paid into. ${S.org.name} will contact you to confirm it, then you can start sending invoices.</div>` : ""}
  <div class="two"><div class="stack">
    <div class="card"><div class="ch"><h3>Each buyer pays you into</h3></div><div class="cb">${conns.map((c) => { const b = bankOf(c); const p = S.bankChanges.find((x) => x.connId === c.id && x.status === "pending"); const pb = p && S.supplierBanks.find((x) => x.id === p.newBankId);
      return `<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;border:1px solid var(--border);border-radius:9px;padding:10px 12px"><b>${S.org.name}</b><div style="text-align:right">${b ? `${esc(b.bank)} ••${b.last4} ${badge(["Approved", "good"])}` : badge(["No approved account", "warn"])}${pb ? `<div class="small warn">Change to ${esc(pb.bank)} ••${pb.last4} requested ${dFmt(p.at)}; waiting for the buyer</div>` : ""}</div></div>`; }).join("")}</div></div>
    <div class="card"><div class="ch"><h3>Accounts you've added</h3></div><div class="cb small">${mine.length ? mine.map((b) => `<div style="display:flex;justify-content:space-between;gap:8px"><span>${esc(b.bank)} ••${b.last4} <span class="muted">· routing ${b.routing}</span></span><span class="muted">Added ${dFmt(b.at)}</span></div>`).join("") : `<span class="muted">None yet.</span>`}</div></div>
    <div class="alert t-info"><b>We'll never ask by email</b>Your buyers will never ask you to change bank details by email. If someone does, contact the buyer on a number you already know.</div>
  </div>
  <div class="card"><div class="ch"><div><h3>Add or change bank account</h3><p>US bank accounts (ACH)</p></div></div><div class="cb">
    <label class="f">Account holder name<input class="i" id="sb-holder" value="${esc(s.account.legalName)}"></label>
    <label class="f">Bank name<input class="i" id="sb-bank" placeholder="Rainier Savings Bank"></label>
    <label class="f">Routing number <span class="h">9 digits, e.g. 125000024</span><input class="i" id="sb-routing" inputmode="numeric"></label>
    <label class="f">Account number<input class="i" id="sb-acct" inputmode="numeric" autocomplete="off"></label>
    <label class="f">Confirm account number<input class="i" id="sb-confirm" inputmode="numeric" autocomplete="off"></label>
    <label class="f">Your password <span class="h">To confirm it's really you (demo: demo1234)</span><input class="i" id="sb-pw" type="password"></label>
    <button class="btn p full" data-a="sbank">Send for approval</button><div class="small muted">Until the buyer approves, they keep paying you into the account they already have.</div>
  </div></div></div>`;
}
function vSCompany() {
  const a = sme().account;
  return ph("Company details", "Printed on every invoice you send. Your buyers see these details too.") + `<div class="card" style="max-width:640px"><div class="cb"><div class="form">
    <label class="f">Legal name<input class="i" id="co-legal" value="${esc(a.legalName)}"></label><label class="f">EIN<input class="i" id="co-ein" value="${esc(a.ein ?? "")}" placeholder="12-3456789"></label>
    <label class="f">Billing email<input class="i" id="co-email" value="${esc(a.email)}"></label><label class="f">Phone<input class="i" id="co-phone" value="${esc(a.phone ?? "")}"></label></div>
    <label class="f">Address<input class="i" id="co-addr" value="${esc(a.address ?? "")}"></label><div><button class="btn p" data-a="company">Save details</button></div></div></div>`;
}
function pdfModal(inv) {
  const c = connOf(inv); const a = S.supplierAccounts.find((x) => x.id === inv.accountId); const b = bankOf(c);
  return `<div class="ch"><h3>${inv.kind === "credit_note" ? "Credit note" : "Invoice"} PDF</h3><button class="btn ghost sm" data-a="closemodal">Close</button></div><div class="cb" style="background:#fff;color:#111827;font-size:12px">
    <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap"><div><div style="font-size:16px;font-weight:700">${esc(a.legalName)}</div><div style="color:#6b7280">${esc(a.address ?? "")}<br>${esc(a.email)} · ${esc(a.phone ?? "")}<br>EIN ${esc(a.ein ?? "-")}</div></div>
    <div style="text-align:right"><div style="font-size:18px;font-weight:700;color:#0d6b70">${inv.kind === "credit_note" ? "CREDIT NOTE" : "INVOICE"}</div><div>No. <b>${esc(inv.number)}</b><br>Date ${inv.date}${inv.kind === "invoice" ? `<br>Due ${inv.due}` : ""}${inv.po ? `<br>PO ${inv.po}` : ""}</div></div></div>
    <div><div style="color:#6b7280;font-size:10px;font-weight:700">BILL TO</div><b>${S.org.name}</b><div style="color:#6b7280">${S.org.billing}<br>Your vendor code for us: ${c.vendorCode}</div></div>
    <table style="font-size:12px"><thead><tr><th style="background:#eef4f4;color:#111827">Description</th><th class="r" style="background:#eef4f4;color:#111827">Qty</th><th class="r" style="background:#eef4f4;color:#111827">Unit price</th><th class="r" style="background:#eef4f4;color:#111827">Amount</th></tr></thead><tbody>${inv.lines.map((l) => `<tr><td style="border-color:#e5e7eb">${esc(l.d)}</td><td class="r" style="border-color:#e5e7eb">${l.q}</td><td class="r" style="border-color:#e5e7eb">${fmt(l.u)}</td><td class="r" style="border-color:#e5e7eb">${fmt(l.q * l.u)}</td></tr>`).join("")}</tbody></table>
    <div style="text-align:right">Subtotal ${fmt(invSubtotal(inv))}<br>Tax ${fmt(invTotal(inv) - invSubtotal(inv))}<br><b style="font-size:14px">${inv.kind === "credit_note" ? "Total credit" : "Total due"} ${fmt(invTotal(inv))}</b></div>
    ${inv.kind === "invoice" && b ? `<div><div style="color:#6b7280;font-size:10px;font-weight:700">PAYMENT</div>Pay by bank transfer to ${esc(b.bank)}, account ending ${b.last4}, as approved in your supplier records.<br><span style="color:#6b7280">We will never ask you to change our bank details by email or phone.</span></div>` : ""}
    <div style="color:#6b7280;font-size:10px">Sent through the Control Room supplier portal${inv.status === "draft" ? " · DRAFT, not yet sent" : ""}</div></div>`;
}

/* ============================================================ sign-in and invitation */
function vStaffLogin() {
  const people = S.users.filter((u) => u.active);
  return `<div class="auth"><div class="box"><div style="display:flex;align-items:center;gap:10px"><div class="logo">${LOGO}</div><div><div style="font-size:18px;font-weight:600">Control Room</div><div class="small muted">Assurance for AI agents that touch money</div></div></div>
    <div class="card"><div class="cb"><label class="f">Work email<input class="i" id="lg-email" placeholder="controller@harborpine.example"></label><label class="f">Password<input class="i" id="lg-pw" type="password" placeholder="demo1234"></label><button class="btn p full" data-a="login">Sign in</button>
    <div style="border-top:1px solid var(--border);padding-top:12px;display:grid;gap:6px"><div class="small muted" style="font-weight:600;letter-spacing:.05em">DEMO ACCOUNTS</div>${people.map((u) => `<button class="persona" data-a="as" data-kind="staff" data-id="${u.id}"><b>${esc(u.name)}</b><span class="small muted">${ROLE_LABEL[u.role]}</span></button>`).join("")}</div></div></div>
    <div class="small muted" style="text-align:center">Supplier? <button class="lnk" data-a="go" data-page="s_login">Supplier portal sign-in</button></div></div></div>`;
}
function vSupLogin() {
  return `<div class="auth"><div class="box"><div style="display:flex;align-items:center;gap:10px"><div class="logo sup">${LOGO}</div><div><div style="font-size:18px;font-weight:600">Supplier portal</div><div class="small muted">Send invoices and see when you'll be paid</div></div></div>
    <div class="card"><div class="cb"><label class="f">Email<input class="i" id="lg-email" placeholder="priya@supplier.example"></label><label class="f">Password<input class="i" id="lg-pw" type="password" placeholder="demo1234"></label><button class="btn p full" style="background:var(--sup);color:#fff" data-a="slogin">Sign in</button>
    <div style="border-top:1px solid var(--border);padding-top:12px;display:grid;gap:6px"><div class="small muted" style="font-weight:600;letter-spacing:.05em">DEMO SUPPLIERS</div>${S.supplierUsers.map((u) => `<button class="persona" data-a="as" data-kind="supplier" data-id="${u.id}"><b>${esc(u.name)}</b><span class="small muted">${esc(S.supplierAccounts.find((a) => a.id === u.accountId).legalName)}</span></button>`).join("")}</div></div></div>
    <div class="small muted" style="text-align:center">New here? Suppliers join through an invitation from the company they bill. <button class="lnk" data-a="go" data-page="login">Staff sign-in</button></div></div></div>`;
}
function vInvite() {
  const c = S.connections.find((x) => x.token === U.p.token && x.status === "invited");
  if (!c) return `<div class="auth"><div class="box"><div class="alert t-bad"><b>Can't open this invitation</b>This link isn't valid, or it has already been used. Ask the company that invited you to send a new one.</div></div></div>`;
  const v = vendorByCode(c.vendorCode);
  return `<div class="auth"><div class="box wide"><div style="display:flex;align-items:center;gap:10px"><div class="logo sup">${LOGO}</div><div style="font-size:18px;font-weight:600">Supplier portal</div></div>
  <div class="card"><div class="cb"><h1 style="font-size:20px">${S.org.name} invited you to send invoices online</h1><p class="muted">They know you as <b style="color:var(--ink)">${esc(v.name)}</b>. Through the portal you can turn their purchase orders into invoices, see exactly where each invoice is, and know when you'll be paid. Payment terms: ${c.terms} days. It's free for suppliers.</p>
  <label class="f">Your email <span class="h">The invitation was sent here; it becomes your sign-in.</span><input class="i" value="${esc(c.inviteEmail)}" disabled></label>
  <div class="grid2"><label class="f">Your name<input class="i" id="ac-name" value="Nia Brooks"></label><label class="f">Phone (optional)<input class="i" id="ac-phone" value="(503) 555-0199"></label></div>
  <label class="f">Company legal name<input class="i" id="ac-legal" value="${esc(v.name)} Inc."></label><label class="f">EIN (optional) <span class="h">US employer identification number</span><input class="i" id="ac-ein" value="91-4455120"></label>
  <label class="f">Choose a password <span class="h">At least 8 characters</span><input class="i" id="ac-pw" type="password" value="demo1234"></label>
  <button class="btn p full" style="background:var(--sup);color:#fff" data-a="accept" data-token="${esc(c.token)}">Create account and accept</button>
  <div class="small muted">Next you'll add the bank account you want to be paid into. ${S.org.name} checks it with you before it's used.</div></div></div></div></div>`;
}

/* ============================================================ app: render, persona bar, actions */
const STAFF_PAGES = { scorecard: vScorecard, review: vReviewQueue, actions: vActions, action: vAction, invoices: vInvoices, invoice: vInvoice, suppliers: vSuppliers, replay: vReplay, comparison: vComparison, rules: vRules, autonomy: vAutonomy, audit: vAudit, settings: vSettings, api: vApi };
const SUP_PAGES = { s_home: vSHome, s_invoices: vSInvoices, s_new: vSNew, s_invoice: vSInvoice, s_edit: vSNew, s_bank: vSBank, s_company: vSCompany };
function personaBar() {
  const cur = U.session ? `${U.session.kind}:${U.session.id}` : "";
  return `<div class="pbar"><b>Control Room prototype</b><span>Sample data · runs in your browser</span><span class="sp"></span>
    <label>Viewing as <select data-a="persona">${!U.session ? `<option value="" selected>Signed out</option>` : ""}<optgroup label="Buyer: Harbor & Pine">${S.users.filter((u) => u.active).map((u) => `<option value="staff:${u.id}" ${cur === "staff:" + u.id ? "selected" : ""}>${esc(u.name)} · ${ROLE_LABEL[u.role]}</option>`).join("")}</optgroup><optgroup label="Suppliers">${S.supplierUsers.map((u) => `<option value="supplier:${u.id}" ${cur === "supplier:" + u.id ? "selected" : ""}>${esc(u.name)} · ${esc(S.supplierAccounts.find((a) => a.id === u.accountId).legalName)}</option>`).join("")}</optgroup></select></label>
    <button data-a="reset">Reset demo</button></div>`;
}
function render() {
  let html;
  if (!U.session) html = U.page === "s_login" ? vSupLogin() : U.page === "invite" ? vInvite() : vStaffLogin();
  else if (U.session.kind === "staff") html = staffShell((STAFF_PAGES[U.page] ?? vScorecard)());
  else html = supShell((SUP_PAGES[U.page] ?? vSHome)());
  document.getElementById("app").innerHTML = personaBar() + html + (U.modal ? `<div class="overlay" data-a="closemodal"><div class="modal" data-stop="1">${U.modal}</div></div>` : "");
}
function toast(m) { const t = document.getElementById("toast"); t.textContent = m; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 3200); }
function go(page, p = {}) { U.page = page; U.p = p; U.flash = null; U.issued = null; if (page !== "s_new" && page !== "s_edit") U.ed = null; window.scrollTo(0, 0); }
const val = (id) => document.getElementById(id)?.value ?? "";
function signIn(kind, id) { U.session = { kind, id }; U.ed = null; go(kind === "staff" ? (userById(id).role === "reviewer" ? "review" : "scorecard") : "s_home"); }

const ACTIONS = {
  go: (d) => go(d.page), signout: () => { const k = U.session?.kind; U.session = null; go(k === "supplier" ? "s_login" : "login"); },
  as: (d) => signIn(d.kind, d.id),
  login: () => { const u = S.users.find((x) => x.email === val("lg-email").trim().toLowerCase()); if (!u || val("lg-pw") !== "demo1234") throw new Error("Email or password is incorrect"); signIn("staff", u.id); },
  slogin: () => { const u = S.supplierUsers.find((x) => x.email === val("lg-email").trim().toLowerCase()); if (!u || val("lg-pw") !== u.password) throw new Error("Email or password is incorrect"); signIn("supplier", u.id); },
  reset: () => { seed(); U.session = { kind: "staff", id: "u_dana" }; U.verify = null; U.tamper = null; U.running = null; go("scorecard"); toast("Demo reset to the starting data"); },
  drill: (d) => go("actions", { week: d.week, flag: d.flag === "all" ? undefined : d.flag }),
  filter: () => go("actions", { q: val("f-q") || undefined, vendor: val("f-vendor") || undefined, status: val("f-status") || undefined, flag: val("f-flag") || undefined, week: U.p.week }),
  page: (d) => { U.p = { ...U.p, pageNo: Number(d.n) }; window.scrollTo(0, 0); },
  action: (d) => go("action", { id: d.id, from: U.page === "review" ? "review" : "actions" }),
  review: (d) => {
    const u = me(); reviewAction(u, d.id, { decision: d.d, reason: val("rv-reason"), rightToEscalate: document.getElementById("rv-right")?.checked ?? true }); flushAudit();
    toast(`Decision recorded: ${d.d === "approve" ? "approved" : "rejected"}`);
    if (d.next) go("action", { id: d.next, from: "review" }); else go("review");
  },
  invtab: (d) => go("invoices", { tab: d.tab }), invoice: (d) => go("invoice", { id: d.id }),
  decide: (d) => { decideInvoice(me(), d.id, { decision: d.d, reason: val("dc-reason"), message: val("dc-msg").trim() || undefined }); flushAudit(); toast("Decision recorded. The supplier can see the new status."); },
  schedule: (d) => { schedulePayment(me(), d.id, { from: val("pay-from"), payOn: val("pay-on") }); flushAudit(); toast("Payment scheduled. The supplier can see the date."); },
  paid: (d) => { markPaid(me(), d.id, { paidOn: val("paid-on"), ref: val("paid-ref") }); flushAudit(); toast("Recorded as paid"); },
  msg: (d) => { const body = val("msg-" + d.id).trim(); if (!body) return; const inv = S.invoices.find((i) => i.id === d.id); const who = d.from === "buyer" ? me().name : sme().user.name; inv.msgs.push({ from: d.from, by: who, body, at: new Date() }); audit("invoice.message", "invoice", inv.id, { type: d.from === "buyer" ? "user" : "supplier", id: "x", name: who }, { invoice: inv.number, from: d.from, body }); flushAudit(); toast("Message sent"); },
  bankdecide: (d) => { decideBankChange(me(), d.id, { decision: d.d, verification: val("ver-" + d.id), note: val("note-" + d.id) }); flushAudit(); toast(d.d === "approve" ? "Bank details approved. The next payments go to a person as an extra check." : "Change rejected"); },
  toggle: (d) => { U.p = { ...U.p, [d.k]: !U.p[d.k] }; },
  invite: () => {
    const code = val("inv-vendor"); const email = val("inv-email").trim();
    if (!code) throw new Error("Choose a vendor"); if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter the supplier's email address");
    const token = Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8);
    S.connections.push({ id: uid("conn_"), vendorCode: code, accountId: null, status: "invited", inviteEmail: email.toLowerCase(), invitedAt: new Date(), acceptedAt: null, bankId: null, terms: Number(val("inv-terms")), token });
    audit("supplier.invited", "vendor", code, { type: "user", id: me().id, name: me().name }, { vendor: vendorByCode(code).name, email }); flushAudit();
    U.p = { ...U.p, invite: false }; U.issued = { invite: { name: vendorByCode(code).name, email, token } };
  },
  openinvite: (d) => { U.session = null; go("invite", { token: d.token }); },
  suspend: (d) => { const c = S.connections.find((x) => x.id === d.id); c.status = c.status === "active" ? "suspended" : "active"; audit("vendor.changed", "vendor", c.vendorCode, { type: "user", id: me().id, name: me().name }, { vendor: vendorByCode(c.vendorCode).name, change: c.status === "active" ? "portal access restored" : "portal access suspended" }); flushAudit(); toast(c.status === "active" ? "Access restored" : "Portal access suspended"); },
  replay: (d) => {
    const ds = S.datasets.find((x) => x.id === d.ds); const ids = [...document.querySelectorAll(`.rp-agent[data-ds="${d.ds}"]:checked`)].map((x) => x.value);
    if (!ids.length) throw new Error("Choose at least one agent"); if (ids.length > 3) throw new Error("Compare up to 3 agents at once");
    U.running = { n: ds.cases.length, agents: ids.length, pct: 0 };
    const tick = setInterval(() => {
      U.running.pct = Math.min(100, U.running.pct + 9 + Math.floor(Math.random() * 8));
      if (U.running.pct >= 100) {
        clearInterval(tick);
        const reports = runReplay(ds, ids); const c = { id: uid("cmp_"), dsName: ds.name, by: me()?.name ?? "Dana Whitfield", at: new Date(), reports };
        S.comparisons.unshift(c); audit("replay.completed", "replay", c.id, { type: "user", id: me()?.id ?? "u_dana", name: c.by }, { set: ds.name, invoices: ds.cases.length, results: reports.map((r) => ({ agent: r.name, accuracy: Math.round(r.accuracy * 1000) / 10, misApproved: r.misApproved })) }); flushAudit();
        U.running = null; if (U.session?.kind === "staff" && (U.page === "replay")) go("comparison", { id: c.id }); toast("Replay finished");
      }
      render();
    }, 220);
  },
  comparison: (d) => go("comparison", { id: d.id }),
  editrule: (d) => { U.p = { ...U.p, edit: d.id || null }; },
  saverule: (d) => {
    const r = S.rules.find((x) => x.id === d.id); const p = JSON.parse(JSON.stringify(r.params)); const num = (id, lo, hi) => { const n = Number(val(id)); if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`Enter a number from ${lo} to ${hi}`); return n; };
    if (r.type === "three_way_match") p.tolPct = num("re-tol", 0, 50);
    if (r.type === "duplicate_invoice") p.windowDays = num("re-win", 0, 365);
    if (r.type === "bank_details_change") p.lookbackDays = num("re-look", 1, 730);
    if (r.type === "custom") p.value = p.field === "amount" ? Math.round(num("re-val", 0, 1e9) * 100) : val("re-val");
    if (r.type === "approval_limits") { let last = 0; p.bands = p.bands.map((b, i) => { const up = b[0] === null ? null : Math.round(num(`re-up-${i}`, 1, 1e9) * 100); if (up !== null && up <= last) throw new Error("Each band must start above the one before"); if (up !== null) last = up; return [up, val(`re-role-${i}`) || null]; }); }
    saveRule(me(), r, p, val("re-reason"), { enabled: val("re-enabled") === "1" }); flushAudit(); U.p = { ...U.p, edit: null }; toast(`${r.name} saved as version ${r.version}. It applies to the next invoice.`);
  },
  addrule: () => {
    const u = me(); if (!can(u.role, "rules:edit")) throw new Error("Your role can't add rules");
    const field = val("nr-field"); const raw = val("nr-value").trim(); if (!raw) throw new Error("Enter a value");
    const value = field === "amount" || field === "confidence" ? (field === "amount" ? parseMoney(raw) : Number(raw)) : raw; if (value === null || Number.isNaN(value)) throw new Error("Enter a number");
    const reason = val("nr-reason"); if (reason.trim().length < 5) throw new Error("Say briefly why you're adding this rule");
    const r = { id: uid("rule_"), type: "custom", name: val("nr-name").trim() || "Custom rule", severity: val("nr-sev"), params: { field, op: val("nr-op"), value, severity: val("nr-sev") }, version: 1, enabled: true, versions: [] };
    r.versions.push({ v: 1, params: JSON.parse(JSON.stringify(r.params)), reason, by: u.name, at: new Date(), enabled: true, severity: r.severity }); S.rules.push(r);
    audit("rule.created", "rule", r.id, { type: "user", id: u.id, name: u.name }, { rule: r.name, version: 1, sentence: ruleSentence(r), reason }); flushAudit(); U.p = { ...U.p, newrule: false }; toast("Rule added. It applies to the next invoice.");
  },
  tryrule: () => {
    const amt = parseMoney(val("try-amount")); if (!amt) throw new Error("Enter an amount like 7,500.00");
    const v = vendorByCode(val("try-vendor")); const conf = Number(val("try-conf")) / 100;
    const ctx = { subject: { id: "TRY", number: "TRY-1", vendorCode: v.code, vendorName: v.name, amount: amt, po: null, date: iso(NOW), bankFp: v.bankFp, at: NOW }, vendor: v, po: { n: "the PO", amount: amt, qty: 1 }, grnQty: 1, prior: [], confidence: conf };
    const results = activeRules().map((r) => evalRule(r, r.type === "three_way_match" ? ctx : ctx));
    const g = decideGate({ level: S.workflow.level, limit: S.workflow.limit, threshold: S.workflow.threshold, decision: val("try-dec"), confidence: conf, amount: amt, results });
    U.p = { ...U.p, tryResult: `<div class="card" style="border-color:var(--brand)"><div class="cb"><div>Outcome: ${statusBadge(g.status)}${g.requiredRole ? ` · needs ${APPROVER[g.requiredRole].toLowerCase()}` : ""}</div><ul style="margin:0;padding-left:18px">${g.reasons.map((x) => `<li class="small">${esc(x)}</li>`).join("")}</ul><ul class="rl">${results.map((r) => `<li>${ruleIcon(r.result)}<div class="small"><b>${esc(r.name)}</b> v${r.version}: ${esc(r.explanation)}</div></li>`).join("")}</ul><div class="small muted">Assumes the invoice matches its PO and goods were received.</div></div></div>` };
  },
  level: () => { changeLevel(me(), Number(val("lv-to")), val("lv-reason")); flushAudit(); toast(`Autonomy is now Level ${S.workflow.level}`); },
  wfsave: () => {
    const limit = parseMoney(val("wf-limit")); const thr = Number(val("wf-thr")); const win = Number(val("wf-win")); const tgt = Number(val("wf-tgt"));
    if (!limit || !(thr >= 50 && thr <= 99) || !(win >= 10 && win <= 500) || !(tgt >= 50 && tgt <= 100)) throw new Error("Check the values: threshold 50–99%, window 10–500, target 50–100%");
    Object.assign(S.workflow, { limit, threshold: thr / 100, window: win, target: tgt / 100 });
    audit("workflow.settings_changed", "workflow", "wf_ap_main", { type: "user", id: me().id, name: me().name }, { autoApproveLimit: limit, confidenceThreshold: thr / 100, promotionWindow: win, promotionTarget: tgt / 100 }); flushAudit(); toast("Settings saved");
  },
  verify: () => { U.verify = verifyChain(); },
  tamper: () => { const cand = S.audit.filter((r) => r.type === "action.evaluated"); const r = cand[Math.floor(cand.length / 2)]; U.tamper = { seq: r.seq, from: r.payload.amount, to: r.payload.amount * 10, payload: JSON.parse(JSON.stringify(r.payload)) }; r.payload = { ...r.payload, amount: r.payload.amount * 10 }; U.verify = null; },
  untamper: () => { const r = S.audit[U.tamper.seq - 1]; r.payload = U.tamper.payload; U.tamper = null; U.verify = null; toast("Edit undone"); },
  aufilter: () => go("audit", { type: val("au-type") || undefined }),
  evidence: (d) => { U.modal = evidenceModal(d.scope, d.id); audit("evidence.exported", "evidence", d.id ?? d.scope, { type: "user", id: me().id, name: me().name }, { scope: d.scope }); flushAudit(); },
  closemodal: () => { U.modal = null; },
  settab: (d) => go("settings", { tab: d.tab }),
  addagent: () => {
    const name = val("ag-name").trim(); if (name.length < 2) throw new Error("Give the agent a name");
    const kind = val("ag-kind"); const key = "cr_live_" + sha256(name + Date.now()).slice(0, 32);
    const a = { id: uid("agt_"), name, builder: val("ag-builder"), kind, url: val("ag-url"), profile: kind === "mock" ? "cautious" : null, errorRate: 0.07, seed: name, version: "1.0.0", cost: 3, keyPrefix: key.slice(0, 12), active: true, created: new Date() };
    if (kind === "webhook") { a.kind = "mock"; a.profile = "cautious"; a.webhook = true; }
    S.agents.push(a); audit("agent.created", "agent", a.id, { type: "user", id: me().id, name: me().name }, { agent: name, version: a.version }); flushAudit();
    U.p = { ...U.p, newagent: false }; U.issued = { key: { name, key, secret: "whsec_" + sha256(key).slice(0, 24) } };
  },
  rotate: (d) => { const a = agentById(d.id); const key = "cr_live_" + sha256(a.id + Date.now()).slice(0, 32); a.keyPrefix = key.slice(0, 12); audit("agent.changed", "agent", a.id, { type: "user", id: me().id, name: me().name }, { agent: a.name, keyRotated: true }); flushAudit(); U.issued = { key: { name: a.name, key } }; },
  primary: (d) => { S.workflow.primaryAgent = d.id; audit("workflow.settings_changed", "workflow", "wf_ap_main", { type: "user", id: me().id, name: me().name }, { primaryAgent: agentById(d.id).name }); flushAudit(); toast(`${agentById(d.id).name} now checks supplier-portal invoices`); },
  vsearch: () => { U.p = { ...U.p, vq: val("vq") }; },
  vblock: (d) => { const v = vendorByCode(d.code); v.blocked = !v.blocked; v.blockedReason = v.blocked ? "Blocked by admin pending review" : null; audit("vendor.changed", "vendor", v.code, { type: "user", id: me().id, name: me().name }, { vendor: v.name, change: v.blocked ? "blocked" : "unblocked" }); flushAudit(); toast(`${v.name} ${v.blocked ? "blocked" : "unblocked"}`); },
  vbank: (d) => { const v = vendorByCode(d.code); v.bankChangedAt = new Date(); v.bankFp = fingerprint(v.code + ":" + Date.now()); audit("vendor.changed", "vendor", v.code, { type: "user", id: me().id, name: me().name }, { vendor: v.name, change: "bank details changed" }); flushAudit(); toast(`Recorded. ${v.name}'s next payments go to a person.`); },
  addbank: () => { addBankAccount(me(), { nickname: val("bk-nick"), holder: val("bk-holder"), bank: val("bk-bank"), routing: val("bk-routing"), account: val("bk-acct"), isDefault: document.getElementById("bk-def").checked }); flushAudit(); U.p = { ...U.p, newbank: false }; toast("Bank account added"); },
  bkdefault: (d) => { S.bankAccounts.forEach((b) => (b.isDefault = b.id === d.id)); audit("bank_account.changed", "bank_account", d.id, { type: "user", id: me().id, name: me().name }, { change: "made default" }); flushAudit(); },
  bkarchive: (d) => { const b = S.bankAccounts.find((x) => x.id === d.id); if (b.state === "active" && S.invoices.some((i) => i.payFrom === b.id && i.status === "scheduled")) throw new Error("Scheduled payments will be paid from this account. Move them first."); b.state = b.state === "active" ? "archived" : "active"; audit("bank_account.changed", "bank_account", b.id, { type: "user", id: me().id, name: me().name }, { change: b.state }); flushAudit(); },
  adduser: () => { const name = val("us-name").trim(), email = val("us-email").trim().toLowerCase(); if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email)) throw new Error("Enter a name and email"); if (S.users.some((u) => u.email === email)) throw new Error("Someone already uses that email"); const u = { id: uid("u_"), name, email, role: val("us-role"), active: true }; S.users.push(u); audit("user.changed", "user", u.id, { type: "user", id: me().id, name: me().name }, { user: name, role: u.role, added: true }); flushAudit(); U.p = { ...U.p, newuser: false }; toast(`${name} added. They appear in the "Viewing as" list.`); },
  useractive: (d) => { const u = userById(d.id); u.active = !u.active; audit("user.changed", "user", u.id, { type: "user", id: me().id, name: me().name }, { user: u.name, active: u.active }); flushAudit(); },
  /* supplier */
  sinvtab: (d) => go("s_invoices", { tab: d.tab }), sinvoice: (d) => go("s_invoice", { id: d.id }),
  pickpo: (d) => { const f = U.ed; Object.assign(f, draftFromPO(f.connId, d.po)); if (!f.number) f.number = `BP-${2000 + myInvoices().length}`; },
  addline: () => { U.ed.lines.push({ d: "", q: "1", u: "", tax: "0" }); }, delline: (d) => { U.ed.lines.splice(Number(d.i), 1); },
  saveinvoice: () => {
    const f = U.ed; const lines = f.lines.map((l) => { const u = parseMoney(l.u || ""); if (u === null) throw new Error(`"${l.u}" isn't a valid price`); const q = parseInt(l.q, 10); if (!(q >= 1)) throw new Error("Quantities must be at least 1"); return { d: l.d.trim(), q, u, tax: Math.round(parseFloat(l.tax || "0") * 100) || 0 }; });
    if (f.mode === "edit") {
      const inv = S.invoices.find((i) => i.id === f.id); if (!f.lock && f.number !== inv.number && S.invoices.some((i) => i.connId === inv.connId && i.number === f.number)) throw new Error(`You've already used number ${f.number}`);
      Object.assign(inv, { number: f.number, po: f.po || null, date: f.date, notes: f.notes, lines }); go("s_invoice", { id: inv.id }); toast("Saved");
    } else { const inv = createDraft(sme(), { connId: f.connId, kind: f.kind, creditFor: f.creditFor, number: f.number.trim(), po: f.po.trim() || null, date: f.date, notes: f.notes, lines }); go("s_invoice", { id: inv.id }); toast("Draft saved. Check it and send."); }
  },
  send: (d) => { const inv = submitInvoice(sme(), d.id); flushAudit(); toast(inv.status === "approved" ? "Sent. It passed every check and was approved automatically." : inv.kind === "credit_note" ? "Credit note sent to the buyer" : "Sent. It's with the buyer for approval."); },
  editinv: (d) => { const inv = S.invoices.find((i) => i.id === d.id); U.page = "s_edit"; U.p = { id: inv.id }; U.ed = { mode: "edit", id: inv.id, kind: inv.kind, creditFor: inv.creditFor, connId: inv.connId, number: inv.number, lock: inv.revision > 0, po: inv.po ?? "", date: inv.date, notes: inv.notes, lines: inv.lines.map((l) => ({ d: l.d, q: String(l.q), u: (l.u / 100).toFixed(2), tax: String((l.tax || 0) / 100) })) }; },
  cancelinv: (d) => { const inv = S.invoices.find((i) => i.id === d.id); if (inv.revision === 0) { S.invoices = S.invoices.filter((i) => i !== inv); go("s_invoices"); toast("Draft deleted"); } else { inv.status = "cancelled"; event(inv, "cancelled", "Cancelled by the supplier", sme().user.name); go("s_invoices"); toast("Invoice cancelled"); } },
  credit: (d) => { const orig = S.invoices.find((i) => i.id === d.id); go("s_new"); U.ed = { mode: "new", kind: "credit_note", creditFor: orig.id, connId: orig.connId, number: "", po: orig.po ?? "", date: iso(NOW), notes: `Credit for invoice ${orig.number}`, lines: orig.lines.map((l) => ({ d: l.d, q: String(l.q), u: (l.u / 100).toFixed(2), tax: String((l.tax || 0) / 100) })) }; },
  pdf: (d) => { U.modal = pdfModal(S.invoices.find((i) => i.id === d.id)); },
  sbank: () => { const req = requestBankChange(sme(), { holder: val("sb-holder"), bank: val("sb-bank"), routing: val("sb-routing"), account: val("sb-acct"), confirm: val("sb-confirm"), password: val("sb-pw") }); flushAudit(); toast(req.length ? `Sent to ${S.org.name} for approval. They'll contact you to confirm.` : "Your buyer already pays into this account."); },
  company: () => { const a = sme().account; const ein = val("co-ein").trim(); if (ein && !/^\d{2}-?\d{7}$/.test(ein)) throw new Error("Enter a US EIN like 12-3456789"); Object.assign(a, { legalName: val("co-legal").trim() || a.legalName, ein: ein.replace(/^(\d{2})-?(\d{7})$/, "$1-$2"), email: val("co-email"), phone: val("co-phone"), address: val("co-addr") }); toast("Saved"); },
  accept: (d) => {
    const c = S.connections.find((x) => x.token === d.token && x.status === "invited"); const name = val("ac-name").trim(), legal = val("ac-legal").trim(), pw = val("ac-pw");
    if (name.length < 2 || legal.length < 2) throw new Error("Enter your name and company legal name"); if (pw.length < 8) throw new Error("Use at least 8 characters for your password");
    const acct = { id: uid("sa_"), legalName: legal, ein: val("ac-ein"), email: c.inviteEmail, phone: val("ac-phone"), address: "" }; S.supplierAccounts.push(acct);
    const su = { id: uid("su_"), accountId: acct.id, name, email: c.inviteEmail, password: pw, role: "owner" }; S.supplierUsers.push(su);
    Object.assign(c, { status: "active", accountId: acct.id, acceptedAt: new Date(), token: null });
    audit("supplier.connected", "vendor", c.vendorCode, { type: "supplier", id: su.id, name }, { vendor: vendorByCode(c.vendorCode).name, supplierAccount: legal }); flushAudit();
    U.session = { kind: "supplier", id: su.id }; go("s_bank", { welcome: true });
  },
};

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-a]");
  if (!el || el.tagName === "SELECT" || (el.tagName === "INPUT" && el.type !== "radio")) return;
  if (el.classList.contains("overlay") && e.target.closest("[data-stop]")) return;
  const fn = ACTIONS[el.dataset.a]; if (!fn) return;
  try { fn(el.dataset); U.flash = null; } catch (err) { S.auditPending = []; toast(err.message); return; }
  render();
});
document.addEventListener("change", (e) => {
  const el = e.target;
  try {
    if (el.dataset.a === "persona" && el.value) { const [k, id] = el.value.split(":"); signIn(k, id); }
    else if (el.dataset.a === "week") U.p = { ...U.p, week: Number(el.value) };
    else if (el.dataset.a === "setrole") { const u = userById(el.dataset.id); u.role = el.value; audit("user.changed", "user", u.id, { type: "user", id: me().id, name: me().name }, { user: u.name, role: u.role }); flushAudit(); toast(`${u.name} is now ${ROLE_LABEL[u.role]}`); }
    else if (el.dataset.a === "erp") { S.workflow.connector = el.value; audit("workflow.settings_changed", "workflow", "wf_ap_main", { type: "user", id: me().id, name: me().name }, { connector: el.value }); flushAudit(); toast(`System of record: ${el.value}`); }
    else if (el.id === "csv-file" && el.files[0]) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = String(reader.result).trim().split(/\r?\n/); const head = rows.shift().split(",").map((h) => h.trim().toLowerCase());
          const col = (n) => head.indexOf(n); if (col("invoice_id") < 0 || col("amount") < 0 || col("correct_decision") < 0) throw new Error("The CSV needs invoice_id, vendor, amount and correct_decision columns");
          let skipped = 0;
          const cases = rows.map((line) => line.split(",")).map((c) => { const v = vendorByName(c[col("vendor")]) ?? S.vendors[0]; const amt = parseMoney(c[col("amount")]); const dec = (c[col("correct_decision")] || "").trim(); if (amt === null || !["approve", "reject", "escalate"].includes(dec)) { skipped++; return null; } return { id: c[col("invoice_id")], number: c[col("invoice_id")], vendorCode: v.code, vendorName: v.name, amount: amt, po: c[col("po_number")] || null, grn: null, date: c[col("invoice_date")] || iso(NOW), at: NOW, bankFp: v.bankFp, issue: dec === "approve" ? null : dec === "reject" ? "duplicate" : "over_po", correct: dec }; }).filter(Boolean);
          S.datasets.unshift({ id: uid("ds_"), name: el.files[0].name, uploadedBy: me().name, at: new Date(), cases });
          toast(`Imported ${cases.length} invoices${skipped ? `, skipped ${skipped} rows` : ""}`);
        } catch (err) { toast(err.message); }
        render();
      };
      reader.readAsText(el.files[0]); return;
    } else return;
  } catch (err) { toast(err.message); return; }
  render();
});
document.addEventListener("input", (e) => {
  const el = e.target; if (!U.ed) return;
  if (el.dataset.ed) U.ed[el.dataset.ed] = el.value;
  else if (el.dataset.line !== undefined) {
    U.ed.lines[Number(el.dataset.line)][el.dataset.k] = el.value;
    const tot = U.ed.lines.reduce((t, l) => { const u = parseMoney(l.u || "0"); const q = parseInt(l.q, 10); const tx = Math.round(parseFloat(l.tax || "0") * 100) || 0; if (u === null || !(q >= 1)) return t; const amt = u * q; return { sub: t.sub + amt, tax: t.tax + Math.round((amt * tx) / 10000) }; }, { sub: 0, tax: 0 });
    document.getElementById("ed-sub").textContent = fmt(tot.sub); document.getElementById("ed-tax").textContent = fmt(tot.tax); document.getElementById("ed-total").textContent = fmt(tot.sub + tot.tax);
  }
});

seed();
render();
