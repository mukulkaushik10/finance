import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { env } from "../playwright.config";

// The six acceptance criteria, end to end through the real UI, production build and worker.

const AGENT_KEY = "cr_demo_cautious_0000000000000000000000";
const WORKFLOW = "wf_ap_main";
const CSV_PATH = "seed/invoices.csv";

async function signIn(page: Page, who: "controller" | "admin" | "auditor") {
  await page.goto("/login");
  await page.getByTestId(`demo-login-${who}`).click();
  await page.waitForURL("/");
}

/** A clean invoice from the seed set (its PO and goods receipt exist), resubmitted under a fresh number. */
function cleanInvoiceBetween(minDollars: number, maxDollars: number, tag: string, nth = 0) {
  const rows = readFileSync(CSV_PATH, "utf8").trim().split("\n").slice(1).map((l) => l.split(","));
  // invoice_id,invoice_number,vendor,amount,currency,po_number,grn_number,invoice_date,correct_decision,correct_gl_code
  const candidates = rows.filter((r) => r[8] === "approve" && Number(r[3]) >= minDollars && Number(r[3]) <= maxDollars && !r[2].includes('"'));
  // Different vendors per call, so the duplicate check never fires between test invoices.
  const seen = new Set<string>();
  const distinct = candidates.filter((r) => (seen.has(r[2]) ? false : (seen.add(r[2]), true)));
  const row = distinct[nth];
  const id = `E2E-${tag}-${Date.now()}`;
  return {
    workflow_id: WORKFLOW,
    proposed: { decision: "approve", gl_code: row[9], reason: "Matches PO and goods received", confidence: 0.96 },
    subject: {
      type: "invoice", invoice_id: id, invoice_number: id, vendor_name: row[2],
      amount: { minor: Math.round(Number(row[3]) * 100), currency: row[4] },
      po_number: row[5], grn_number: row[6], invoice_date: new Date().toISOString().slice(0, 10),
    },
  };
}

async function evaluate(request: APIRequestContext, body: object) {
  const res = await request.post("/v1/actions/evaluate", { headers: { authorization: `Bearer ${AGENT_KEY}` }, data: body });
  expect(res.status()).toBe(201);
  return res.json();
}

test.describe.configure({ mode: "serial" });

test("1. a controller uploads the seed CSV, replays both mock agents and sees a comparison report in under 2 minutes", async ({ page }) => {
  const t0 = Date.now();
  await signIn(page, "controller");
  await page.getByRole("link", { name: "Replay testing" }).click();
  await page.getByTestId("csv-input").setInputFiles(CSV_PATH);
  await page.getByTestId("upload-csv").click();
  await expect(page.getByTestId("upload-summary")).toContainText("should be approved");
  await page.getByTestId("start-replay").click();
  await expect(page.getByTestId("side-by-side")).toBeVisible({ timeout: 120_000 });
  const seconds = (Date.now() - t0) / 1000;
  console.log(`   replay report visible after ${seconds.toFixed(1)}s`);
  expect(seconds).toBeLessThan(120);
  await expect(page.getByTestId("side-by-side")).toContainText("Cautious Co. AP Agent");
  await expect(page.getByTestId("side-by-side")).toContainText("Fast-Pay AI");
  await expect(page.getByTestId("confusion-matrix")).toBeVisible();
  await expect(page.getByTestId("worst-errors").locator("tbody tr")).toHaveCount(20);
});

test("3. at Level 2 an invoice above the limit lands in the review queue; approving it records reviewer, reason and time in the audit log", async ({ page, request }) => {
  const body = cleanInvoiceBetween(6000, 9500, "L2");
  const res = await evaluate(request, body);
  expect(res.autonomy_level).toBe(2);
  expect(res.outcome).toBe("needs_human");
  expect(res.reasons.join(" ")).toContain("auto-approve limit");

  await signIn(page, "controller");
  await page.getByRole("link", { name: /Review queue/ }).click();
  await page.getByRole("link", { name: body.subject.invoice_id }).click();
  await expect(page.getByTestId("review-panel")).toBeVisible();
  const reason = "Checked with the buyer; goods received in full";
  await page.getByTestId("review-reason").fill(reason);
  await page.getByTestId("approve").click();
  await page.waitForLoadState("networkidle");

  await page.goto(`/audit?entity=${res.action_id}`);
  const table = page.getByTestId("audit-table");
  await expect(table).toContainText(`Dana Whitfield approved: “${reason}”`);
  await expect(table).toContainText("Human decision");
  await expect(table.locator("tbody tr").first()).toContainText(/\d{1,2} \w{3} \d{4}, \d{2}:\d{2} UTC/);

  const status = await (await request.get(`/v1/actions/${res.action_id}`, { headers: { authorization: `Bearer ${AGENT_KEY}` } })).json();
  expect(status).toMatchObject({ status: "approved", final_decision: "approve", reviewer: { name: "Dana Whitfield", reason } });
});

test("2. lowering an approval limit in the rules screen changes the outcome on the next evaluate call, with no deploy", async ({ page, request }) => {
  const before = await evaluate(request, cleanInvoiceBetween(2500, 4800, "BEFORE", 0));
  expect(before.outcome).toBe("auto_approve");

  await signIn(page, "controller");
  await page.goto("/rules");
  const card = page.getByTestId("rule-approval_limit");
  await card.getByTestId("edit-rule").click();
  await card.getByTestId("band-limit-0").fill("2,000");
  await card.getByTestId("change-note").fill("Lower the no-approval band to $2,000 per CFO");
  await card.getByTestId("save-rule").click();
  await expect(page.getByTestId("rule-approval_limit").getByTestId("rule-summary")).toContainText("up to $2,000.00: no approval needed");

  const after = await evaluate(request, cleanInvoiceBetween(2500, 4800, "AFTER", 1));
  expect(after.outcome).toBe("needs_human");
  expect(after.required_approver).toBe("controller");
  expect(after.rule_results.find((r: { rule_name: string }) => r.rule_name === "Approval limits")).toMatchObject({ result: "fail", rule_version: 2 });
});

test("4. 'Verify chain' passes on clean data and flags a record edited directly in the database", async ({ page }) => {
  await signIn(page, "auditor");
  await page.goto("/audit");
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("verify-result")).toContainText("Passed");

  const out = execSync("npx tsx scripts/tamper.ts", { env: { ...process.env, ...env, NODE_ENV: "development" } }).toString();
  const seq = /record #(\d+)/.exec(out)![1];
  try {
    await page.getByTestId("verify-chain").click();
    await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("verify-result")).toContainText(`Record #${seq} was changed after it was written`);
  } finally {
    execSync("npx tsx scripts/tamper.ts --restore", { env: { ...process.env, ...env, NODE_ENV: "development" } });
  }
  await page.getByTestId("verify-chain").click();
  await expect(page.getByTestId("verify-result")).toHaveAttribute("data-ok", "true");
});

test("5. an auditor exports an evidence pack for one action and for one month, and cannot edit anything", async ({ page }) => {
  await signIn(page, "auditor");
  await expect(page.getByText("Read-only access")).toBeVisible();

  // One action
  await page.goto("/actions?status=approved");
  await page.getByTestId("action-row").first().getByRole("link").first().click();
  const [one] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-action").click()]);
  expect(one.suggestedFilename()).toMatch(/^evidence-pack_action-.+\.zip$/);
  const oneZip = await JSZip.loadAsync(readFileSync(await one.path()));
  expect(Object.keys(oneZip.files)).toEqual(expect.arrayContaining(["summary.pdf", "actions.csv", "rule_results.csv", "reviews.csv", "audit_records.csv", "chain_verification.json", "manifest.json"]));
  expect((await oneZip.file("actions.csv")!.async("string")).trim().split("\r\n")).toHaveLength(2);
  await expect(page.getByTestId("review-panel")).toHaveCount(0);

  // One month
  await page.goto("/audit");
  await page.getByTestId("export-mode").selectOption("month");
  const [month] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-download").click()]);
  expect(month.suggestedFilename()).toMatch(/^evidence-pack_\d{4}-\d{2}-01_to_\d{4}-\d{2}-\d{2}\.zip$/);
  const monthZip = await JSZip.loadAsync(readFileSync(await month.path()));
  const manifest = JSON.parse(await monthZip.file("manifest.json")!.async("string"));
  expect(manifest.counts.actions).toBeGreaterThan(0);
  expect(manifest.generatedBy.role).toBe("auditor");

  // Nothing editable in the UI…
  await page.goto("/rules");
  await expect(page.getByTestId("edit-rule")).toHaveCount(0);
  await expect(page.getByTestId("add-custom-rule")).toHaveCount(0);
  await page.goto("/autonomy");
  await expect(page.getByTestId("promote")).toHaveCount(0);
  await expect(page.getByTestId("demote")).toHaveCount(0);
  await page.goto("/review");
  const item = page.getByTestId("queue-item").first();
  if (await item.count()) {
    await item.click();
    await expect(page.getByTestId("review-panel")).toHaveCount(0);
  }
  await page.goto("/replay");
  await expect(page.getByTestId("upload-csv")).toHaveCount(0);
  await page.goto("/settings");
  await expect(page).toHaveURL(/denied=1/);

  // …and the server refuses writes even if the auditor calls the API directly.
  const api = page.request;
  const rules = await (await api.get(`/api/rules?workflowId=${WORKFLOW}`)).json();
  expect((await api.put(`/api/rules/${rules.rules[0].id}`, { data: { changeNote: "auditor edit", enabled: false } })).status()).toBe(403);
  expect((await api.post(`/api/workflows/${WORKFLOW}/autonomy`, { data: { toLevel: 1, reason: "auditor wants to change it" } })).status()).toBe(403);
  expect((await api.patch(`/api/workflows/${WORKFLOW}`, { data: { autoApproveLimitMinor: 1, reason: "auditor changing limit" } })).status()).toBe(403);
});

test("6. the API is documented (OpenAPI + Swagger UI)", async ({ page, request }) => {
  const doc = await (await request.get("/api/openapi.json")).json();
  expect(doc.paths["/v1/actions/evaluate"].post).toBeTruthy();
  await page.goto("/api-docs");
  await expect(page.getByText("Control Room API")).toBeVisible();
  await expect(page.getByText("/v1/actions/evaluate").first()).toBeVisible();
});

test("the scorecard's numbers link down to the invoices behind them", async ({ page }) => {
  await signIn(page, "controller");
  const value = (await page.getByTestId("kpi-value-volume").innerText()).replace(/,/g, "");
  await page.getByTestId("kpi-volume").click();
  await expect(page).toHaveURL(/\/actions\?from=/);
  await expect(page.getByTestId("actions-summary")).toContainText(`${Number(value).toLocaleString("en-US")} invoices`);
});
