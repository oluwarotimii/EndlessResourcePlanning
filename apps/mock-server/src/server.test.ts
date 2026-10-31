import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { ApiError, ApprovalResponse, ApprovalsResponse, Capabilities, CustomersResponse, LoginResponse, ProductsResponse, SaleResponse, ShiftResponse, TasksResponse, UsersResponse } from "@erp/api-contract";
import { createMockServer } from "./server";

const server = createMockServer();
let base = "";
beforeAll(async () => { await new Promise<void>((r) => server.listen(0, r)); base = `http://localhost:${(server.address() as AddressInfo).port}`; });
afterAll(() => { server.close(); });

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("mock server honours the api-contract", () => {
  it("lists the device's registered users", async () => {
    const body = UsersResponse.parse(await (await fetch(`${base}/api/users`)).json());
    expect(body.users.map((u) => u.role)).toContain("Cashier");
  });
  it("signs in with a PIN and returns capabilities for the role", async () => {
    const res = await post("/api/login", { userId: "u-manager", pin: "2222" });
    const body = LoginResponse.parse(await res.json());
    expect(body.capabilities.roles).toEqual(["Branch manager"]);
    expect(body.capabilities.areas["Stores (POS)"]).toContain("A");
    const caps = Capabilities.parse(await (await fetch(`${base}/api/capabilities`, { headers: { authorization: `Bearer ${body.token}` } })).json());
    expect(caps.user.id).toBe("u-manager");
    const tasks = TasksResponse.parse(await (await fetch(`${base}/api/tasks`, { headers: { authorization: `Bearer ${body.token}` } })).json());
    expect(tasks.tasks.length).toBeGreaterThan(0);
  });
  it("refuses a wrong PIN with a readable error", async () => {
    const res = await post("/api/login", { userId: "u-cashier", pin: "9999" });
    expect(res.status).toBe(401);
    expect(ApiError.parse(await res.json()).code).toBe("unauthenticated");
  });
  it("rejects a malformed PIN as a validation error", async () => {
    const res = await post("/api/login", { userId: "u-cashier", pin: "12" });
    expect(res.status).toBe(400);
  });
  it("locks a user after repeated wrong PINs", async () => {
    for (let i = 0; i < 5; i++) await post("/api/login", { userId: "u-coordinator", pin: "0000" });
    const res = await post("/api/login", { userId: "u-coordinator", pin: "6666" });
    expect(res.status).toBe(403);
  });
  it("needs a token for private endpoints and can simulate an outage", async () => {
    expect((await fetch(`${base}/api/tasks`)).status).toBe(401);
    const res = await fetch(`${base}/api/users`, { headers: { "x-mock-fail": "unavailable" } });
    expect(res.status).toBe(503);
  });
});

describe("till endpoints (Sprint 2/3)", () => {
  const uuid = () => crypto.randomUUID();
  async function login(userId: string, pin: string) {
    const body = LoginResponse.parse(await (await post("/api/login", { userId, pin })).json());
    return { authorization: `Bearer ${body.token}` };
  }
  /** A sale of 2 x 6,500 charger = 13,000 (VAT-inclusive server), paid by the given payments. */
  const sale = (shiftId: string, over: Record<string, unknown> = {}) => ({
    idempotencyKey: uuid(), clientCreatedAt: new Date().toISOString(), shiftId,
    lines: [{ productId: "p1", name: "Phone charger 20W", unitPrice: 6500, qty: 2 }],
    subtotal: 13000, vatMode: "inclusive", vat: 907, total: 13000, payments: [{ method: "cash", amount: 13000 }], ...over,
  });
  const openShift = async (h: Record<string, string>, float = 20000) => {
    const shiftId = uuid();
    await post("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: float }, h);
    return shiftId;
  };

  it("lists products and searches customers with their credit terms", async () => {
    const h = await login("u-cashier", "1111");
    const prods = ProductsResponse.parse(await (await fetch(`${base}/api/products`, { headers: h })).json());
    expect(prods.products.length).toBeGreaterThan(10);
    const cust = CustomersResponse.parse(await (await fetch(`${base}/api/customers?q=ade`, { headers: h })).json());
    expect(cust.customers[0]).toMatchObject({ name: "Ade Stores", creditLimit: 200000, balance: 50000 });
  });

  it("a retried sale never posts twice (idempotency key)", async () => {
    const h = await login("u-cashier", "1111");
    const shiftId = await openShift(h);
    const body = sale(shiftId);
    const first = SaleResponse.parse(await (await post("/api/sales", body, h)).json());
    const again = SaleResponse.parse(await (await post("/api/sales", body, h)).json());
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.sale.invoiceNo).toBe(first.sale.invoiceNo);
  });

  it("closing a shift expects only CASH payments in the drawer, and is idempotent", async () => {
    const h = await login("u-cashier", "1111");
    const shiftId = await openShift(h);
    await post("/api/sales", sale(shiftId), h); // 13,000 cash
    await post("/api/sales", sale(shiftId, { payments: [{ method: "card", amount: 13000 }] }), h); // not cash
    await post("/api/sales", sale(shiftId, { payments: [{ method: "cash", amount: 3000 }, { method: "transfer", amount: 10000 }] }), h); // 3,000 cash
    const close = { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 35500, varianceReason: "Counting error" };
    const res = ShiftResponse.parse(await (await post("/api/shifts/close", close, h)).json());
    expect(res.shift.expectedCash).toBe(36000);
    expect(res.shift.variance).toBe(-500);
    expect(ShiftResponse.parse(await (await post("/api/shifts/close", close, h)).json()).duplicate).toBe(true);
  });

  it("rejects payments that do not add up, a wrong total, a closed shift and a never-opened shift", async () => {
    const h = await login("u-cashier", "1111");
    expect((await post("/api/sales", sale(uuid()), h)).status).toBe(400);
    const shiftId = await openShift(h, 0);
    expect((await post("/api/sales", sale(shiftId, { payments: [{ method: "cash", amount: 12000 }] }), h)).status).toBe(400);
    expect((await post("/api/sales", sale(shiftId, { total: 1, subtotal: 1 }), h)).status).toBe(400);
    await post("/api/shifts/close", { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 0 }, h);
    expect((await post("/api/sales", sale(shiftId), h)).status).toBe(400);
  });

  it("part credit: needs a customer with terms, records the receivable once, and enforces the limit", async () => {
    const h = await login("u-cashier", "1111");
    const shiftId = await openShift(h);
    const partCredit = { payments: [{ method: "cash", amount: 3000 }, { method: "credit", amount: 10000 }] };
    expect((await post("/api/sales", sale(shiftId, partCredit), h)).status).toBe(400); // no customer
    expect((await post("/api/sales", sale(shiftId, { ...partCredit, customerId: "c3" }), h)).status).toBe(400); // no credit terms
    const ok = sale(shiftId, { ...partCredit, customerId: "c1" });
    expect((await post("/api/sales", ok, h)).status).toBe(200);
    expect(SaleResponse.parse(await (await post("/api/sales", ok, h)).json()).duplicate).toBe(true); // retry: balance not added twice
    const after = CustomersResponse.parse(await (await fetch(`${base}/api/customers?q=ade`, { headers: h })).json());
    expect(after.customers[0]?.balance).toBe(60000); // 50,000 + 10,000, once
    const over = sale(shiftId, { customerId: "c2", payments: [{ method: "credit", amount: 13000 }] }); // 95,000 + 13,000 > 100,000
    const res = await post("/api/sales", over, h);
    expect(res.status).toBe(400);
    expect(ApiError.parse(await res.json()).message).toMatch(/credit limit/);
  });

  it("credit only: the whole sale on credit is allowed within the limit", async () => {
    const h = await login("u-cashier", "1111");
    const shiftId = await openShift(h);
    const res = await post("/api/sales", sale(shiftId, { customerId: "c1", payments: [{ method: "credit", amount: 13000 }] }), h);
    expect(res.status).toBe(200);
  });

  it("a role without create rights on the till cannot post sales", async () => {
    const h = await login("u-warehouse", "3333");
    expect((await post("/api/sales", sale(uuid()), h)).status).toBe(403);
  });

  it("a credit sale over the limit needs an approved request for that customer, used once", async () => {
    const cashier = await login("u-cashier", "1111");
    const manager = await login("u-manager", "2222");
    const raised = ApprovalResponse.parse(await (await post("/api/approvals", {
      idempotencyKey: uuid(), kind: "credit_over_limit", amount: 13000, unit: "naira", customerId: "c2",
    }, cashier)).json()).approval;
    expect(raised).toMatchObject({ kind: "credit_over_limit", customerId: "c2", customerName: "Bola Ventures", limit: 100000 });
    await post(`/api/approvals/${raised.id}/decision`, { idempotencyKey: uuid(), decision: "approve" }, manager);

    const shiftId = await openShift(cashier);
    const credit = { customerId: "c2", payments: [{ method: "credit", amount: 13000 }] };
    expect((await post("/api/sales", sale(shiftId, credit), cashier)).status).toBe(400); // no approval
    const approved = sale(shiftId, { ...credit, creditApprovalId: raised.id });
    expect(SaleResponse.parse(await (await post("/api/sales", approved, cashier)).json()).sale).toMatchObject({ customerId: "c2", creditApprovalId: raised.id });
    expect((await post("/api/sales", sale(shiftId, { ...credit, creditApprovalId: raised.id }), cashier)).status).toBe(400); // used
  });

  it("an approved discount is applied once, and cannot be reused or used before approval", async () => {
    const cashier = await login("u-cashier", "1111");
    const manager = await login("u-manager", "2222");
    const raise = async () => ApprovalResponse.parse(await (await post("/api/approvals", {
      idempotencyKey: uuid(), kind: "discount", amount: 2, unit: "percent",
    }, cashier)).json()).approval;
    const approve = (id: string) => post(`/api/approvals/${id}/decision`, { idempotencyKey: uuid(), decision: "approve" }, manager);

    const approved = await raise();
    await approve(approved.id);
    const shiftId = await openShift(cashier);
    const discounted = { discountApprovalId: approved.id, vat: 889, total: 12740, payments: [{ method: "cash", amount: 12740 }] };
    const body = sale(shiftId, discounted);
    const first = SaleResponse.parse(await (await post("/api/sales", body, cashier)).json());
    expect(first.sale).toMatchObject({ subtotal: 13000, total: 12740, discountApprovalId: approved.id });
    expect(SaleResponse.parse(await (await post("/api/sales", body, cashier)).json()).duplicate).toBe(true);
    expect((await post("/api/sales", sale(shiftId, discounted), cashier)).status).toBe(400); // already used

    const pending = await raise();
    expect((await post("/api/sales", sale(shiftId, { ...discounted, discountApprovalId: pending.id }), cashier)).status).toBe(400);
  });
});

describe("approvals engine (Sprint 3)", () => {
  const login = async (userId: string, pin: string) =>
    ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const decide = (id: string, body: unknown, h: Record<string, string>) => post(`/api/approvals/${id}/decision`, body, h);

  it("the inbox shows requests the role may decide, with who, what, amount and limit", async () => {
    const h = await login("u-manager", "2222");
    const body = ApprovalsResponse.parse(await (await fetch(`${base}/api/approvals`, { headers: h })).json());
    const discount = body.approvals.find((a) => a.id === "AP-0001");
    expect(discount).toMatchObject({ kind: "discount", amount: 2, limit: 3, unit: "percent", requestedBy: { name: "Amaka Obi" } });
  });

  it("a cashier sees only the requests they raised, never the inbox", async () => {
    const h = await login("u-cashier", "1111");
    const body = ApprovalsResponse.parse(await (await fetch(`${base}/api/approvals`, { headers: h })).json());
    expect(body.approvals.every((a) => a.requestedBy.id === "u-cashier")).toBe(true);
    expect(body.approvals.some((a) => a.id === "AP-0004")).toBe(false);
  });

  it("approving is idempotent: the same key never decides twice", async () => {
    const h = await login("u-manager", "2222");
    const key = crypto.randomUUID();
    const first = ApprovalResponse.parse(await (await decide("AP-0001", { idempotencyKey: key, decision: "approve" }, h)).json());
    expect(first.duplicate).toBe(false);
    expect(first.approval).toMatchObject({ status: "approved", decidedBy: { id: "u-manager" } });
    const again = ApprovalResponse.parse(await (await decide("AP-0001", { idempotencyKey: key, decision: "approve" }, h)).json());
    expect(again.duplicate).toBe(true);
    expect(again.approval.status).toBe("approved");
    expect((await decide("AP-0001", { idempotencyKey: crypto.randomUUID(), decision: "reject", reason: "Too late" }, h)).status).toBe(400);
  });

  it("a rejection without a reason is refused; with a reason it is recorded", async () => {
    const h = await login("u-manager", "2222");
    expect((await decide("AP-0002", { idempotencyKey: crypto.randomUUID(), decision: "reject" }, h)).status).toBe(400);
    const res = ApprovalResponse.parse(await (await decide("AP-0002", { idempotencyKey: crypto.randomUUID(), decision: "reject", reason: "Refund window closed" }, h)).json());
    expect(res.approval).toMatchObject({ status: "rejected", decisionReason: "Refund window closed" });
  });

  it("the creator never approves their own request, and a role without the approve letter is refused", async () => {
    const manager = await login("u-manager", "2222");
    expect((await decide("AP-0004", { idempotencyKey: crypto.randomUUID(), decision: "approve" }, manager)).status).toBe(403);
    const warehouse = await login("u-warehouse", "3333");
    expect((await decide("AP-0003", { idempotencyKey: crypto.randomUUID(), decision: "approve" }, warehouse)).status).toBe(403);
  });

  it("a cashier raises a request that lands in the inbox; the same key never raises it twice", async () => {
    const cashier = await login("u-cashier", "1111");
    const key = crypto.randomUUID();
    const body = { idempotencyKey: key, kind: "discount", amount: 2, unit: "percent", requestNote: "Open box" };
    const first = ApprovalResponse.parse(await (await post("/api/approvals", body, cashier)).json());
    expect(first.duplicate).toBe(false);
    expect(first.approval).toMatchObject({ kind: "discount", status: "pending", amount: 2, limit: 3, unit: "percent", requestedBy: { id: "u-cashier" } });
    const again = ApprovalResponse.parse(await (await post("/api/approvals", body, cashier)).json());
    expect(again.duplicate).toBe(true);
    expect(again.approval.id).toBe(first.approval.id);
    const manager = await login("u-manager", "2222");
    const inbox = ApprovalsResponse.parse(await (await fetch(`${base}/api/approvals`, { headers: manager })).json());
    expect(inbox.approvals.some((a) => a.id === first.approval.id)).toBe(true);
  });

  it("a manager cannot approve a discount above their own limit", async () => {
    const cashier = await login("u-cashier", "1111");
    const raised = ApprovalResponse.parse(await (await post("/api/approvals", {
      idempotencyKey: crypto.randomUUID(), kind: "discount", amount: 5, unit: "percent",
    }, cashier)).json());
    const manager = await login("u-manager", "2222");
    const res = await decide(raised.approval.id, { idempotencyKey: crypto.randomUUID(), decision: "approve" }, manager);
    expect(res.status).toBe(403);
    expect(ApiError.parse(await res.json()).message).toMatch(/above your limit/i);
  });

  it("a credit over-limit request needs a customer, uses their credit limit, and is refused when there is room", async () => {
    const cashier = await login("u-cashier", "1111");
    const base = { idempotencyKey: crypto.randomUUID(), kind: "credit_over_limit", unit: "naira" };
    expect((await post("/api/approvals", { ...base, amount: 13000 }, cashier)).status).toBe(400); // no customer
    expect((await post("/api/approvals", { ...base, amount: 1000, customerId: "c1" }, cashier)).status).toBe(400); // still has room
    const over = ApprovalResponse.parse(await (await post("/api/approvals", { ...base, amount: 13000, customerId: "c2" }, cashier)).json());
    expect(over.approval).toMatchObject({ kind: "credit_over_limit", amount: 13000, limit: 100000, customerName: "Bola Ventures" });
  });
});

describe("VAT added on top (exclusive) is enforced by the server too", () => {
  it("accepts the exclusive total and refuses an inclusive one", async () => {
    const ex = createMockServer({ vatMode: "exclusive" });
    await new Promise<void>((r) => ex.listen(0, r));
    const b = `http://localhost:${(ex.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const login = LoginResponse.parse(await (await p("/api/login", { userId: "u-cashier", pin: "1111" })).json());
    const h = { authorization: `Bearer ${login.token}` };
    const shiftId = crypto.randomUUID();
    await p("/api/shifts/open", { idempotencyKey: crypto.randomUUID(), shiftId, openedAt: new Date().toISOString(), openingFloat: 0 }, h);
    const base10k = { idempotencyKey: crypto.randomUUID(), clientCreatedAt: new Date().toISOString(), shiftId, lines: [{ productId: "p1", name: "x", unitPrice: 10000, qty: 1 }] };
    const good = { ...base10k, subtotal: 10000, vatMode: "exclusive", vat: 750, total: 10750, payments: [{ method: "cash", amount: 10750 }] };
    expect((await p("/api/sales", good, h)).status).toBe(200);
    const wrong = { ...good, idempotencyKey: crypto.randomUUID(), vatMode: "inclusive", vat: 698, total: 10000, payments: [{ method: "cash", amount: 10000 }] };
    expect((await p("/api/sales", wrong, h)).status).toBe(400);
    ex.close();
  });
});

describe("cash-up: closing a shift raises a sign-off for someone else", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const open = async (h: Record<string, string>) => {
    const shiftId = uuid();
    await post("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 20000 }, h);
    return shiftId;
  };
  const close = (shiftId: string, extra: Record<string, unknown>, h: Record<string, string>) =>
    post("/api/shifts/close", { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), ...extra }, h);
  const cashUps = async (h: Record<string, string>) =>
    ((await (await fetch(`${base}/api/approvals`, { headers: h })).json()) as { approvals: Array<{ id: string; kind: string; status: string; cashUp?: { shiftId: string; variance: number; reason?: string } }> })
      .approvals.filter((a) => a.kind === "cash_up");

  it("a count that does not match needs a reason; a matching count does not", async () => {
    const h = await as("u-cashier", "1111");
    const s1 = await open(h);
    expect((await close(s1, { countedCash: 19500 }, h)).status).toBe(400); // 500 short, no reason
    expect((await close(s1, { countedCash: 19500, varianceReason: "Counting error" }, h)).status).toBe(200);
    const s2 = await open(h);
    expect((await close(s2, { countedCash: 20000 }, h)).status).toBe(200); // exact: no reason needed
  });

  it("notes counted must add up to the cash counted", async () => {
    const h = await as("u-cashier", "1111");
    const s = await open(h);
    expect((await close(s, { countedCash: 20000, denominations: { "1000": 19 } }, h)).status).toBe(400);
    expect((await close(s, { countedCash: 20000, denominations: { "1000": 20 } }, h)).status).toBe(200);
  });

  it("the cash-up reaches the manager, who can sign it off; the cashier cannot sign off their own", async () => {
    const cashier = await as("u-cashier", "1111");
    const manager = await as("u-manager", "2222");
    const s = await open(cashier);
    await close(s, { countedCash: 19000, varianceReason: "Change given wrongly", denominations: { "1000": 19 } }, cashier);
    const seen = (await cashUps(manager)).find((a) => a.cashUp?.shiftId === s);
    expect(seen).toMatchObject({ status: "pending", cashUp: { variance: -1000, reason: "Change given wrongly" } });
    const decide = (h: Record<string, string>) => post(`/api/approvals/${seen!.id}/decision`, { idempotencyKey: uuid(), decision: "approve" }, h);
    expect((await decide(cashier)).status).toBe(403); // creator never signs off
    expect((await decide(manager)).status).toBe(200);
    expect((await cashUps(manager)).find((a) => a.id === seen!.id)?.status).toBe("approved");
  });

  it("a retried close raises only one cash-up; a client cannot raise one itself", async () => {
    const h = await as("u-cashier", "1111");
    const manager = await as("u-manager", "2222");
    const s = await open(h);
    const body = { idempotencyKey: uuid(), shiftId: s, closedAt: new Date().toISOString(), countedCash: 20000 };
    await post("/api/shifts/close", body, h); await post("/api/shifts/close", body, h);
    expect((await cashUps(manager)).filter((a) => a.cashUp?.shiftId === s)).toHaveLength(1);
    const forged = await post("/api/approvals", { idempotencyKey: uuid(), kind: "cash_up", amount: 1, unit: "naira" }, h);
    expect(forged.status).toBe(403);
  });
});

describe("branch summary (A02) and cash-up variance report (G01)", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });

  it("a cashier cannot see branch figures or the variance report", async () => {
    const h = await as("u-cashier", "1111");
    expect((await get("/api/summary", h)).status).toBe(403);
    expect((await get("/api/reports/cashup-variance", h)).status).toBe(403);
  });

  it("the manager sees totals split into cash and credit, and what is waiting for them", async () => {
    const cashier = await as("u-cashier", "1111");
    const manager = await as("u-manager", "2222");
    const before = (await (await get("/api/summary", manager)).json()) as { salesCount: number; cashTotal: number; creditTotal: number; cashUpsAwaiting: number; pendingApprovals: number };
    const shiftId = uuid();
    await post("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 0 }, cashier);
    await post("/api/sales", {
      idempotencyKey: uuid(), clientCreatedAt: new Date().toISOString(), shiftId, customerId: "c1",
      lines: [{ productId: "p1", name: "x", unitPrice: 10000, qty: 1 }], subtotal: 10000, vatMode: "inclusive", vat: 698, total: 10000,
      payments: [{ method: "cash", amount: 4000 }, { method: "credit", amount: 6000 }],
    }, cashier);
    await post("/api/shifts/close", { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 4000 }, cashier);
    const after = (await (await get("/api/summary", manager)).json()) as typeof before;
    expect(after.salesCount - before.salesCount).toBe(1);
    expect(after.cashTotal - before.cashTotal).toBe(4000);
    expect(after.creditTotal - before.creditTotal).toBe(6000);
    expect(after.cashUpsAwaiting - before.cashUpsAwaiting).toBe(1);
    expect(after.pendingApprovals - before.pendingApprovals).toBe(1);
  });

  it("the report lists short cash by cashier, worst first", async () => {
    const cashier = await as("u-cashier", "1111");
    const manager = await as("u-manager", "2222");
    const shiftId = uuid();
    await post("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 10000 }, cashier);
    await post("/api/shifts/close", { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 9000, varianceReason: "Counting error" }, cashier);
    const report = (await (await get("/api/reports/cashup-variance", manager)).json()) as { rows: Array<{ cashierId: string; shortShifts: number; largestShort: number; totalVariance: number }> };
    const row = report.rows.find((r) => r.cashierId === "u-cashier");
    expect(row?.shortShifts).toBeGreaterThanOrEqual(1);
    expect(row?.largestShort).toBeGreaterThanOrEqual(1000);
    expect(report.rows[0]?.totalVariance).toBeLessThanOrEqual(report.rows.at(-1)?.totalVariance ?? 0); // worst (most negative) first
  });
});

describe("who decides is a setting: approval chains from the routing", () => {
  const uuid = () => crypto.randomUUID();
  async function start(routing: Parameters<typeof createMockServer>[0] extends infer O ? (O extends { routing?: infer R } ? R : never) : never) {
    const srv = createMockServer({ routing });
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await p("/api/login", { userId, pin })).json()).token}` });
    const list = async (h: Record<string, string>) => ((await (await fetch(`${b}/api/approvals`, { headers: h })).json()) as { approvals: Array<{ id: string; kind: string; status: string; steps?: Array<{ status: string; roles: string[] }> }> }).approvals;
    const decide = (id: string, h: Record<string, string>, decision: "approve" | "reject" = "approve") =>
      p(`/api/approvals/${id}/decision`, { idempotencyKey: uuid(), decision, reason: decision === "reject" ? "Not acceptable" : undefined }, h);
    const raiseCredit = async (h: Record<string, string>) => {
      const res = await p("/api/approvals", { idempotencyKey: uuid(), kind: "credit_over_limit", amount: 13000, unit: "naira", customerId: "c2" }, h);
      return ((await res.json()) as { approval: { id: string } }).approval.id;
    };
    return { srv, p, as, list, decide, raiseCredit };
  }

  it("a two-step chain: the manager first, then the MD; each step only by its own roles", async () => {
    const t = await start({ credit_over_limit: [{ roles: ["Branch manager"] }, { roles: ["MD / Executive"] }] });
    const [cashier, manager, md] = [await t.as("u-cashier", "1111"), await t.as("u-manager", "2222"), await t.as("u-md", "7777")];
    const id = await t.raiseCredit(cashier);
    expect((await t.decide(id, md)).status).toBe(403); // not the MD's turn yet
    expect((await t.decide(id, manager)).status).toBe(200); // step 1
    const mid = (await t.list(manager)).find((a) => a.id === id)!;
    expect(mid.status).toBe("pending"); // still waiting for step 2
    expect(mid.steps?.map((s) => s.status)).toEqual(["approved", "pending"]);
    expect((await t.decide(id, manager)).status).toBe(403); // the manager cannot also do step 2
    expect((await t.decide(id, md)).status).toBe(200); // step 2
    expect((await t.list(md)).find((a) => a.id === id)?.status).toBe("approved");
    t.srv.close();
  });

  it("a rejection at any step ends the chain", async () => {
    const t = await start({ credit_over_limit: [{ roles: ["Branch manager"] }, { roles: ["MD / Executive"] }] });
    const [cashier, manager, md] = [await t.as("u-cashier", "1111"), await t.as("u-manager", "2222"), await t.as("u-md", "7777")];
    const id = await t.raiseCredit(cashier);
    expect((await t.decide(id, manager, "reject")).status).toBe(200);
    expect((await t.list(md)).find((a) => a.id === id)?.status).toBe("rejected");
    expect((await t.decide(id, md)).status).toBe(400); // already decided
    t.srv.close();
  });

  it("the same person cannot decide two steps, even when their role is allowed in both", async () => {
    const t = await start({ credit_over_limit: [{ roles: ["Branch manager", "MD / Executive"] }, { roles: ["Branch manager", "MD / Executive"] }] });
    const [cashier, manager, md] = [await t.as("u-cashier", "1111"), await t.as("u-manager", "2222"), await t.as("u-md", "7777")];
    const id = await t.raiseCredit(cashier);
    expect((await t.decide(id, manager)).status).toBe(200);
    expect((await t.decide(id, manager)).status).toBe(403); // dual control
    expect((await t.decide(id, md)).status).toBe(200);
    t.srv.close();
  });

  it("changing the setting changes who signs off a cash-up: the Auditor instead of the manager", async () => {
    const t = await start({ cash_up: [{ roles: ["Auditor"] }] });
    const [cashier, manager, auditor] = [await t.as("u-cashier", "1111"), await t.as("u-manager", "2222"), await t.as("u-auditor", "8888")];
    const shiftId = uuid();
    await t.p("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 1000 }, cashier);
    await t.p("/api/shifts/close", { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 1000 }, cashier);
    expect((await t.list(manager)).some((a) => a.kind === "cash_up")).toBe(false); // the manager no longer even sees it
    const mine = (await t.list(auditor)).find((a) => a.kind === "cash_up")!;
    expect(mine).toBeTruthy();
    expect((await t.decide(mine.id, manager)).status).toBe(403);
    expect((await t.decide(mine.id, auditor)).status).toBe(200);
    t.srv.close();
  });
});

describe("returns (T01): refunds need approval, are used once, and follow what was paid", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });
  type Ap = { id: string; status: string; amount: number; limit: number; steps?: Array<{ status: string }>; refund?: { refundTotal: number; invoiceNo: string } };
  const setup = async (payments: Array<{ method: string; amount: number }>, customerId?: string) => {
    const cashier = await as("u-cashier", "1111");
    const shiftId = uuid();
    await post("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 20000 }, cashier);
    const saleKey = uuid();
    const res = await post("/api/sales", {
      idempotencyKey: saleKey, clientCreatedAt: new Date().toISOString(), shiftId, customerId,
      lines: [{ productId: "p1", name: "Phone charger 20W", unitPrice: 6500, qty: 2 }], subtotal: 13000, vatMode: "inclusive", vat: 907, total: 13000, payments,
    }, cashier);
    const sale = ((await res.json()) as { sale: { invoiceNo: string } }).sale;
    return { cashier, shiftId, saleKey, invoiceNo: sale.invoiceNo };
  };
  const ask = (h: Record<string, string>, saleKey: string, lines: Array<{ productId: string; qty: number }>) =>
    post("/api/approvals", { idempotencyKey: uuid(), kind: "refund", amount: 1, unit: "naira", refund: { saleKey, lines, reason: "Faulty charger" } }, h);
  const approve = (id: string, h: Record<string, string>) => post(`/api/approvals/${id}/decision`, { idempotencyKey: uuid(), decision: "approve" }, h);
  const ret = (h: Record<string, string>, ctx: { shiftId: string; saleKey: string }, approvalId: string, lines = [{ productId: "p1", qty: 1 }], key = uuid()) =>
    post("/api/returns", { idempotencyKey: key, clientCreatedAt: new Date().toISOString(), shiftId: ctx.shiftId, saleKey: ctx.saleKey, lines, reason: "Faulty charger", refundMethod: "cash", approvalId }, h);

  it("finds a sale by invoice number; unknown numbers and roles without returns access are refused", async () => {
    const ctx = await setup([{ method: "cash", amount: 13000 }]);
    const found = (await (await get(`/api/sales/lookup?invoiceNo=${ctx.invoiceNo.toLowerCase()}`, ctx.cashier)).json()) as { sale: { invoiceNo: string }; returned: Record<string, number> };
    expect(found.sale.invoiceNo).toBe(ctx.invoiceNo);
    expect(found.returned).toEqual({});
    expect((await get("/api/sales/lookup?invoiceNo=INV-999999", ctx.cashier)).status).toBe(400);
    expect((await get(`/api/sales/lookup?invoiceNo=${ctx.invoiceNo}`, await as("u-rider", "5555"))).status).toBe(403);
  });

  it("the server works out the refund and the limit itself; the client's amount is ignored", async () => {
    const ctx = await setup([{ method: "cash", amount: 13000 }]);
    const res = await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 1 }]);
    const a = ((await res.json()) as { approval: Ap }).approval;
    expect(a).toMatchObject({ status: "pending", amount: 6500, limit: 50000 });
    expect(a.refund).toMatchObject({ refundTotal: 6500, invoiceNo: ctx.invoiceNo });
    expect(a.steps).toHaveLength(2); // the refund is routed through two steps by default
  });

  it("a refund needs BOTH steps; then it is used once; the cash comes out of the drawer", async () => {
    const ctx = await setup([{ method: "cash", amount: 13000 }]);
    const manager = await as("u-manager", "2222");
    const cashCtl = await as("u-cashctl", "9999");
    const id = ((await (await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 1 }])).json()) as { approval: Ap }).approval.id;
    expect((await ret(ctx.cashier, ctx, id)).status).toBe(400); // nobody has approved yet
    expect((await approve(id, manager)).status).toBe(200); // step 1
    expect((await ret(ctx.cashier, ctx, id)).status).toBe(400); // still waiting for step 2
    expect((await approve(id, cashCtl)).status).toBe(200); // step 2
    const key = uuid();
    const done = await ret(ctx.cashier, ctx, id, [{ productId: "p1", qty: 1 }], key);
    expect(done.status).toBe(200);
    expect((await done.json()) as { ret: { refundTotal: number; refundPaid: number; refundToBalance: number } }).toMatchObject({ ret: { refundTotal: 6500, refundPaid: 6500, refundToBalance: 0 } });
    expect(((await (await ret(ctx.cashier, ctx, id, [{ productId: "p1", qty: 1 }], key)).json()) as { duplicate: boolean }).duplicate).toBe(true); // a retry refunds nothing more
    expect((await ret(ctx.cashier, ctx, id)).status).toBe(400); // the approval is single-use
    // closing: expected = 20,000 float + 13,000 cash sale - 6,500 cash refund = 26,500
    const close = await post("/api/shifts/close", { idempotencyKey: uuid(), shiftId: ctx.shiftId, closedAt: new Date().toISOString(), countedCash: 26500 }, ctx.cashier);
    expect(((await close.json()) as { shift: { expectedCash: number; variance: number } }).shift).toMatchObject({ expectedCash: 26500, variance: 0 });
  });

  it("cannot return more than was sold or left, or lines that differ from what was approved", async () => {
    const ctx = await setup([{ method: "cash", amount: 13000 }]);
    expect((await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 3 }])).status).toBe(400); // sold only 2
    expect((await ask(ctx.cashier, ctx.saleKey, [{ productId: "p9", qty: 1 }])).status).toBe(400); // never sold
    const manager = await as("u-manager", "2222"); const cashCtl = await as("u-cashctl", "9999");
    const id = ((await (await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 1 }])).json()) as { approval: Ap }).approval.id;
    await approve(id, manager); await approve(id, cashCtl);
    expect((await ret(ctx.cashier, ctx, id, [{ productId: "p1", qty: 2 }])).status).toBe(400); // approved 1, tried 2
  });

  it("a refund on a part-credit sale first reduces what the customer owes, the rest is paid back", async () => {
    const ctx = await setup([{ method: "cash", amount: 7000 }, { method: "credit", amount: 6000 }], "c1");
    const balance = async () => ((await (await get("/api/customers?q=ade", ctx.cashier)).json()) as { customers: Array<{ balance: number }> }).customers[0]!.balance;
    const before = await balance();
    const manager = await as("u-manager", "2222"); const cashCtl = await as("u-cashctl", "9999");
    const id = ((await (await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 1 }])).json()) as { approval: Ap }).approval.id; // half the sale = 6,500
    await approve(id, manager); await approve(id, cashCtl);
    const done = (await (await ret(ctx.cashier, ctx, id)).json()) as { ret: { refundTotal: number; refundToBalance: number; refundPaid: number } };
    expect(done.ret).toEqual(expect.objectContaining({ refundTotal: 6500, refundToBalance: 3000, refundPaid: 3500 })); // 6000/13000 of the refund was on credit
    expect(before - (await balance())).toBe(3000);
  });

  it("the cashier cannot approve their own refund, and quantities already returned are reported", async () => {
    const ctx = await setup([{ method: "cash", amount: 13000 }]);
    const id = ((await (await ask(ctx.cashier, ctx.saleKey, [{ productId: "p1", qty: 1 }])).json()) as { approval: Ap }).approval.id;
    expect((await approve(id, ctx.cashier)).status).toBe(403);
    const manager = await as("u-manager", "2222"); const cashCtl = await as("u-cashctl", "9999");
    await approve(id, manager); await approve(id, cashCtl); await ret(ctx.cashier, ctx, id);
    const found = (await (await get(`/api/sales/lookup?invoiceNo=${ctx.invoiceNo}`, ctx.cashier)).json()) as { returned: Record<string, number> };
    expect(found.returned).toEqual({ p1: 1 });
  });
});

describe("branch stock request (H02)", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const body = (extra: Record<string, unknown> = {}) => ({ idempotencyKey: uuid(), lines: [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 5 }], note: "Weekend rush", ...extra });

  it("the manager asks for stock; the request names the items and starts as requested", async () => {
    const h = await as("u-manager", "2222");
    const res = await post("/api/stock-requests", body(), h);
    expect(res.status).toBe(200);
    const { request } = (await res.json()) as { request: { id: string; status: string; lines: Array<{ name: string; qty: number }>; note: string } };
    expect(request).toMatchObject({ status: "requested", note: "Weekend rush" });
    expect(request.lines.map((l) => `${l.qty} ${l.name}`)).toEqual(["10 Phone charger 20W", "5 USB-C cable 1m"]);
    const list = (await (await fetch(`${base}/api/stock-requests`, { headers: h })).json()) as { requests: Array<{ id: string }> };
    expect(list.requests.some((r) => r.id === request.id)).toBe(true);
  });

  it("a retried request never raises two", async () => {
    const h = await as("u-manager", "2222");
    const same = body();
    const first = (await (await post("/api/stock-requests", same, h)).json()) as { request: { id: string }; duplicate: boolean };
    const again = (await (await post("/api/stock-requests", same, h)).json()) as { request: { id: string }; duplicate: boolean };
    expect(first.duplicate).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.request.id).toBe(first.request.id);
  });

  it("refuses an empty request, an unknown item, and a role that cannot request stock", async () => {
    const manager = await as("u-manager", "2222");
    expect((await post("/api/stock-requests", body({ lines: [] }), manager)).status).toBe(400);
    expect((await post("/api/stock-requests", body({ lines: [{ productId: "nope", qty: 1 }] }), manager)).status).toBe(400);
    const cashier = await as("u-cashier", "1111");
    expect((await post("/api/stock-requests", body(), cashier)).status).toBe(403);
    expect((await fetch(`${base}/api/stock-requests`, { headers: cashier })).status).toBe(403);
  });
});

describe("transfers (H03/H04): dispatch from the warehouse, count at the branch", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });
  type Tr = { id: string; status: string; shortage: number; lines: Array<{ productId: string; qtySent: number; qtyReceived?: number }>; dispatchedBy: { id: string } };
  const stock = async (h: Record<string, string>, id: string) => ((await (await get("/api/stock", h)).json()) as { levels: Array<{ productId: string; branch: number; warehouse: number }> }).levels.find((l) => l.productId === id)!;
  const request = async (h: Record<string, string>, lines = [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 5 }]) =>
    ((await (await post("/api/stock-requests", { idempotencyKey: uuid(), lines }, h)).json()) as { request: { id: string } }).request.id;
  const dispatch = (h: Record<string, string>, requestId: string, lines = [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 3 }], key = uuid()) =>
    post("/api/transfers", { idempotencyKey: key, requestId, lines }, h);
  const receive = (h: Record<string, string>, id: string, lines: Array<{ productId: string; qty: number }>, key = uuid()) =>
    post(`/api/transfers/${id}/receive`, { idempotencyKey: key, lines }, h);

  it("the warehouse sends what the branch asked for (or less); warehouse stock drops once, even on a retry", async () => {
    const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
    const before = await stock(wh, "p1");
    const req = await request(manager);
    const key = uuid();
    const res = await dispatch(wh, req, [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 3 }], key); // 3 of 5 cables
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: Tr };
    expect(transfer).toMatchObject({ status: "in_transit", shortage: 0 });
    expect(((await (await dispatch(wh, req, [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 3 }], key)).json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect(before.warehouse - (await stock(wh, "p1")).warehouse).toBe(10); // taken once
    expect((await dispatch(wh, req)).status).toBe(400); // the request is already dispatched
  });

  it("cannot send more than was asked, more than the warehouse holds, or dispatch your own request", async () => {
    const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
    const req = await request(manager, [{ productId: "p7", qty: 40 }]); // the warehouse holds 36 of p7
    expect((await dispatch(wh, req, [{ productId: "p7", qty: 41 }])).status).toBe(400); // more than asked
    expect((await dispatch(wh, req, [{ productId: "p7", qty: 40 }])).status).toBe(400); // more than the warehouse has
    expect((await dispatch(manager, req, [{ productId: "p7", qty: 10 }])).status).toBe(403); // dual control: not your own request
    expect((await dispatch(await as("u-cashier", "1111"), req, [{ productId: "p7", qty: 10 }])).status).toBe(403); // no warehouse rights
  });

  it("the branch counts what arrived: a shortage is flagged, stock is added once, and the dispatcher cannot receive their own", async () => {
    const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
    const req = await request(manager);
    const { transfer } = (await (await dispatch(wh, req)).json()) as { transfer: Tr };
    const shelfBefore = (await stock(manager, "p1")).branch;
    expect((await receive(wh, transfer.id, [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 3 }])).status).toBe(403); // someone else must receive
    expect((await receive(manager, transfer.id, [{ productId: "p1", qty: 11 }, { productId: "p2", qty: 3 }])).status).toBe(400); // more than sent
    const key = uuid();
    const done = await receive(manager, transfer.id, [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 2 }], key); // one cable short
    expect(done.status).toBe(200);
    expect(((await done.json()) as { transfer: Tr }).transfer).toMatchObject({ status: "received", shortage: 1 });
    expect(((await (await receive(manager, transfer.id, [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 2 }], key)).json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect((await stock(manager, "p1")).branch - shelfBefore).toBe(10); // added once
    expect((await receive(manager, transfer.id, [{ productId: "p1", qty: 1 }])).status).toBe(400); // already received
    const list = (await (await get("/api/transfers", manager)).json()) as { transfers: Tr[] };
    expect(list.transfers.find((x) => x.id === transfer.id)?.status).toBe("received");
  });

  it("an item left out of the count counts as none received", async () => {
    const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
    const { transfer } = (await (await dispatch(wh, await request(manager))).json()) as { transfer: Tr };
    const done = (await (await receive(manager, transfer.id, [{ productId: "p1", qty: 10 }])).json()) as { transfer: Tr };
    expect(done.transfer.shortage).toBe(3); // the 3 cables were never counted
  });

  it("stock lookup shows shelf and warehouse quantities, and only to roles with warehouse access", async () => {
    const wh = await as("u-warehouse", "3333");
    const found = (await (await get("/api/stock?q=20W", wh)).json()) as { levels: Array<{ name: string; branch: number; warehouse: number; branches: Record<string, number> }> };
    expect(found.levels).toHaveLength(1);
    expect(found.levels[0]).toMatchObject({ name: "Phone charger 20W" });
    expect(found.levels[0]!.warehouse).toBeGreaterThan(0);
    expect(found.levels[0]!.branches).toMatchObject({ "Victoria Island Branch": 10 });
    expect((await get("/api/stock", await as("u-cashier", "1111"))).status).toBe(403);
  });
});

describe("branch-to-branch stock request: a sister branch can fulfill a request too", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });
  type Req = { id: string; status: string; fromBranch?: string };
  type Tr = { id: string; status: string; fromBranch?: string; lines: Array<{ productId: string; qtySent: number }> };
  const stockOf = async (h: Record<string, string>, id: string) => ((await (await get("/api/stock", h)).json()) as { levels: Array<{ productId: string; branches: Record<string, number> }> }).levels.find((l) => l.productId === id)!;
  const request = (h: Record<string, string>, body: Record<string, unknown>) => post("/api/stock-requests", { idempotencyKey: uuid(), lines: [{ productId: "p3", qty: 5 }], ...body }, h);
  const dispatch = (h: Record<string, string>, requestId: string, lines: Array<{ productId: string; qty: number }>) => post("/api/transfers", { idempotencyKey: uuid(), requestId, lines }, h);

  it("lists sister branches to ask, excluding the caller's own", async () => {
    const manager = await as("u-manager", "2222");
    expect(((await (await get("/api/branches", manager)).json()) as { branches: string[] }).branches).toEqual(["Victoria Island Branch"]);
    const sister = await as("u-warehouse2", "3334");
    expect(((await (await get("/api/branches", sister)).json()) as { branches: string[] }).branches).toEqual([]);
  });

  it("refuses a request from your own branch or an unknown one", async () => {
    const manager = await as("u-manager", "2222");
    expect((await request(manager, { fromBranch: "Pilot Branch" })).status).toBe(400);
    expect((await request(manager, { fromBranch: "Nowhere Branch" })).status).toBe(400);
  });

  it("only someone at the sister branch can send its stock, drawn from that branch's own pool, not the warehouse", async () => {
    const manager = await as("u-manager", "2222");
    const sister = await as("u-warehouse2", "3334");
    const wh = await as("u-warehouse", "3333");
    const before = await stockOf(manager, "p3");
    const { request: req } = (await (await request(manager, { fromBranch: "Victoria Island Branch" })).json()) as { request: Req };
    expect(req.fromBranch).toBe("Victoria Island Branch");
    expect((await dispatch(wh, req.id, [{ productId: "p3", qty: 5 }])).status).toBe(403); // the central warehouse cannot send a sister branch's stock
    expect((await dispatch(sister, req.id, [{ productId: "p3", qty: 16 }])).status).toBe(400); // more than Victoria Island Branch holds (15)
    const res = await dispatch(sister, req.id, [{ productId: "p3", qty: 5 }]);
    expect(res.status).toBe(200);
    const { transfer } = (await res.json()) as { transfer: Tr };
    expect(transfer).toMatchObject({ status: "in_transit", fromBranch: "Victoria Island Branch", lines: [{ productId: "p3", qtySent: 5 }] });
    expect((await stockOf(manager, "p3")).branches["Victoria Island Branch"]).toBe(before.branches["Victoria Island Branch"]! - 5);
  });

  it("a warehouse-bound request can only be sent by someone tied to the warehouse", async () => {
    const manager = await as("u-manager", "2222");
    const { request: req } = (await (await request(manager, {})).json()) as { request: Req };
    const sister = await as("u-warehouse2", "3334");
    expect((await dispatch(sister, req.id, [{ productId: "p3", qty: 1 }])).status).toBe(403); // not tied to the warehouse
  });
});

describe("goods receipt (H01): receiving from a supplier against a purchase order", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });
  type Po = { id: string; status: string; lines: Array<{ productId: string; qtyOrdered: number; qtyReceived: number }> };
  const stock = async (h: Record<string, string>, id: string) => ((await (await get("/api/stock", h)).json()) as { levels: Array<{ productId: string; warehouse: number }> }).levels.find((l) => l.productId === id)!;
  const receiveGoods = (h: Record<string, string>, id: string, lines: Array<{ productId: string; qty: number }>, note?: string, key = uuid()) =>
    post(`/api/purchase-orders/${id}/receive`, { idempotencyKey: key, lines, note }, h);

  it("lists purchase orders waiting to be received, only to roles with warehouse access", async () => {
    const wh = await as("u-warehouse", "3333");
    const list = (await (await get("/api/purchase-orders", wh)).json()) as { purchaseOrders: Po[] };
    expect(list.purchaseOrders.map((p) => p.id)).toContain("PO-0001");
    expect((await get("/api/purchase-orders", await as("u-cashier", "1111"))).status).toBe(403);
  });

  it("refuses more than the order allows, an item not on the order, and leaving a line out", async () => {
    const wh = await as("u-warehouse", "3333");
    expect((await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 51 }, { productId: "p2", qty: 0 }])).status).toBe(400); // over the order, no allowance configured
    expect((await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 10 }]))).toMatchObject({ status: 400 }); // the cable line was left out
    expect((await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 10 }, { productId: "p2", qty: 5 }, { productId: "p9", qty: 1 }])).status).toBe(400); // not on this order
    expect((await receiveGoods(await as("u-cashier", "1111"), "PO-0001", [{ productId: "p1", qty: 1 }, { productId: "p2", qty: 0 }])).status).toBe(403); // no warehouse rights
  });

  it("receives less than ordered, adds warehouse stock once, and the order stays open for the rest", async () => {
    const wh = await as("u-warehouse", "3333");
    const before = await stock(wh, "p1");
    const key = uuid();
    const res = await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 30 }, { productId: "p2", qty: 100 }], "First truck", key);
    expect(res.status).toBe(200);
    const { purchaseOrder } = (await res.json()) as { purchaseOrder: Po };
    expect(purchaseOrder.status).toBe("partially_received");
    expect(purchaseOrder.lines.find((l) => l.productId === "p1")).toMatchObject({ qtyOrdered: 50, qtyReceived: 30 });
    expect(((await (await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 30 }, { productId: "p2", qty: 100 }], "First truck", key)).json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect((await stock(wh, "p1")).warehouse - before.warehouse).toBe(30); // added once
    const second = (await (await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 20 }, { productId: "p2", qty: 0 }])).json()) as { purchaseOrder: Po };
    expect(second.purchaseOrder.status).toBe("received");
    expect((await receiveGoods(wh, "PO-0001", [{ productId: "p1", qty: 1 }])).status).toBe(400); // already fully received
  });

  it("an over-receipt allowance lets a little more than ordered through, still capped", async () => {
    const tolerant = createMockServer({ overReceiptAllowancePercent: 10 });
    await new Promise<void>((r) => tolerant.listen(0, r));
    const tBase = `http://localhost:${(tolerant.address() as AddressInfo).port}`;
    const tPost = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(tBase + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const wh = { authorization: `Bearer ${LoginResponse.parse(await (await tPost("/api/login", { userId: "u-warehouse", pin: "3333" })).json()).token}` };
    // PO-0001's charger line asks for 50; 10% allowance permits up to 55.
    expect((await tPost("/api/purchase-orders/PO-0001/receive", { idempotencyKey: uuid(), lines: [{ productId: "p1", qty: 55 }, { productId: "p2", qty: 100 }] }, wh)).status).toBe(200);
    expect((await tPost("/api/purchase-orders/PO-0001/receive", { idempotencyKey: uuid(), lines: [{ productId: "p1", qty: 1 }] }, wh)).status).toBe(400); // already over what the allowance covers
    tolerant.close();
  });
});

describe("in-transit report (G02): transfers on the road too long", () => {
  it("lists a transfer only after the alert time, oldest first, and drops it once received", async () => {
    let clock = Date.parse("2026-11-02T08:00:00.000Z");
    const srv = createMockServer({ now: () => clock, inTransitAlertHours: 24 });
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await p("/api/login", { userId, pin })).json()).token}` });
    const report = async (h: Record<string, string>) => (await (await fetch(`${b}/api/reports/in-transit`, { headers: h })).json()) as { thresholdHours: number; rows: Array<{ transferId: string; hoursInTransit: number; units: number }> };
    const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
    const req = ((await (await p("/api/stock-requests", { idempotencyKey: crypto.randomUUID(), lines: [{ productId: "p1", qty: 4 }] }, manager)).json()) as { request: { id: string } }).request.id;
    const tr = ((await (await p("/api/transfers", { idempotencyKey: crypto.randomUUID(), requestId: req, lines: [{ productId: "p1", qty: 4 }] }, wh)).json()) as { transfer: { id: string } }).transfer.id;
    clock += 23 * 3_600_000;
    expect((await report(manager)).rows).toHaveLength(0); // only 23 hours
    clock += 2 * 3_600_000;
    const late = await report(manager);
    expect(late.thresholdHours).toBe(24);
    expect(late.rows[0]).toMatchObject({ transferId: tr, hoursInTransit: 25, units: 4 });
    expect((await fetch(`${b}/api/reports/in-transit`, { headers: await as("u-cashier", "1111") })).status).toBe(403);
    await p(`/api/transfers/${tr}/receive`, { idempotencyKey: crypto.randomUUID(), lines: [{ productId: "p1", qty: 4 }] }, manager);
    expect((await report(manager)).rows).toHaveLength(0); // received: no longer on the road
    srv.close();
  });
});

describe("shortage ruling: a shortage is never charged automatically; someone independent decides who bears it", () => {
  const uuid = () => crypto.randomUUID();
  async function start(routing?: Parameters<typeof createMockServer>[0] extends infer O ? (O extends { routing?: infer R } ? R : never) : never) {
    const srv = createMockServer(routing ? { routing } : {});
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const g = (path: string, h: Record<string, string>) => fetch(b + path, { headers: h });
    const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await p("/api/login", { userId, pin })).json()).token}` });
    type Ap = { id: string; kind: string; status: string; amount: number; shortage?: { transferId: string; valueAtCost?: number; bearer?: string; lossId?: string; lines: Array<{ name: string; qtyMissing: number }> } };
    const list = async (h: Record<string, string>) => ((await (await g("/api/approvals", h)).json()) as { approvals: Ap[] }).approvals;
    // a transfer of 10 chargers (cost 4,550 each) received with 2 missing
    const shortTransfer = async (sent = 10, got = 8) => {
      const manager = await as("u-manager", "2222"); const wh = await as("u-warehouse", "3333");
      const req = ((await (await p("/api/stock-requests", { idempotencyKey: uuid(), lines: [{ productId: "p1", qty: sent }] }, manager)).json()) as { request: { id: string } }).request.id;
      const tr = ((await (await p("/api/transfers", { idempotencyKey: uuid(), requestId: req, lines: [{ productId: "p1", qty: sent }] }, wh)).json()) as { transfer: { id: string } }).transfer.id;
      await p(`/api/transfers/${tr}/receive`, { idempotencyKey: uuid(), lines: [{ productId: "p1", qty: got }], note: "Box was open" }, manager);
      return { manager, tr };
    };
    const rule = (h: Record<string, string>, id: string, body: Record<string, unknown>) => p(`/api/approvals/${id}/decision`, { idempotencyKey: uuid(), ...body }, h);
    return { srv, p, g, as, list, shortTransfer, rule };
  }

  it("receiving short opens a ruling for the Auditor or MD; nothing is charged yet", async () => {
    const t = await start();
    const { manager, tr } = await t.shortTransfer();
    const auditor = await t.as("u-auditor", "8888");
    const ruling = (await t.list(auditor)).find((a) => a.kind === "shortage" && a.shortage?.transferId === tr)!;
    expect(ruling).toMatchObject({ status: "pending", amount: 9100 }); // 2 chargers x 4,550 at cost
    expect(ruling.shortage?.lines).toEqual([{ productId: "p1", name: "Phone charger 20W", qtyMissing: 2 }]);
    const summary = (await (await t.g("/api/summary", manager)).json()) as { shortagesCharged: number };
    expect(summary.shortagesCharged).toBe(0);
    t.srv.close();
  });

  it("the branch that received it does not see the cost value, and cannot rule on it", async () => {
    const t = await start();
    const { manager, tr } = await t.shortTransfer();
    const mine = (await t.list(manager)).find((a) => a.kind === "shortage" && a.shortage?.transferId === tr)!;
    expect(mine.amount).toBe(0);
    expect(mine.shortage?.valueAtCost).toBeUndefined();
    expect((await t.rule(manager, mine.id, { decision: "approve", outcome: "branch" })).status).toBe(403); // not their ruling, and they raised it
    t.srv.close();
  });

  it("approving needs a bearer; ruling against the branch books the loss to the branch's figures", async () => {
    const t = await start();
    const { manager, tr } = await t.shortTransfer();
    const auditor = await t.as("u-auditor", "8888");
    const id = (await t.list(auditor)).find((a) => a.shortage?.transferId === tr)!.id;
    expect((await t.rule(auditor, id, { decision: "approve" })).status).toBe(400); // who bears it?
    expect((await t.rule(auditor, id, { decision: "approve", outcome: "branch" })).status).toBe(200);
    const done = (await t.list(auditor)).find((a) => a.id === id)!;
    expect(done).toMatchObject({ status: "approved", shortage: { bearer: "branch" } });
    expect(done.shortage?.lossId).toMatch(/^LS-/);
    const summary = (await (await t.g("/api/summary", manager)).json()) as { shortagesCharged: number };
    expect(summary.shortagesCharged).toBeGreaterThanOrEqual(9100);
    t.srv.close();
  });

  it("ruling against the warehouse or the transport does not charge the branch", async () => {
    const t = await start();
    const { manager } = await t.shortTransfer();
    const before = ((await (await t.g("/api/summary", manager)).json()) as { shortagesCharged: number }).shortagesCharged;
    const { tr } = await t.shortTransfer();
    const auditor = await t.as("u-auditor", "8888");
    const id = (await t.list(auditor)).find((a) => a.shortage?.transferId === tr)!.id;
    expect((await t.rule(auditor, id, { decision: "approve", outcome: "warehouse" })).status).toBe(200);
    const after = ((await (await t.g("/api/summary", manager)).json()) as { shortagesCharged: number }).shortagesCharged;
    expect(after).toBe(before);
    t.srv.close();
  });

  it("a ruling above the Auditor's limit (₦100,000 at cost) needs the MD", async () => {
    const t = await start();
    const { tr } = await t.shortTransfer(40, 0); // 40 chargers missing = 182,000 at cost
    const auditor = await t.as("u-auditor", "8888"); const md = await t.as("u-md", "7777");
    const id = (await t.list(md)).find((a) => a.shortage?.transferId === tr)!.id;
    expect((await t.rule(auditor, id, { decision: "approve", outcome: "branch" })).status).toBe(403); // above the limit
    expect((await t.rule(md, id, { decision: "approve", outcome: "transit" })).status).toBe(200);
    t.srv.close();
  });

  it("rejecting needs a reason and charges nothing; the routing setting decides who rules", async () => {
    const t = await start({ shortage: [{ roles: ["Cash controller"] }] });
    const { manager, tr } = await t.shortTransfer();
    const cashCtl = await t.as("u-cashctl", "9999"); const auditor = await t.as("u-auditor", "8888");
    expect((await t.list(auditor)).some((a) => a.kind === "shortage")).toBe(false); // the Auditor is no longer named
    const id = (await t.list(cashCtl)).find((a) => a.shortage?.transferId === tr)!.id;
    expect((await t.rule(cashCtl, id, { decision: "reject" })).status).toBe(400);
    expect((await t.rule(cashCtl, id, { decision: "reject", reason: "Items found in the other box" })).status).toBe(200);
    expect(((await (await t.g("/api/summary", manager)).json()) as { shortagesCharged: number }).shortagesCharged).toBe(0);
    t.srv.close();
  });

  it("no shortage, no ruling", async () => {
    const t = await start();
    const { tr } = await t.shortTransfer(5, 5);
    expect((await t.list(await t.as("u-auditor", "8888"))).some((a) => a.shortage?.transferId === tr)).toBe(false);
    t.srv.close();
  });
});

describe("physical stock count (K01) and write-off (K02)", () => {
  const uuid = () => crypto.randomUUID();
  const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await post("/api/login", { userId, pin })).json()).token}` });
  const get = (path: string, h: Record<string, string>) => fetch(`${base}${path}`, { headers: h });
  type Ln = { productId: string; counted: number; needsRecount: boolean; expected?: number; difference?: number };
  type Ct = { id: string; status: string; round: number; lines: Ln[]; writeOffApprovalId?: string };
  const stockOf = async (h: Record<string, string>, id: string) => ((await (await get("/api/stock", h)).json()) as { levels: Array<{ productId: string; branch: number }> }).levels.find((l) => l.productId === id)!.branch;
  const submit = (h: Record<string, string>, lines: Array<{ productId: string; counted: number }>, extra: Record<string, unknown> = {}) =>
    post("/api/counts", { idempotencyKey: uuid(), location: "branch", lines, countedAt: new Date().toISOString(), ...extra }, h);
  /** A count of p10 that is `off` away from what the system holds. */
  const countOff = async (off: number) => {
    const ctl = await as("u-stock", "4444");
    const have = await stockOf(ctl, "p10");
    const res = await submit(ctl, [{ productId: "p10", counted: have + off }]);
    return { ctl, have, count: ((await res.json()) as { count: Ct }).count };
  };

  it("the count sheet lists the items with NO quantities (blind), and only to roles that count stock", async () => {
    const ctl = await as("u-stock", "4444");
    const sheet = (await (await get("/api/count-sheet?location=branch", ctl)).json()) as { items: Array<Record<string, unknown>> };
    expect(sheet.items.length).toBeGreaterThan(10);
    expect(Object.keys(sheet.items[0]!).sort()).toEqual(["barcode", "name", "productId", "sku"]);
    expect((await get("/api/count-sheet", await as("u-cashier", "1111"))).status).toBe(403);
  });

  it("a count that matches closes at once; one that differs needs a recount and shows NO expected quantity", async () => {
    const ctl = await as("u-stock", "4444");
    const have = await stockOf(ctl, "p10");
    const exact = ((await (await submit(ctl, [{ productId: "p10", counted: have }])).json()) as { count: Ct }).count;
    expect(exact.status).toBe("closed");
    const { count } = await countOff(-2);
    expect(count.status).toBe("needs_recount");
    expect(count.lines[0]).toMatchObject({ needsRecount: true });
    expect(count.lines[0]!.expected).toBeUndefined(); // blind
    expect(count.lines[0]!.difference).toBeUndefined();
    const listed = ((await (await get("/api/counts", ctl)).json()) as { counts: Ct[] }).counts.find((c) => c.id === count.id)!;
    expect(listed.lines[0]!.expected).toBeUndefined();
  });

  it("the recount must be by a different person, cover every flagged item, and only those", async () => {
    const { ctl, have, count } = await countOff(-2);
    const recount = (h: Record<string, string>, lines: Array<{ productId: string; counted: number }>) => submit(h, lines, { countId: count.id });
    expect((await recount(ctl, [{ productId: "p10", counted: have }])).status).toBe(403); // the same person
    const other = await as("u-warehouse", "3333");
    expect((await recount(other, [{ productId: "p9", counted: 1 }])).status).toBe(400); // not a flagged item
    const done = await recount(other, [{ productId: "p10", counted: have }]); // the recount matches the system: the first count was wrong
    expect(done.status).toBe(200);
    expect(((await done.json()) as { count: Ct }).count).toMatchObject({ status: "closed", round: 2 });
  });

  it("a recount that still differs makes the differences final, and then they are visible", async () => {
    const { have, count } = await countOff(-3);
    const other = await as("u-warehouse", "3333");
    const done = ((await (await submit(other, [{ productId: "p10", counted: have - 3 }], { countId: count.id })).json()) as { count: Ct }).count;
    expect(done.status).toBe("review");
    expect(done.lines[0]).toMatchObject({ expected: have, counted: have - 3, difference: -3 });
  });

  it("retried submissions never count twice", async () => {
    const ctl = await as("u-stock", "4444");
    const key = uuid();
    const body = { idempotencyKey: key, location: "branch", lines: [{ productId: "p10", counted: 1 }], countedAt: new Date().toISOString() };
    const first = (await (await post("/api/counts", body, ctl)).json()) as { count: Ct; duplicate: boolean };
    const again = (await (await post("/api/counts", body, ctl)).json()) as { count: Ct; duplicate: boolean };
    expect([first.duplicate, again.duplicate, again.count.id === first.count.id]).toEqual([false, true, true]);
  });

  it("write-off: needs a finished count with differences; the counter does not see the cost; stock changes only after BOTH approvals", async () => {
    const { have, count } = await countOff(-3);
    const ctl = await as("u-stock", "4444"); const other = await as("u-warehouse", "3333");
    const manager = await as("u-manager", "2222"); const auditor = await as("u-auditor", "8888");
    const ask = (id: string, key = uuid()) => post(`/api/counts/${id}/write-off`, { idempotencyKey: key, note: "Stolen from the shelf" }, ctl);
    expect((await ask(count.id)).status).toBe(400); // still needs a recount
    await submit(other, [{ productId: "p10", counted: have - 3 }], { countId: count.id });
    const key = uuid();
    const res = await ask(count.id, key);
    expect(res.status).toBe(200);
    const { approval } = (await res.json()) as { approval: { id: string; amount: number; writeOff?: { valueAtCost?: number; lines: Array<{ difference: number }> } } };
    expect(approval.amount).toBe(0); // the counter does not see the cost
    expect(approval.writeOff?.valueAtCost).toBeUndefined();
    expect(((await (await ask(count.id, key)).json()) as { duplicate: boolean }).duplicate).toBe(true); // a retry raises no second request
    const seen = ((await (await get("/api/approvals", manager)).json()) as { approvals: Array<{ id: string; amount: number; writeOff?: { valueAtCost?: number } }> }).approvals.find((a) => a.id === approval.id)!;
    expect(seen.writeOff?.valueAtCost).toBe(3 * Math.round(8500 * 0.7)); // approvers see 3 x cost
    const decide = (h: Record<string, string>) => post(`/api/approvals/${approval.id}/decision`, { idempotencyKey: uuid(), decision: "approve" }, h);
    expect((await decide(ctl)).status).toBe(403); // the counter cannot approve their own request
    expect((await decide(manager)).status).toBe(200); // step 1
    expect(await stockOf(ctl, "p10")).toBe(have); // not adjusted yet
    expect((await decide(auditor)).status).toBe(200); // step 2
    expect(await stockOf(ctl, "p10")).toBe(have - 3); // now it matches what was counted
    const done = ((await (await get("/api/counts", ctl)).json()) as { counts: Ct[] }).counts.find((c) => c.id === count.id)!;
    expect(done.status).toBe("adjusted");
  });

  it("a rejected write-off adjusts nothing and closes the count", async () => {
    const { have, count } = await countOff(4);
    const ctl = await as("u-stock", "4444"); const other = await as("u-warehouse", "3333"); const manager = await as("u-manager", "2222");
    await submit(other, [{ productId: "p10", counted: have + 4 }], { countId: count.id });
    const { approval } = (await (await post(`/api/counts/${count.id}/write-off`, { idempotencyKey: uuid() }, ctl)).json()) as { approval: { id: string } };
    expect((await post(`/api/approvals/${approval.id}/decision`, { idempotencyKey: uuid(), decision: "reject", reason: "Recount the whole shelf first" }, manager)).status).toBe(200);
    expect(await stockOf(ctl, "p10")).toBe(have);
    expect(((await (await get("/api/counts", ctl)).json()) as { counts: Ct[] }).counts.find((c) => c.id === count.id)?.status).toBe("closed");
  });

  it("the recount rule is a setting: it can be switched off", async () => {
    const srv = createMockServer({ recountByDifferentPerson: false });
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const ctl = { authorization: `Bearer ${LoginResponse.parse(await (await p("/api/login", { userId: "u-stock", pin: "4444" })).json()).token}` };
    const first = ((await (await p("/api/counts", { idempotencyKey: uuid(), location: "branch", lines: [{ productId: "p10", counted: 1 }], countedAt: "x" }, ctl)).json()) as { count: { id: string } }).count;
    expect((await p("/api/counts", { idempotencyKey: uuid(), location: "branch", countId: first.id, lines: [{ productId: "p10", counted: 2 }], countedAt: "x" }, ctl)).status).toBe(200);
    srv.close();
  });
});

describe("delivery (L01 to L05): assign, prove, hand in the cash, and chase what is outstanding", () => {
  const uuid = () => crypto.randomUUID();
  async function start(opts: Parameters<typeof createMockServer>[0] = {}) {
    const srv = createMockServer(opts);
    await new Promise<void>((r) => srv.listen(0, r));
    const b = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(b + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const g = (path: string, h: Record<string, string>) => fetch(b + path, { headers: h });
    const as = async (userId: string, pin: string) => ({ authorization: `Bearer ${LoginResponse.parse(await (await p("/api/login", { userId, pin })).json()).token}` });
    type Ord = { id: string; status: string; riderId?: string; remitted: boolean; remittanceId?: string; cashCollected?: number; failedReason?: string };
    const orders = async (h: Record<string, string>) => ((await (await g("/api/delivery/orders", h)).json()) as { orders: Ord[] }).orders;
    const assign = (h: Record<string, string>, id: string, riderId: string, key = uuid()) => p(`/api/delivery/orders/${id}/assign`, { idempotencyKey: key, riderId }, h);
    const proof = (h: Record<string, string>, orderId: string, extra: Record<string, unknown>) =>
      p("/api/delivery/proof", { idempotencyKey: uuid(), orderId, outcome: "delivered", at: new Date().toISOString(), ...extra }, h);
    const remit = (h: Record<string, string>, orderIds: string[], key = uuid()) => p("/api/delivery/remit", { idempotencyKey: key, orderIds }, h);
    const decide = (h: Record<string, string>, id: string, decision = "approve", reason?: string) => p(`/api/approvals/${id}/decision`, { idempotencyKey: uuid(), decision, reason }, h);
    return { srv, p, g, as, orders, assign, proof, remit, decide };
  }

  it("a rider sees only their own trips; the coordinator sees every order; others see none", async () => {
    const t = await start();
    const [coord, rider, rider2] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555"), await t.as("u-rider2", "1212")];
    expect((await t.orders(coord)).length).toBe(4);
    expect(await t.orders(rider)).toHaveLength(0);
    await t.assign(coord, "DO-0002", "u-rider");
    expect((await t.orders(rider)).map((o) => o.id)).toEqual(["DO-0002"]);
    expect(await t.orders(rider2)).toHaveLength(0);
    expect((await t.g("/api/delivery/orders", await t.as("u-cashier", "1111"))).status).toBe(403);
    t.srv.close();
  });

  it("only the coordinator assigns; an assignment is safe to retry; a finished order cannot be assigned again", async () => {
    const t = await start();
    const [coord, rider] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555")];
    expect((await t.assign(rider, "DO-0002", "u-rider")).status).toBe(403); // a rider cannot assign
    expect((await t.assign(coord, "DO-0002", "u-nobody")).status).toBe(400);
    const key = uuid();
    expect(((await (await t.assign(coord, "DO-0002", "u-rider", key)).json()) as { duplicate: boolean }).duplicate).toBe(false);
    expect(((await (await t.assign(coord, "DO-0002", "u-rider", key)).json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect((await t.assign(coord, "DO-0002", "u-rider2")).status).toBe(400); // already assigned
    expect(((await (await t.g("/api/delivery/riders", coord)).json()) as { riders: unknown[] }).riders).toHaveLength(2);
    t.srv.close();
  });

  it("proof of delivery: only the assigned rider, once; a prepaid order takes no cash; a cash order must collect the full amount", async () => {
    const t = await start();
    const [coord, rider, rider2] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555"), await t.as("u-rider2", "1212")];
    await t.assign(coord, "DO-0002", "u-rider"); await t.assign(coord, "DO-0001", "u-rider");
    expect((await t.proof(rider2, "DO-0002", {})).status).toBe(403); // not their delivery
    expect((await t.proof(rider, "DO-0002", { cashCollected: 500 })).status).toBe(400); // prepaid: no cash
    expect((await t.proof(rider, "DO-0001", { cashCollected: 10000 })).status).toBe(400); // owes 18,500
    expect((await t.proof(rider, "DO-0001", {})).status).toBe(400); // forgot to enter the cash
    expect((await t.proof(rider, "DO-0001", { cashCollected: 18500, recipient: "Ngozi" })).status).toBe(200);
    const key = uuid();
    const body = { idempotencyKey: key, orderId: "DO-0002", outcome: "delivered", at: new Date().toISOString(), recipient: "Tosin" };
    expect(((await (await t.p("/api/delivery/proof", body, rider)).json()) as { duplicate: boolean }).duplicate).toBe(false);
    expect(((await (await t.p("/api/delivery/proof", body, rider)).json()) as { duplicate: boolean }).duplicate).toBe(true); // a retry records nothing twice
    expect((await t.proof(rider, "DO-0002", {})).status).toBe(400); // already finished
    t.srv.close();
  });

  it("a failed delivery needs a reason, and goes back to the coordinator to be assigned again", async () => {
    const t = await start();
    const [coord, rider, rider2] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555"), await t.as("u-rider2", "1212")];
    await t.assign(coord, "DO-0004", "u-rider");
    expect((await t.proof(rider, "DO-0004", { outcome: "failed" })).status).toBe(400); // no reason
    expect((await t.proof(rider, "DO-0004", { outcome: "failed", failedReason: "Customer not reachable" })).status).toBe(200);
    expect((await t.orders(coord)).find((o) => o.id === "DO-0004")).toMatchObject({ status: "failed", failedReason: "Customer not reachable" });
    expect((await t.assign(coord, "DO-0004", "u-rider2")).status).toBe(200); // try again with another rider
    expect((await t.orders(rider2)).map((o) => o.id)).toEqual(["DO-0004"]);
    t.srv.close();
  });

  it("handing in cash: only own, delivered, cash-on-delivery orders; the rider cannot confirm it; once confirmed it is no longer outstanding", async () => {
    const t = await start();
    const [coord, rider, rider2, manager] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555"), await t.as("u-rider2", "1212"), await t.as("u-manager", "2222")];
    await t.assign(coord, "DO-0001", "u-rider"); await t.assign(coord, "DO-0002", "u-rider"); await t.assign(coord, "DO-0003", "u-rider2");
    await t.proof(rider, "DO-0001", { cashCollected: 18500 }); await t.proof(rider, "DO-0002", {}); await t.proof(rider2, "DO-0003", { cashCollected: 22000 });
    expect((await t.remit(rider, ["DO-0002"])).status).toBe(400); // prepaid: no cash to hand in
    expect((await t.remit(rider, ["DO-0003"])).status).toBe(400); // another rider's cash
    const key = uuid();
    const res = await t.remit(rider, ["DO-0001"], key);
    const { approval } = (await res.json()) as { approval: { id: string; amount: number; remittance: { total: number; riderName: string } } };
    expect(approval).toMatchObject({ amount: 18500, remittance: { total: 18500, riderName: "Chidi Okafor" } });
    expect(((await (await t.remit(rider, ["DO-0001"], key)).json()) as { duplicate: boolean }).duplicate).toBe(true);
    expect((await t.remit(rider, ["DO-0001"])).status).toBe(400); // already waiting for confirmation
    expect((await t.decide(rider, approval.id)).status).toBe(403); // the rider cannot confirm their own cash
    const out = (await (await t.g("/api/delivery/outstanding", coord)).json()) as { riders: Array<{ riderId: string; amount: number }> };
    expect(out.riders.find((r) => r.riderId === "u-rider")?.amount).toBe(18500); // not yet confirmed
    expect((await t.decide(manager, approval.id)).status).toBe(200);
    const after = (await (await t.g("/api/delivery/outstanding", coord)).json()) as { riders: Array<{ riderId: string; amount: number }> };
    expect(after.riders.find((r) => r.riderId === "u-rider")).toBeUndefined();
    expect(after.riders.find((r) => r.riderId === "u-rider2")?.amount).toBe(22000);
    t.srv.close();
  });

  it("a rejected hand-in frees the cash so the rider can hand it in again", async () => {
    const t = await start();
    const [coord, rider, manager] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555"), await t.as("u-manager", "2222")];
    await t.assign(coord, "DO-0001", "u-rider"); await t.proof(rider, "DO-0001", { cashCollected: 18500 });
    const { approval } = (await (await t.remit(rider, ["DO-0001"])).json()) as { approval: { id: string } };
    expect((await t.decide(manager, approval.id, "reject", "Only 15,000 was handed over")).status).toBe(200);
    const freed = (await t.orders(rider)).find((o) => o.id === "DO-0001")!;
    expect(freed.remitted).toBe(false);
    expect(freed.remittanceId).toBeUndefined();
    expect((await t.remit(rider, ["DO-0001"])).status).toBe(200);
    t.srv.close();
  });

  it("outstanding cash goes overdue after the time limit, oldest first, and only the coordinator-level roles see it", async () => {
    let clock = Date.parse("2026-11-02T09:00:00.000Z");
    const t = await start({ now: () => clock, codRemitHours: 24 });
    const [coord, rider] = [await t.as("u-coordinator", "6666"), await t.as("u-rider", "5555")];
    await t.assign(coord, "DO-0001", "u-rider");
    await t.proof(rider, "DO-0001", { cashCollected: 18500, at: new Date(clock).toISOString() });
    const read = async () => ((await (await t.g("/api/delivery/outstanding", coord)).json()) as { thresholdHours: number; riders: Array<{ overdue: boolean; hoursOutstanding: number; orders: number }> });
    expect((await read()).riders[0]).toMatchObject({ overdue: false, hoursOutstanding: 0, orders: 1 });
    clock += 25 * 3_600_000;
    const late = await read();
    expect(late.thresholdHours).toBe(24);
    expect(late.riders[0]).toMatchObject({ overdue: true, hoursOutstanding: 25 });
    expect((await t.g("/api/delivery/outstanding", rider)).status).toBe(403); // a rider cannot see everyone's cash
    t.srv.close();
  });
});

describe("return window: days depend on the product, its category and whether it is faulty", () => {
  const uuid = () => crypto.randomUUID();
  const run = async (productId: string, name: string, price: number, daysLater: number, reason: string) => {
    let clock = Date.now();
    const srv = createMockServer({ now: () => clock });
    await new Promise<void>((r) => srv.listen(0, r));
    const url = `http://localhost:${(srv.address() as AddressInfo).port}`;
    const p = (path: string, body: unknown, h: Record<string, string> = {}) => fetch(url + path, { method: "POST", headers: { "content-type": "application/json", ...h }, body: JSON.stringify(body) });
    const token = LoginResponse.parse(await (await p("/api/login", { userId: "u-cashier", pin: "1111" })).json()).token;
    const h = { authorization: `Bearer ${token}` };
    const shiftId = uuid();
    await p("/api/shifts/open", { idempotencyKey: uuid(), shiftId, openedAt: new Date().toISOString(), openingFloat: 20000 }, h);
    const saleKey = uuid();
    await p("/api/sales", { idempotencyKey: saleKey, clientCreatedAt: new Date().toISOString(), shiftId, lines: [{ productId, name, unitPrice: price, qty: 1 }], subtotal: price, vatMode: "inclusive", vat: Math.round((price * 0.075) / 1.075), total: price, payments: [{ method: "cash", amount: price }] }, h);
    clock += daysLater * 86_400_000 + 3_600_000; // an hour into that day: the sale itself was posted a moment after the clock started
    const res = await p("/api/approvals", { idempotencyKey: uuid(), kind: "refund", amount: 1, unit: "naira", refund: { saleKey, lines: [{ productId, qty: 1 }], reason } }, h);
    const body = (await res.json()) as { error?: { message: string } };
    srv.close();
    return { status: res.status, message: body.error?.message ?? JSON.stringify(body) };
  };
  it("accepts a change of mind within the default 7 days and refuses on day 8", async () => {
    expect((await run("p1", "Phone charger 20W", 6500, 7, "Customer changed their mind")).status).toBe(200);
    const late = await run("p1", "Phone charger 20W", 6500, 8, "Customer changed their mind");
    expect(late.status).toBe(400);
    expect(late.message).toContain("7 days");
  });
  it("gives faulty items longer (30 days) and a category its own days (Audio: 3)", async () => {
    expect((await run("p1", "Phone charger 20W", 6500, 20, "Faulty item")).status).toBe(200);
    expect((await run("p1", "Phone charger 20W", 6500, 31, "Faulty item")).status).toBe(400);
    expect((await run("p3", "Bluetooth earbuds", 18500, 4, "Customer changed their mind")).status).toBe(400);
    expect((await run("p3", "Bluetooth earbuds", 18500, 4, "Faulty item")).status).toBe(200);
  });
});
