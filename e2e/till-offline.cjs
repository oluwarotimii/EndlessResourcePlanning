// End-to-end check in a real browser: sell online, go offline, reload, sell offline, print A5, reconnect.
// Needs the production build served (pnpm build && pnpm --filter @erp/web preview) plus the mock server (pnpm --filter @erp/mock-server start).
// Run: node e2e/till-offline.cjs   (needs `playwright` resolvable, e.g. NODE_PATH or a local install)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const BASE = process.env.BASE ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS;
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined);
const step = (m) => console.log("•", m);

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Printing: record the call instead of opening a dialog, so the print layout can be captured.
  await ctx.addInitScript(() => { window.print = () => { window.__printed = (window.__printed || 0) + 1; }; });
  const page = await ctx.newPage();
  const scan = async (code) => { const box = page.getByLabel(/scan a barcode/i); await box.fill(code); await box.press("Enter"); };

  step("sign in as the cashier with a PIN");
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: /Amaka/ }).click();
  for (const d of "1111") await page.getByRole("group", { name: /keypad/i }).getByRole("button", { name: d, exact: true }).click();
  await page.waitForSelector('h1:has-text("Hello")');
  const serverSales = () => page.evaluate(async () => {
    const token = sessionStorage.getItem("erp.token");
    return (await (await fetch("/api/_debug/state", { headers: { authorization: `Bearer ${token}` } })).json()).sales;
  });
  const before = await serverSales();
  const balanceBefore = await page.evaluate(async () => {
    const token = sessionStorage.getItem("erp.token");
    return (await (await fetch("/api/customers?q=ade", { headers: { authorization: `Bearer ${token}` } })).json()).customers[0].balance;
  }); // the mock server may already hold sales from earlier runs
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1500); // let the service worker finish caching every screen

  step("open the shift with a 20,000 opening balance");
  await page.goto(`${BASE}/s/S03`);
  await page.getByLabel(/opening balance/i).fill("20000");
  await page.getByRole("button", { name: "Open shift" }).click();
  await page.getByRole("heading", { name: "Close shift" }).waitFor();

  step("sell online: 2 chargers + 1 cable, paid in cash");
  await page.goto(`${BASE}/s/S01`);
  await page.getByText("Phone charger 20W").first().waitFor();
  await scan("6001000000011"); await scan("6001000000011"); await scan("6001000000028");
  assert.match(await page.getByTestId("total").innerText(), /15,500/);
  await shot(page, "e2e-1-till-online");
  await page.getByRole("button", { name: "Cash", exact: true }).click();
  await page.getByText("Synced").waitFor({ timeout: 10000 });
  await shot(page, "e2e-2-sale-synced");

  step("online: open the customer list once so this device remembers customers for offline credit sales");
  await page.getByRole("button", { name: /customer/i }).click();
  await page.getByRole("button", { name: /Ade Stores/ }).waitFor();
  await page.getByRole("button", { name: "Walk-in customer", exact: true }).click();

  step("go offline and reload: the till must still open");
  await ctx.setOffline(true);
  await page.reload();
  await page.getByLabel(/scan a barcode/i).waitFor({ timeout: 10000 });
  await page.getByText("Phone charger 20W").first().waitFor();
  assert.match(await page.getByRole("status").first().innerText(), /Offline/);

  step("sell offline, paid by card");
  await scan("6001000000035");
  await page.getByRole("button", { name: "Card", exact: true }).click();
  await page.getByText(/Saved on this device/).waitFor();
  await page.getByText(/1 waiting to sync/).first().waitFor();
  await shot(page, "e2e-3-offline-sale");

  step("offline part-credit sale: cash 3,000 + rest on credit to a remembered customer");
  await scan("6001000000011");            // 6,500
  await page.getByRole("button", { name: /customer/i }).click();
  await page.getByText(/saved on this device/i).waitFor();
  await page.getByRole("button", { name: /Ade Stores/ }).click();
  await page.getByRole("button", { name: "Split payment" }).click();
  await page.getByLabel("Cash", { exact: true }).fill("3000");
  await page.getByRole("button", { name: "Put the rest on Credit" }).click();
  await shot(page, "e2e-3b-part-credit");
  await page.getByRole("button", { name: /confirm split payment/i }).click();
  await page.getByText(/On credit: .*3,500/).waitFor();
  await page.getByText(/2 waiting to sync/).first().waitFor();

  step("print the offline receipt: A5, COPY label, light theme");
  await page.getByRole("button", { name: /print invoice/i }).click();
  await page.waitForSelector(".print-area", { state: "attached" });
  assert.equal(await page.locator(".print-area >> text=Balance on credit").count(), 1);
  await page.waitForFunction(() => window.__printed >= 1);
  await page.emulateMedia({ media: "print" });
  assert.equal(await page.locator(".print-area >> text=COPY").count(), 1);
  const pdf = await page.pdf({ preferCSSPageSize: true });
  const text = pdf.toString("latin1");
  const box = text.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
  assert.ok(box, "PDF has a page size");
  const [wMm, hMm] = [Number(box[1]), Number(box[2])].map((pt) => (pt * 25.4) / 72);
  assert.ok(Math.abs(wMm - 148) < 1.5 && Math.abs(hMm - 210) < 1.5, `PDF page is A5 (148 x 210 mm), got ${wMm.toFixed(1)} x ${hMm.toFixed(1)}`);
  assert.equal((text.match(/\/Type\s*\/Page\b/g) || []).length, 1, "receipt fits on one A5 page");
  if (SHOTS) fs.writeFileSync(`${SHOTS}/e2e-receipt-A5.pdf`, pdf);
  await page.emulateMedia({ media: "screen" });

  step("reconnect: the queued sale replays and the server gains exactly 3 sales and the customer owes 3,500 more, once");
  await ctx.setOffline(false);
  await page.getByText(/Everything is saved/).first().waitFor({ timeout: 20000 });
  await shot(page, "e2e-4-reconnected");
  assert.equal((await serverSales()) - before, 3, "no sale lost and none posted twice");
  const owes = await page.evaluate(async () => {
    const token = sessionStorage.getItem("erp.token");
    const r = await (await fetch("/api/customers?q=ade", { headers: { authorization: `Bearer ${token}` } })).json();
    return r.customers[0].balance;
  });
  assert.equal(owes - balanceBefore, 3500, "the receivable was recorded exactly once");

  step("closing balance (blind count): expected cash = opening balance + CASH payments only (card and credit excluded): 20,000 + 15,500 + 3,000 = 38,500");
  await page.goto(`${BASE}/s/Q01`);
  assert.equal(await page.getByTestId("expected").count(), 0, "the count is blind: expected cash is hidden until counting is finished");
  await page.getByLabel("Number of ₦1,000 notes").fill("38");
  await page.getByLabel("Number of ₦500 notes").fill("1");
  await page.getByRole("button", { name: "Finish counting" }).click();
  assert.match(await page.getByTestId("expected").innerText(), /38,500/);
  assert.match(await page.getByTestId("variance").innerText(), /Matches exactly/);
  await shot(page, "e2e-5-cashup-review");
  await page.getByRole("button", { name: /close shift and sign out/i }).click();
  await page.getByText(/Who is signing in/).waitFor();

  step("a manager approves the closing balance (the cashier cannot sign off their own)");
  const mgr = await ctx.newPage();
  await mgr.goto(`${BASE}/login`);
  await mgr.getByRole("button", { name: /Tunde/ }).click();
  for (const d of "2222") await mgr.getByRole("group", { name: /keypad/i }).getByRole("button", { name: d, exact: true }).click();
  await mgr.waitForSelector('h1:has-text("Hello")');
  await mgr.goto(`${BASE}/s/A02`);
  await mgr.getByTestId("cashups-awaiting").waitFor();
  assert.ok(Number(await mgr.getByTestId("cashups-awaiting").innerText()) >= 1, "the manager home counts the closing balance waiting");
  await shot(mgr, "e2e-6-manager-home");
  await mgr.goto(`${BASE}/s/Q02`);
  const card = mgr.locator('[data-testid^="approval-"]').filter({ hasText: "Matches exactly" }).first();
  await card.waitFor();
  await card.getByRole("button", { name: /hold to approve/i }).dispatchEvent("pointerdown");
  await mgr.waitForTimeout(1200);
  await card.getByText(/Approved/i).first().waitFor();
  await mgr.goto(`${BASE}/s/G01`);
  await mgr.getByRole("heading", { name: "Closing balance differences" }).waitFor();
  await shot(mgr, "e2e-7-variance-report");
  await browser.close();
  console.log("E2E PASSED");
})().catch((e) => { console.error("E2E FAILED:", e); process.exit(1); });
