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
    for (let i = 0; i < 5; i++) await post("/api/login", { userId: "u-rider", pin: "0000" });
    const res = await post("/api/login", { userId: "u-rider", pin: "5555" });
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
    const close = { idempotencyKey: uuid(), shiftId, closedAt: new Date().toISOString(), countedCash: 35500 };
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
