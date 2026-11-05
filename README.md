# Control Room

An independent assurance layer that lets finance leaders **test, gate, monitor and audit AI agents** before and after they act on real money. It sits between any agent and the system of record, and is vendor-neutral.

The MVP covers **accounts payable invoice agents**. The data model is generic (workflow, action, rule), so a support-refund module can be added without a schema rewrite.

| Module | What it does | Where |
|---|---|---|
| Replay testing | Replay past invoices with known outcomes through 1–3 agents; compare accuracy, money mis-approved, money wrongly blocked, worst 20 errors | **Replay testing** |
| Business rules | Three-way match, approval limits, duplicates, bank-detail changes, blocked vendors, custom conditions; edited as plain-language sentences | **Rules** |
| Autonomy gate | `POST /v1/actions/evaluate` returns `auto_approve`, `needs_human` or `block`; Levels 0–3; promotion only when the track record supports it and a person confirms | **Autonomy**, **Review queue** |
| Audit trail | Append-only, hash-chained record of everything; "Verify chain"; evidence packs (PDF and CSV) | **Audit trail** |
| Scorecard | Weekly volume, accuracy, escalation rate, money auto-approved, money at risk, cost per invoice; every number drills down | **Scorecard** (home) |
| Supplier portal | Suppliers (invited by the buyer) turn POs into invoices, see checks before sending, track status, message the buyer, issue credit notes, and manage bank details that the buyer must approve | **/portal** (separate sign-in) |
| Payments | The buyer's own bank accounts (encrypted), approve / send back / reject supplier invoices, schedule payment, record it as paid | **Supplier invoices**, **Suppliers**, **Settings → Bank accounts** |

## Try it in your browser (no install)

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mukulkaushik10/finance?quickstart=1)

1. Click the button above, or go to **Code → Codespaces → Create codespace on main** on GitHub.
2. Wait about 3–5 minutes the first time. The codespace installs everything, creates the database and loads the demo data.
3. The app starts by itself. Click **Open in Browser** on the "port 3000" pop-up, or open the **Ports** tab and click the globe icon next to *Control Room*.
4. Click **Dana Whitfield, Controller**. The password for every demo account is `demo1234`.

If your codespace opened on GitHub's default image (the terminal says "You are on our default image") or nothing started, paste this into the terminal at the bottom and press Enter. It prints the link to open:

```bash
git pull && bash scripts/codespace-start.sh
```

The address is private to your GitHub account. To let a colleague try it, right-click port 3000 in the **Ports** tab, choose **Port Visibility → Public**, and send them the address. Anyone with the address can then sign in with the demo passwords, so switch it back to Private afterwards.

The codespace stops after 30 minutes of inactivity. Reopen it from **Code → Codespaces** and the app starts again with your data intact.

## Run it on your own computer

Requirements: Node 22 and Postgres 16. No Redis is needed; background jobs run on Postgres.

```bash
npm install
```

```bash
cp .env.example .env        # point DATABASE_URL at an empty database
```

```bash
npm run setup               # apply migrations and seed demo data (about 30 s)
```

```bash
npm run dev                 # web app on :3000 plus the background worker
```

Sign in at http://localhost:3000 with a demo account (password `demo1234`):

| Role | Email | Can |
|---|---|---|
| Controller | controller@harborpine.example | Set rules and autonomy, run replays, review up to any amount, export |
| Admin | admin@harborpine.example | Everything, plus settings (agents, vendors, users, connector) |
| Auditor | auditor@harborpine.example | See and export everything, change nothing |

**Supplier portal** at http://localhost:3000/portal/login (same password):

| Supplier | Email | Shows |
|---|---|---|
| Priya Raman, Brightpath Cleaning Services | priya@supplier.example | Invoices at every stage: paid, scheduled, waiting for a controller, sent back, draft |
| Marco Diaz, Copperleaf Consulting | marco@supplier.example | A bank detail change waiting for the buyer's approval |

An invitation waiting to be accepted: http://localhost:3000/portal/invite/demo-invite-harbor-pine

The seed creates:
- 1 organisation and 3 users.
- 120 vendors, 3 of them blocked and 1 with recently changed bank details.
- About 1,500 purchase orders and goods receipts.
- 2 mock agents with different error profiles.
- **`seed/invoices.csv`**: 1,000 synthetic invoices with known outcomes, for replay. Among them are duplicates, over-limit amounts, PO mismatches, missing receipts, blocked vendors and a changed bank account.
- **Eight weeks of live history**: 560 invoices that went through the real gate, about 380 human reviews, a promotion from Level 1 to Level 2, and 30 invoices left waiting for review.
- **Supplier portal data**: 2 buyer bank accounts, 2 connected suppliers with 5 portal invoices, 1 pending bank detail change and 1 open invitation.

Demo agent API keys, for calling the evaluate endpoint yourself:

```
Cautious Co. AP Agent   cr_demo_cautious_0000000000000000000000
Fast-Pay AI             cr_demo_fastpay_00000000000000000000000
```

## Demo walkthrough (maps to the acceptance criteria)

1. **Replay a vendor bake-off.** Go to Replay testing, upload `seed/invoices.csv`, keep both agents ticked, and click Run. The comparison appears in about 15 seconds. *Cautious Co.* is about 94% accurate but blocks good invoices. *Fast-Pay AI* is about 87% accurate and mis-approves over $1M, all of which your rules would have caught.
2. **Change policy live.** In Rules, edit Approval limits, lower the first band, give a reason, and save. The next evaluate call uses the new version:
   ```bash
   curl -s localhost:3000/v1/actions/evaluate -H 'Authorization: Bearer cr_demo_cautious_0000000000000000000000' -H 'content-type: application/json' -d '{"workflow_id":"wf_ap_main","proposed":{"decision":"approve","gl_code":"6100","confidence":0.95,"reason":"Matches PO"},"subject":{"type":"invoice","invoice_id":"TRY-1","vendor_name":"Northwind Hotels","amount":{"minor":750000,"currency":"USD"},"po_number":"PO-1","grn_number":"GRN-1","invoice_date":"2026-11-03"}}'
   ```
3. **Review queue.** At Level 2, anything over the $5,000 auto-approve limit lands in the Review queue. Open an invoice, give a reason, and approve. The audit trail records the reviewer, the reason and the time, and `GET /v1/actions/{id}` shows the decision to the agent.
4. **Tamper evidence.** In Audit trail, click Verify chain and it passes. Then run `npm run tamper`, which edits a record directly in the database as a superuser. Click Verify chain again and it names the altered record. Run `npm run tamper -- --restore` to undo.
5. **Evidence for an auditor.** Sign in as the auditor. Every invoice page has an Evidence pack button, and Audit trail exports any month, date range or vendor. Nothing is editable, and the API refuses writes with 403.
6. **API docs.** http://localhost:3000/api-docs (Swagger UI) and `/api/openapi.json`.
7. **Supplier sends an invoice.** Sign in to the supplier portal as Priya, click New invoice, pick PO-90005, enter a number, Save and review, then Send. It goes through the same AI check and rules as any other invoice.
8. **Buyer decides and pays.** As Dana, open Supplier invoices. Approve the invoice (or send it back with a message the supplier sees), schedule payment from one of your bank accounts, then record it as paid. Priya's timeline updates at each step.
9. **Bank detail fraud check.** As Dana, open Suppliers. Marco's request to change bank account waits there; approving needs a note on how you verified it. Until it's decided, his payments can't be scheduled, and afterwards the bank-change rule sends his next invoices to a person.

### How the supplier portal fits

- Suppliers have their own accounts (`VendorAccount`, `VendorUser`) and a separate session cookie. A supplier token is refused by every staff route and the other way round.
- `forVendor(vendorAccountId)` in `src/server/db/vendor-dal.ts` mirrors `forOrg`: every query is scoped to the supplier, and buyer-only tables (actions, rules, audit) are refused outright. Suppliers never see AI confidence, rule names or internal reasons.
- One supplier account can connect to many buyers (`VendorConnection` links it to each buyer's vendor record).
- A sent invoice becomes an action through the workflow's primary agent and `/v1/actions/evaluate` logic, so the rules, approval limits, review queue, scorecard and audit trail all apply. Decisions made in the review queue flow back to the supplier's invoice.
- Bank account numbers (buyer and supplier) are AES-256-GCM encrypted (`BANK_ENCRYPTION_KEY`, falling back to a key derived from `SESSION_SECRET` in development); only the last four digits and a keyed fingerprint are used elsewhere.
- Not built yet: moving money (payments are scheduled and recorded, not sent), email delivery (`src/server/portal/notify.ts` logs instead), e-invoicing networks, tax calculation.

## Tests

```bash
npm test          # 188 unit + API tests (Vitest, real Postgres database "controlroom_test")
```

```bash
npm run e2e       # Playwright: the acceptance criteria end to end on a production build + worker
```

- Unit tests cover every default rule, the custom-condition builder, the gate's decision table, money maths, hashing and CSV parsing.
- API tests call every route handler. They cover role checks, tenant isolation, idempotency, tamper detection (edit, re-hash, delete), evidence pack contents, and checks that every scorecard number equals its drill-down list.
- One test fails if any route file is missing from the OpenAPI document.
- Tests clear data with `TRUNCATE` and never drop or reset databases.

## Architecture

```
agent ──POST /v1/actions/evaluate──▶  gate ──▶ rules engine (pure) ◀── ERP connector (fake QuickBooks/Xero/NetSuite)
                                       │                                    ▲
                                       ├──▶ action + rule results + audit record (one transaction)
                                       └──▶ review queue ──▶ person decides ──▶ ground truth ──▶ rolling accuracy ──▶ promotion?
replay: CSV ──▶ pg-boss queue ──▶ worker ──▶ agent connector (mock | signed webhook) ──▶ same rules engine ──▶ report
```

- **Next.js 15 (App Router) + TypeScript, Prisma 6 + Postgres, Tailwind 4.** UI primitives follow the shadcn/ui copy-into-repo model and live in `src/components/ui`.
- **Background jobs use pg-boss on Postgres, not Redis/BullMQ.** That is one fewer service, jobs survive restarts, and enqueueing shares the database. `worker/index.ts` is a separate process.
- **Tenancy.** `forOrg(orgId)` in `src/server/db/dal.ts` returns a Prisma client that:
  - adds `organisationId` to every filter,
  - stamps it on every write,
  - throws on any explicit cross-tenant filter.

  Only the data-access layer, the audit chain, the worker and scripts use the raw client.
- **Money** is `BigInt` minor units plus a currency code, and percentages are basis points. No floats touch money; tolerance checks are exact integer comparisons.
- **The rules engine** (`src/server/rules`) is pure functions over a pre-loaded context. That makes it unit-testable, and replay and live calls share the same logic.
  - Every edit writes an immutable `RuleVersion`, which a database trigger protects.
  - Each action records the exact rule versions it was judged by.
- **The gate** (`src/server/gate/decide.ts`) applies, in order:
  1. A failed *block* rule blocks the action.
  2. An escalation, a failed *review* rule, or low confidence sends it to a person.
  3. Otherwise the autonomy level decides.

  Shadow mode works out the outcome as if at Level 3, records it, and lets the agent proceed.
- **The audit trail** is append-only, and a database trigger rejects UPDATE and DELETE.
  - `hash = SHA-256(canonical JSON of the record + previous hash)`.
  - Appends are serialised per organisation with an advisory lock, so the sequence numbers are gap-free.
  - Verification recomputes every record and checks every link, so edits, re-hashing and deletions are all caught.
- **Seams left for later:**
  - `AuthProvider` for SSO, in `src/server/auth`.
  - `ErpConnector` for real write-back.
  - `StorageFile` storage functions for S3.
  - Room for an extra evaluator in the gate pipeline, for LLM-as-judge.
  - `WorkflowType`, subject schemas and rule types for refunds.

## Agent API contract

`POST /v1/actions/evaluate` with header `Authorization: Bearer <agent key>` and an optional `Idempotency-Key`.

```json
{
  "workflow_id": "wf_ap_main",
  "agent_version": "2.3.0",
  "proposed": { "decision": "approve", "gl_code": "6100", "reason": "Matches PO 4471", "confidence": 0.93 },
  "subject": {
    "type": "invoice", "invoice_id": "INV-10432", "invoice_number": "10432", "vendor_id": "V-0042",
    "vendor_name": "Acme Supplies", "amount": { "minor": 1240000, "currency": "USD" },
    "po_number": "PO-4471", "grn_number": "GRN-8812", "invoice_date": "2026-10-28",
    "bank_account": { "fingerprint": "sha256:..." }
  },
  "cost": { "minor": 4, "currency": "USD" }
}
```

The response (`201`) includes:
- `action_id` and `outcome`, which is one of `auto_approve`, `needs_human` or `block`
- `enforced` and `shadow_outcome`
- `autonomy_level`, `status` and `required_approver`
- `reasons[]`, written in plain language
- `rule_results[]`, each with its rule version and explanation
- `review_url`
- `audit { seq, hash }`

Poll `GET /v1/actions/{id}` for a person's decision, or register a callback URL. Callbacks are signed the same way as replay webhooks.

**Replay webhook contract.** Control Room sends `POST {endpoint}` with the body `{ mode: "replay", workflow_type, subject }`. The headers `X-ControlRoom-Timestamp` and `X-ControlRoom-Signature: sha256=HMAC(secret, "<ts>.<body>")` sign the request. Your agent replies `{ decision, gl_code, reason, confidence }` within 10 seconds. A reference implementation is at `/api/mock-agents/{id}/decide`.

## Decisions worth knowing

- **Money at risk** counts invoices that went ahead even though a control check failed. Either a person approved despite the failure, or the agent proceeded in shadow mode. Approval-limit "failures" are routing, not risk: when the right person approves, the control has worked.
- **Ground truth** comes from reviews. When the agent escalated, the reviewer also says whether escalating was the right call. Accuracy means the agent's decision matched the correct decision.
- **Rejections** go to a person below Level 3. At Level 3 a confident rejection is applied automatically. Escalations always go to a person.
- **Duplicate detection** normalises invoice numbers, so `INV-0010432`, `10432A` and `1O432` all match. It never treats sequential numbers as duplicates.
- **Exports are audited**, including the auditor's. This records who took what evidence and changes no business data.
- **Multi-currency.** Rules work per currency. Approval limits, the Level 2 limit and the scorecard use the workflow currency, and there is no FX conversion in the MVP.

## Open questions

1. **Sampling for QA at Levels 2 and 3.** People mostly review the hard invoices, so measured accuracy understates routine accuracy. Should a random share of auto-approved invoices be queued for spot checks?
2. **Should moving from Level 0 to Level 1 need the accuracy gate?** It adds human review rather than removing it.
3. **Anchoring the chain.** Rewriting every record after a tampered one can only be caught against an external copy of the latest fingerprint. Do you want it emailed daily, written to WORM storage, or timestamped by a third party?
4. **The "With your rules" view in replay** simulates Level 3 (rules plus confidence only). Should it use the workflow's actual level instead?
5. **Approval routing for custom rules.** Custom conditions with a required approver are treated as control checks, not routing. Should they be routing too?
6. **Agent cost** defaults to the per-agent setting when the agent doesn't report its cost per call. Is that the right fallback for your finance team?
