// Real-browser check of a physical stock count: the Stock controller counts OFFLINE (blind), a DIFFERENT person recounts,
// the controller asks for approval, two different people approve in order, and stock changes only at the very end.
// Needs the production build served and the mock server running. Run: node e2e/count.cjs
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
const holdApprove = async (card) => { await card.getByRole("button", { name: /hold to approve/i }).dispatchEvent("pointerdown"); await card.page().waitForTimeout(1200); };

(async () => {
  const browser = await chromium.launch();
  const managerToken = await tokenFor("u-manager", "2222");
  const shelf = async () => (await api("/api/stock?q=wireless", managerToken)).body.levels[0].branch;
  const have = await shelf();
  const counted = have - 3; // three wireless mice are really missing
  step(`the system says ${have} wireless mice are on the shelf; the real number is ${counted}`);

  step("the Stock controller opens the count online once, then goes OFFLINE and counts (blind: no quantities are shown)");
  const ctlCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const ctl = await ctlCtx.newPage();
  await signIn(ctl, "Ibrahim", "4444");
  await ctl.evaluate(() => navigator.serviceWorker.ready);
  await ctl.waitForTimeout(1500);
  await ctl.goto(`${BASE}/s/K01`);
  await ctl.getByRole("button", { name: "Begin counting" }).waitFor();
  await ctl.waitForTimeout(800);
  await ctlCtx.setOffline(true);
  await ctl.reload();
  await ctl.getByRole("button", { name: "Begin counting" }).click();
  await ctl.getByLabel("Counted Wireless mouse").waitFor();
  assert.equal(await ctl.locator("ul li").getByText(/system|expected/i).count(), 0, "the item rows show no system quantity");
  const mouseRow = (await ctl.locator("ul li").filter({ hasText: "Wireless mouse" }).first().innerText()).trim();
  assert.ok(!/\d/.test(mouseRow), `the Wireless mouse row shows no number before it is counted, got: ${mouseRow}`);
  await ctl.getByLabel("Counted Wireless mouse").fill(String(counted));
  await shot(ctl, "e2e-count-1-blind");
  await ctl.getByRole("button", { name: "Finish counting" }).click();
  await ctl.getByText(/Count saved/).waitFor();
  await ctlCtx.setOffline(false);
  await ctl.getByText(/Everything is saved/).first().waitFor({ timeout: 20000 });

  step("the server flags the item for a recount (and does not reveal the expected quantity)");
  const first = (await api("/api/counts", await tokenFor("u-stock", "4444"))).body.counts[0];
  assert.equal(first.status, "needs_recount");
  assert.equal(first.lines[0].expected, undefined);

  step("the same person cannot recount; the Warehouse officer recounts only the flagged item");
  await ctl.goto(`${BASE}/s/K01`);
  await ctl.getByTestId(`count-${first.id}`).getByText("A different person must recount these items.").waitFor();
  const whCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const wh = await whCtx.newPage();
  await signIn(wh, "Ngozi", "3333");
  await wh.goto(`${BASE}/s/K01`);
  await wh.getByTestId(`count-${first.id}`).getByRole("button", { name: "Recount these items" }).click();
  await wh.getByLabel("Counted Wireless mouse").fill(String(counted));
  await wh.getByRole("button", { name: "Send the recount" }).click();
  await wh.getByText(/Count saved/).waitFor();
  await wh.getByText(/Everything is saved/).first().waitFor({ timeout: 20000 });

  step("the Stock controller sees the final difference (short 3) and asks for approval; stock is NOT changed yet");
  await ctl.goto(`${BASE}/s/K02`);
  const diff = ctl.getByTestId(`diff-${first.id}`);
  await diff.getByText("Short 3").waitFor();
  await diff.getByLabel(/why do you think it differs/i).fill("Missing from the shelf");
  await shot(ctl, "e2e-count-2-differences");
  await diff.getByRole("button", { name: "Ask for approval to adjust stock" }).click();
  await ctl.getByText(/Stock stays as it is until it is approved/).waitFor();
  assert.equal(await shelf(), have, "stock is unchanged until approved");

  step("approvers see the value at cost; the Stock controller does not. Two different people approve, in order");
  const myApprovals = (await api("/api/approvals", await tokenFor("u-stock", "4444"))).body.approvals.find((a) => a.kind === "write_off");
  assert.equal(myApprovals.amount, 0, "the counter is not shown the cost");
  const mgCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const mg = await mgCtx.newPage();
  await signIn(mg, "Tunde", "2222");
  await mg.goto(`${BASE}/s/A01`);
  const mgCard = mg.locator('[data-testid^="approval-"]').filter({ hasText: first.id }).first();
  await mgCard.getByText(/Value at cost/).waitFor();
  await mgCard.getByText(/17,850/).first().waitFor(); // 3 x cost of 5,950
  await shot(mg, "e2e-count-3-approval");
  await holdApprove(mgCard);
  await mgCard.getByText(/Step 1 of 2/).waitFor();
  assert.equal(await shelf(), have, "still not adjusted after step 1");
  const audCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const aud = await audCtx.newPage();
  await signIn(aud, "Hauwa", "8888");
  await aud.goto(`${BASE}/s/A01`);
  const audCard = aud.locator('[data-testid^="approval-"]').filter({ hasText: first.id }).first();
  await audCard.getByText(/Value at cost/).waitFor();
  await holdApprove(audCard);

  step("only now is stock adjusted to what was counted");
  await ctl.goto(`${BASE}/s/K02`);
  await ctl.getByTestId(`hist-${first.id}`).getByText("Stock adjusted").waitFor();
  assert.equal(await shelf(), counted, "stock now matches the count");
  await browser.close();
  console.log("COUNT E2E PASSED");
})().catch((e) => { console.error("COUNT E2E FAILED:", e); process.exit(1); });
