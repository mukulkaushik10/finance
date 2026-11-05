import { test, expect, type Page } from "@playwright/test";

// Supplier portal, end to end: a supplier bills a PO, the buyer approves and pays it, the supplier
// sees it paid; a bank detail change is approved; a new supplier accepts an invitation.

async function staff(page: Page) {
  await page.goto("/login");
  await page.getByTestId("demo-login-controller").click();
  await page.waitForURL("/");
}

async function supplier(page: Page, who: "priya" | "marco") {
  await page.goto("/portal/login");
  await page.getByTestId(`supplier-login-${who}`).click();
  await page.waitForURL("**/portal");
}

test("a supplier bills a purchase order; the buyer approves and pays it; the supplier sees it paid", async ({ browser }) => {
  const sup = await (await browser.newContext()).newPage();
  await supplier(sup, "priya");
  await expect(sup.getByTestId("supplier-stats")).toContainText("Owed to you");

  await sup.goto("/portal/invoices/new");
  await sup.getByTestId("po-card").filter({ hasText: "PO-90005" }).click();
  await expect(sup.getByTestId("form-po")).toHaveValue("PO-90005");
  await expect(sup.getByTestId("form-total")).toHaveText("$3,700.00"); // 200 delivered x $18.50
  const number = `E2E-${Date.now()}`;
  await sup.getByTestId("form-number").fill(number);
  await sup.getByTestId("form-save").click();
  await expect(sup.getByTestId("checks")).toContainText("Matches what was delivered");
  await sup.getByTestId("send-invoice").click();
  await expect(sup.getByTestId("invoice-status")).not.toHaveText("Draft");
  const url = sup.url();

  const buy = await (await browser.newContext()).newPage();
  await staff(buy);
  await buy.goto("/invoices?status=");
  await buy.getByTestId("invoice-link").filter({ hasText: number }).click();
  await expect(buy.getByTestId("timeline")).toContainText("Received");
  if (await buy.getByTestId("invoice-decision").isVisible()) {
    await buy.getByTestId("decision-reason").fill("Matches the PO and the delivery record");
    await buy.getByTestId("invoice-approve").click();
  }
  await expect(buy.getByTestId("payment-panel")).toBeVisible();
  await buy.getByTestId("schedule-payment").click();
  await expect(buy.getByTestId("invoice-status")).toHaveText("Payment scheduled");
  await buy.getByTestId("payment-reference").fill("ACH-E2E-1");
  await buy.getByTestId("mark-paid").click();
  await expect(buy.getByTestId("invoice-status")).toHaveText("Paid");

  await sup.goto(url);
  await expect(sup.getByTestId("invoice-status")).toHaveText("Paid");
  await expect(sup.getByTestId("timeline")).toContainText("Payment reference ACH-E2E-1");
  // The supplier never sees the AI or rule detail.
  await expect(sup.locator("body")).not.toContainText("Three-way match");
  const pdf = await sup.request.get(url.replace("/portal/invoices/", "/api/portal/invoices/") + "/pdf");
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
});

test("a supplier's bank detail change is approved by the buyer after verification", async ({ browser }) => {
  const sup = await (await browser.newContext()).newPage();
  await supplier(sup, "marco");
  await sup.goto("/portal/bank");
  await expect(sup.getByTestId("buyer-bank")).toContainText("waiting for Harbor & Pine");

  const buy = await (await browser.newContext()).newPage();
  await staff(buy);
  await buy.goto("/suppliers");
  const card = buy.getByTestId("bank-changes");
  await expect(card).toContainText("Evergreen Federal Credit Union ••7781");
  await buy.getByTestId("bank-verification").fill("Called Marco Diaz on (206) 555-0187 from our vendor file; confirmed");
  await buy.getByTestId("approve-bank-change").click();
  await expect(card).toContainText("Nothing waiting");

  await sup.reload();
  await expect(sup.getByTestId("buyer-bank")).toContainText("Evergreen Federal Credit Union ••7781");
});

test("a new supplier accepts an invitation and is asked for bank details", async ({ page }) => {
  await page.goto("/portal/invite/demo-invite-harbor-pine");
  await expect(page.locator("h1")).toContainText("Harbor & Pine Manufacturing invited you");
  await page.getByTestId("accept-name").fill("Nia Brooks");
  await page.getByTestId("accept-password").fill("a-strong-password");
  await page.getByTestId("accept-new").click();
  await page.waitForURL("**/portal/bank?welcome=1");
  await expect(page.getByText("Welcome to the supplier portal")).toBeVisible();
  await expect(page.getByTestId("supplier-account")).toContainText("Oakridge Paper Co.");

  // The staff app is off limits with a supplier session.
  await page.goto("/");
  await page.waitForURL("**/login");
});
