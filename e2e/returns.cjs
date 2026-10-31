// Real-browser check of a customer return: the cashier sells, asks for a refund, TWO different people approve it in order,
// the cashier completes it, and the cash that left the drawer lowers the expected closing balance.
// Needs the production build served (pnpm build && pnpm --filter @erp/web preview) and the mock server running. Run: node e2e/returns.cjs
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS;
const step = (m) => console.log("•", m);
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined);

const api = async (path, token, body) => {
  const res = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const login = async (userId, pin) => (await api("/api/login", null, { userId, pin })).body.token;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  step("cashier signs in, opens a shift with 20,000, sells 2 chargers for cash");
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /Amaka/ }).click();
  for (const d of "1111") await page.getByRole("group", { name: /keypad/i }).getByRole("button", { name: d, exact: true }).click();
  await page.waitForSelector('h1:has-text("Hello")');
  await page.goto(`${BASE}/s/S03`);
  await page.getByLabel(/opening balance/i).fill("20000");
  await page.getByRole("button", { name: "Open shift" }).click();
  await page.getByRole("heading", { name: "Close shift" }).waitFor();
  await page.goto(`${BASE}/s/S01`);
  await page.getByText("Phone charger 20W").first().waitFor(); // the item list has loaded, so a scan can find the item
  const box = page.getByLabel(/scan a barcode/i);
  await box.fill("6001000000011"); await box.press("Enter"); await box.fill("6001000000011"); await box.press("Enter");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByText("Synced").waitFor({ timeout: 10000 });
  const invoiceNo = (await page.locator("text=/INV-\\d{6}/").first().innerText()).match(/INV-\d{6}/)[0];

  step(`ask to return 1 charger from ${invoiceNo}`);
  await page.goto(`${BASE}/s/T01`);
  await page.getByLabel(/invoice number/i).fill(invoiceNo);
  await page.getByRole("button", { name: "Find the sale" }).click();
  await page.getByRole("button", { name: "Return one more Phone charger 20W" }).click();
  await page.getByLabel(/why is it coming back/i).selectOption("Faulty item");
  assert.match(await page.getByTestId("refund").innerText(), /6,500/);
  await shot(page, "e2e-returns-1-choose");
  await page.getByRole("button", { name: "Ask for approval" }).click();
  await page.getByText("Waiting for approval").waitFor();
  assert.equal(await page.getByRole("button", { name: /complete the return/i }).count(), 0, "cannot complete before approval");

  step("step 1: the Branch manager approves; step 2: the Cash controller approves (two different people, in order)");
  const approvalId = (await page.locator("text=/Refund for INV/").count()) ? null : null; // id is found via the API below
  const manager = await login("u-manager", "2222");
  const cashCtl = await login("u-cashctl", "9999");
  const list = (await api("/api/approvals", manager)).body.approvals.filter((a) => a.kind === "refund" && a.status === "pending");
  const mine = list.find((a) => a.refund.invoiceNo === invoiceNo);
  assert.ok(mine, "the manager sees the refund request");
  assert.equal(mine.amount, 6500);
  assert.equal((await api(`/api/approvals/${mine.id}/decision`, cashCtl, { idempotencyKey: crypto.randomUUID(), decision: "approve" })).status, 403, "step 2 cannot go first");
  assert.equal((await api(`/api/approvals/${mine.id}/decision`, manager, { idempotencyKey: crypto.randomUUID(), decision: "approve" })).status, 200);
  await page.getByRole("button", { name: "Check again" }).click();
  await page.getByText(/Step 2 of 2/).waitFor();
  assert.equal(await page.getByRole("button", { name: /complete the return/i }).count(), 0, "still waiting for step 2");
  assert.equal((await api(`/api/approvals/${mine.id}/decision`, manager, { idempotencyKey: crypto.randomUUID(), decision: "approve" })).status, 403, "the manager cannot also do step 2");
  assert.equal((await api(`/api/approvals/${mine.id}/decision`, cashCtl, { idempotencyKey: crypto.randomUUID(), decision: "approve" })).status, 200);
  await page.getByRole("button", { name: "Check again" }).click();
  await shot(page, "e2e-returns-2-approved");

  step("the cashier completes the return; the customer gets 6,500 back in cash");
  await page.getByRole("button", { name: /complete the return and refund/i }).click();
  await page.getByText(/Return RET-\d+ recorded/).waitFor();
  await page.getByText("Give the customer ₦6,500 by Cash").waitFor();
  await shot(page, "e2e-returns-3-done");

  step("closing balance: expected = 20,000 + 13,000 cash sale - 6,500 cash refund = 26,500");
  await page.goto(`${BASE}/s/Q01`);
  await page.getByLabel("Number of ₦1,000 notes").fill("26");
  await page.getByLabel("Number of ₦500 notes").fill("1");
  await page.getByRole("button", { name: "Finish counting" }).click();
  assert.match(await page.getByTestId("expected").innerText(), /26,500/);
  assert.match(await page.getByTestId("variance").innerText(), /Matches exactly/);
  await browser.close();
  console.log("RETURNS E2E PASSED");
})().catch((e) => { console.error("RETURNS E2E FAILED:", e); process.exit(1); });
