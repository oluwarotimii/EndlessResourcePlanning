// Real-browser check of delivery: the coordinator assigns on the dispatch board, the rider (on a PHONE, OFFLINE) delivers a prepaid
// and a cash-on-delivery order in 3 taps each, hands in the cash, a manager confirms, and the outstanding list clears.
// Needs the production build served and a FRESH mock server (the orders are seeded once). Run: node e2e/delivery.cjs
const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const BASE = process.env.BASE ?? "http://localhost:4173";
const SHOTS = process.env.SHOTS;
const step = (m) => console.log("•", m);
const shot = (page, name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : undefined);

const api = async (path, token, body) => {
  const res = await fetch(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};
const tokenFor = async (userId, pin) => (await api("/api/login", null, { userId, pin })).body.token;
const signIn = async (page, name, pin) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  for (const d of pin) await page.getByRole("group", { name: /keypad/i }).getByRole("button", { name: d, exact: true }).click();
  await page.waitForSelector('h1:has-text("Hello")');
};

(async () => {
  const browser = await chromium.launch();
  const coordToken = await tokenFor("u-coordinator", "6666");
  const pending = (await api("/api/delivery/orders", coordToken)).body.orders.filter((o) => o.status === "pending");
  const cod = pending.find((o) => o.payment === "cash_on_delivery");
  const prepaid = pending.find((o) => o.payment === "prepaid");
  assert.ok(cod && prepaid, "needs a pending cash-on-delivery order and a pending prepaid order: restart the mock server for a fresh run");

  step(`the coordinator assigns ${cod.id} (cash on delivery) and ${prepaid.id} (prepaid) to Chidi on the dispatch board`);
  const coCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  const co = await coCtx.newPage();
  await signIn(co, "Sade", "6666");
  await co.goto(`${BASE}/s/L01`);
  for (const o of [cod, prepaid]) {
    const card = co.getByTestId(`order-${o.id}`);
    await card.waitFor();
    await card.getByRole("option", { name: "Chidi Okafor" }).waitFor({ state: "attached" });
    await card.getByLabel("Choose a rider").selectOption({ label: "Chidi Okafor" });
    await card.getByRole("button", { name: "Assign" }).click();
    await co.getByRole("region", { name: "Out for delivery" }).getByTestId(`order-${o.id}`).waitFor();
  }
  await shot(co, "e2e-delivery-1-board");

  step("the rider opens My deliveries on a phone, online once, then goes OFFLINE");
  const phone = devices["Pixel 7"];
  const riCtx = await browser.newContext({ ...phone });
  const ri = await riCtx.newPage();
  await signIn(ri, "Chidi", "5555");
  await ri.evaluate(() => navigator.serviceWorker.ready);
  await ri.waitForTimeout(1500);
  await ri.goto(`${BASE}/s/L02`);
  await ri.getByTestId(`order-${prepaid.id}`).waitFor();
  await ri.waitForTimeout(800);
  await riCtx.setOffline(true);
  await ri.reload();
  await ri.getByTestId(`order-${prepaid.id}`).waitFor();
  assert.equal(await ri.getByTestId(`order-${prepaid.id}`).getByText("Already paid").count(), 1);
  await shot(ri, "e2e-delivery-2-rider-phone");

  step("OFFLINE: the prepaid delivery is 3 taps (Deliver, Delivered, Confirm)");
  await ri.getByTestId(`order-${prepaid.id}`).getByRole("button", { name: "Deliver" }).click();
  await ri.getByRole("button", { name: "Delivered", exact: true }).click();
  await ri.getByRole("button", { name: "Confirm" }).click();
  await ri.getByText(/Saved\. If you are offline/).waitFor();

  step("OFFLINE: the cash-on-delivery order: the full amount is already chosen, so also 3 taps");
  await ri.goto(`${BASE}/s/L02`);
  await ri.getByTestId(`order-${cod.id}`).getByRole("button", { name: "Deliver" }).click();
  await ri.getByRole("button", { name: "Delivered", exact: true }).click();
  assert.equal(await ri.getByRole("button", { name: /Collected the full/ }).getAttribute("aria-pressed"), "true");
  await shot(ri, "e2e-delivery-3-proof");
  await ri.getByRole("button", { name: "Confirm" }).click();
  await ri.getByText(/Saved\. If you are offline/).waitFor();
  assert.equal((await api("/api/delivery/orders", coordToken)).body.orders.find((o) => o.id === cod.id).status, "assigned", "the server has not heard yet");

  step("reconnect: both proofs reach the server once");
  await riCtx.setOffline(false);
  await ri.getByText(/Everything is saved/).first().waitFor({ timeout: 20000 });
  const after = (await api("/api/delivery/orders", coordToken)).body.orders;
  assert.equal(after.find((o) => o.id === cod.id).status, "delivered");
  assert.equal(after.find((o) => o.id === cod.id).cashCollected, cod.amountDue);
  assert.equal(after.find((o) => o.id === prepaid.id).status, "delivered");

  step("the coordinator sees the delivery cash not yet handed in");
  await co.goto(`${BASE}/s/L05`);
  const row = co.getByTestId("cod-u-rider");
  await row.waitFor();
  await row.getByText(/On time/).waitFor();
  await shot(co, "e2e-delivery-4-outstanding");

  step("the rider hands in the cash; a manager confirms it (the rider cannot)");
  await ri.goto(`${BASE}/s/L04`);
  await ri.getByRole("button", { name: /^Hand in/ }).click();
  await ri.getByText(/The manager will confirm they received it/).waitFor();
  const mgCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mg = await mgCtx.newPage();
  await signIn(mg, "Tunde", "2222");
  await mg.goto(`${BASE}/s/A01`);
  const card = mg.locator('[data-testid^="approval-"]').filter({ hasText: "Delivery cash" }).first();
  await card.getByText(/Cash from Chidi Okafor/).waitFor();
  await card.getByRole("button", { name: /hold to approve/i }).dispatchEvent("pointerdown");
  await mg.waitForTimeout(1200);
  await card.getByText(/Approved/i).first().waitFor();

  step("the cash is no longer outstanding");
  await co.goto(`${BASE}/s/L05`);
  await co.getByText("All delivery cash has been handed in.").waitFor();
  await browser.close();
  console.log("DELIVERY E2E PASSED");
})().catch((e) => { console.error("DELIVERY E2E FAILED:", e); process.exit(1); });
