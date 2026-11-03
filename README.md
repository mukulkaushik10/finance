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

## Run it

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

The seed creates:
- 1 organisation and 3 users.
- 120 vendors, 3 of them blocked and 1 with recently changed bank details.
- About 1,500 purchase orders and goods receipts.
- 2 mock agents with different error profiles.
- **`seed/invoices.csv`**: 1,000 synthetic invoices with known outcomes, for replay. Among them are duplicates, over-limit amounts, PO mismatches, missing receipts, blocked vendors and a changed bank account.
- **Eight weeks of live history**: 560 invoices that went through the real gate, about 380 human reviews, a promotion from Level 1 to Level 2, and 30 invoices left waiting for review.

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

## Tests

```bash
npm test          # 160 unit + API tests (Vitest, real Postgres database "controlroom_test")
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
