// Real-browser check of the stock flow: the branch asks, the warehouse packs by scanning and sends, the branch goes OFFLINE,
// counts what arrived (one item missing), reconnects, and the server records the shortage exactly once.
// Needs the production build served and the mock server running. Run: node e2e/stock.cjs
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
const tokenFor = async (userId, pin) => (await api("/api/login", null, { userId, pin })).body.token;
const signIn = async (page, name, pin) => {
  await page.goto(`${BASE}/login`);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  for (const d of pin) await page.getByRole("group", { name: /keypad/i }).getByRole("button", { name: d, exact: true }).click();
  await page.waitForSelector('h1:has-text("Hello")');
};
const scan = async (page, code, times = 1) => {
  for (let i = 0; i < times; i++) { const box = page.getByLabel(/scan an item/i); await box.fill(code); await box.press("Enter"); }
};

(async () => {
  const browser = await chromium.launch();

  step("the manager asks the warehouse for 4 chargers and 3 cables");
  const managerToken = await tokenFor("u-manager", "2222");
  const asked = (await api("/api/stock-requests", managerToken, { idempotencyKey: crypto.randomUUID(), lines: [{ productId: "p1", qty: 4 }, { productId: "p2", qty: 3 }], note: "Weekend rush" })).body.request;

  step("the warehouse officer packs by scanning: all 4 chargers, 3 cables, and sends");
  const whCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wh = await whCtx.newPage();
  await signIn(wh, "Ngozi", "3333");
  await wh.goto(`${BASE}/s/H03`);
  await wh.getByTestId(`request-${asked.id}`).getByRole("button", { name: "Pack this request" }).click();
  await wh.waitForTimeout(800); // the item list for scanning loads
  await scan(wh, "6001000000011", 4); await scan(wh, "6001000000028", 3);
  await wh.getByText("4 of 4 packed").waitFor();
  await shot(wh, "e2e-stock-1-packing");
  await wh.getByRole("button", { name: "Send to the branch (7)" }).click();
  await wh.getByText(/The branch will count it when it arrives/).waitFor();
  const sent = (await api("/api/transfers", managerToken)).body.transfers.find((x) => x.requestId === asked.id);
  assert.ok(sent && sent.status === "in_transit", "the transfer is on its way");
  assert.equal(sent.lines.reduce((n, l) => n + l.qtySent, 0), 7);

  step("the manager opens the receive screen online once, so the device remembers the transfer");
  const mgCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mg = await mgCtx.newPage();
  await signIn(mg, "Tunde", "2222");
  await mg.evaluate(() => navigator.serviceWorker.ready);
  await mg.waitForTimeout(1500);
  await mg.goto(`${BASE}/s/H04`);
  await mg.getByTestId(`transfer-${sent.id}`).waitFor();
  await mg.waitForTimeout(800);

  step("OFFLINE: reload, count the delivery by scanning (only 2 of 3 cables came out of the box), confirm");
  await mgCtx.setOffline(true);
  await mg.reload();
  await mg.getByTestId(`transfer-${sent.id}`).getByRole("button", { name: "Count this transfer" }).click();
  await mg.waitForTimeout(500);
  await scan(mg, "6001000000011", 4); await scan(mg, "6001000000028", 2);
  assert.match(await mg.getByTestId("missing").innerText(), /Items missing: 1/);
  await shot(mg, "e2e-stock-2-counting-offline");
  await mg.getByRole("button", { name: "Confirm what arrived" }).click();
  await mg.getByText(/If you are offline, it is sent/).waitFor();
  await mg.getByTestId(`received-${sent.id}`).getByText("Shortage: 1").waitFor();
  assert.equal((await api("/api/transfers", managerToken)).body.transfers.find((x) => x.id === sent.id).status, "in_transit", "the server has not heard yet");

  step("reconnect: the count reaches the server once, with the shortage flagged");
  await mgCtx.setOffline(false);
  await mg.getByText(/Everything is saved/).first().waitFor({ timeout: 20000 });
  const after = (await api("/api/transfers", managerToken)).body.transfers.find((x) => x.id === sent.id);
  assert.equal(after.status, "received");
  assert.equal(after.shortage, 1);
  assert.deepEqual(after.lines.map((l) => l.qtyReceived), [4, 2]);
  const levels = (await api("/api/stock?q=cable", managerToken)).body.levels[0];
  assert.ok(levels.branch >= 2, "the 2 cables that arrived are on the shelf");

  step("the shortage opens a ruling: the branch manager does NOT see the cost value");
  await mg.goto(`${BASE}/s/A01`);
  const mine = mg.locator('[data-testid^="approval-"]').filter({ hasText: `Transfer ${sent.id}` }).first();
  await mine.waitFor();
  assert.equal(await mine.getByText(/Value at cost/).count(), 0, "cost is hidden from the branch");
  assert.equal(await mine.getByRole("button", { name: /hold to approve/i }).count(), 0, "the branch cannot rule on its own shortage");

  step("the Auditor sees the inbox, sees the value at cost (1 cable = 1,750), must choose who bears the loss, and rules against the branch");
  const audCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const aud = await audCtx.newPage();
  await signIn(aud, "Hauwa", "8888");
  await aud.goto(`${BASE}/s/A01`);
  const card = aud.locator('[data-testid^="approval-"]').filter({ hasText: `Transfer ${sent.id}` }).first();
  await card.waitFor();
  await card.getByText("1 × USB-C cable 1m missing").waitFor();
  await card.getByText(/1,750/).first().waitFor();
  const hold = card.getByRole("button", { name: /hold to approve/i });
  assert.equal(await hold.isDisabled(), true, "cannot rule before choosing who bears the loss");
  await card.getByLabel(/who bears the loss/i).selectOption("branch");
  await shot(aud, "e2e-stock-3-ruling");
  await hold.dispatchEvent("pointerdown");
  await aud.waitForTimeout(1200);
  await card.getByText(/Ruled: charged to The branch that received it/).waitFor();

  step("the branch's figures now show the missing stock charged to it");
  await mg.goto(`${BASE}/s/A02`);
  await mg.getByText("Missing stock charged to this branch").waitFor();
  await shot(mg, "e2e-stock-4-manager-home");
  const summary = (await api("/api/summary", managerToken)).body;
  assert.ok(summary.shortagesCharged >= 1750, "the loss is charged to the branch at cost");

  await browser.close();
  console.log("STOCK E2E PASSED");
})().catch((e) => { console.error("STOCK E2E FAILED:", e); process.exit(1); });
