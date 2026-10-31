import http from "node:http";
import TENANT_JSON from "@erp/tenant-config/tenant.json" with { type: "json" };
import { randomUUID } from "node:crypto";
import {
  ApprovalDecisionInput, CreateApprovalInput, AssignInput, CountSubmitInput, CreateStockRequestInput, GoodsReceiptInput, ProofInput, RemitInput, DispatchInput, ReceiveInput, WriteOffRequestInput, ReturnInput, refundFor, CreatePurchaseOrderInput, InspectReturnInput, CreateOrderInput, type SalesOrder, MixupCorrectionInput, type MixupCorrection, returnDaysFor, daysSince, type ReturnRules, LoginRequest, PrintLogInput, SaleInput, ShiftCloseInput, ShiftOpenInput,
  cashOf, computeTotals, creditOf, discountAmount,
  type ApiError, type Approval, type Capabilities, type Customer, type Product, type PurchaseOrder, type ReturnRecord, type Sale, type DeliveryOrder, type StockCount, type StockRequest, type Transfer, type Shift, type VatMode,
} from "@erp/api-contract";
import { APPROVAL_ROUTING, approvalThreshold, areasForRoles, can, currentStep, decidedEarlier, mayApproveKind, mayDecideApproval, mayViewApproval, stepsFor, withinApprovalLimitFor, type ApprovalRouting } from "@erp/permissions";
import { APPROVALS, BRANCH_STOCK, COST_PRICE, DELIVERY_ORDERS, CUSTOMERS, PRODUCTS, PURCHASE_ORDERS, TASKS, USERS, type MockUser } from "./fixtures";

export interface MockOptions { latencyMs?: number; vatRate?: number; vatMode?: VatMode; /** Who decides each kind of approval; defaults to data/approval-routing.json. */ routing?: ApprovalRouting; /** Clock for tests, in milliseconds. */ now?: () => number; /** Hours before a transfer in transit is reported. */ inTransitAlertHours?: number; /** Items that differ must be recounted by someone other than the first counter. */ recountByDifferentPerson?: boolean; /** Hours before collected delivery cash that has not been handed in is overdue. */ codRemitHours?: number; /** Days a return is accepted, by product, category and reason. Defaults to the tenant settings. */ returnRules?: ReturnRules; /** Extra percentage over a purchase order's ordered quantity that a goods receipt may still accept. */ overReceiptAllowancePercent?: number }

/**
 * Stand-in for ERPNext until the adapter exists. It deliberately includes the awkward cases:
 * wrong PIN, forbidden, unavailable (header x-mock-fail), latency and unknown routes.
 */
const DEVICE_BRANCH = "Pilot Branch";
/** Everything a person is allowed to do comes from their roles: the one they were hired for, plus any they were given. */
const rolesOf = (u: MockUser) => [u.role, ...(u.extraRoles ?? [])];
const TENANT = TENANT_JSON as unknown as { returns: { rules: ReturnRules } };

export function createMockServer({ latencyMs = 0, vatRate = 0.075, vatMode = "inclusive", routing = APPROVAL_ROUTING, now = Date.now, inTransitAlertHours = 24, recountByDifferentPerson = true, codRemitHours = 24, returnRules = TENANT.returns.rules, overReceiptAllowancePercent = 0 }: MockOptions = {}) {
  const sessions = new Map<string, MockUser>();
  // In-memory "ERPNext": the idempotency keys make every write safe to retry.
  const products: Product[] = structuredClone(PRODUCTS);
  const customers: Customer[] = structuredClone(CUSTOMERS);
  const sales = new Map<string, Sale>(); // by idempotency key
  const shifts = new Map<string, Shift & { userId: string }>();
  const shiftKeys = new Map<string, string>(); // idempotency key -> shiftId + action
  const printLog = new Set<string>();
  const returns = new Map<string, ReturnRecord>(); // by idempotency key
  const stockRequests = new Map<string, StockRequest>();
  /** Losses ruled against someone. In ERPNext this becomes an approved Stock Entry charged to that party's cost centre. */
  const losses = new Map<string, { id: string; transferId: string; bearer: string; valueAtCost: number; decidedBy: string; decidedAt: string }>();
  /** Warehouse stock. product.stock is the branch (shelf) stock that sales draw from. */
  const warehouseStock: Record<string, number> = Object.fromEntries(PRODUCTS.map((p) => [p.id, p.stock * 3]));
  /** Stock held by sister branches. A request may be addressed to one of these instead of the warehouse. */
  const branchStock: Record<string, Record<string, number>> = structuredClone(BRANCH_STOCK);
  const transfers = new Map<string, Transfer>();
  /** Purchase orders waiting to be received from a supplier (H01). Raising one is a later screen (R01). */
  const purchaseOrders = new Map<string, PurchaseOrder>(structuredClone(PURCHASE_ORDERS).map((po) => [po.id, po]));
  const orders = new Map<string, SalesOrder>();
  const orderKeys = new Map<string, string>(); // idempotency key -> order id
  const mixups = new Map<string, MixupCorrection>(); // by idempotency key
  const inspectionKeys = new Map<string, string>(); // idempotency key -> return number
  const purchaseOrderKeys = new Map<string, string>(); // idempotency key -> purchase order id
  const goodsReceiptKeys = new Map<string, string>(); // idempotency key -> purchase order id
  /** Physical counts. Lines keep the expected quantity on the server; the counter never sees it until the count is final. */
  const counts = new Map<string, StockCount>();
  const countKeys = new Map<string, string>(); // idempotency key -> count id
  const writeOffKeys = new Map<string, string>(); // idempotency key -> approval id
  const stockOf = (loc: "branch" | "warehouse", id: string) => (loc === "branch" ? products.find((p) => p.id === id)?.stock ?? 0 : warehouseStock[id] ?? 0);
  const setStock = (loc: "branch" | "warehouse", id: string, qty: number) => { if (loc === "branch") { const p = products.find((x) => x.id === id); if (p) p.stock = qty; } else warehouseStock[id] = qty; };
  /** The blind view: while items still need a recount, no expected quantity or difference leaves the server. */
  const blind = (c: StockCount): StockCount => (c.status === "needs_recount" ? { ...c, lines: c.lines.map((l) => ({ ...l, expected: undefined, difference: undefined })) } : c);
  /** Deliveries. In ERPNext these are Sales Orders with Delivery Notes and Delivery Trips; proof of delivery is a custom doctype. */
  const deliveries = new Map<string, DeliveryOrder>(structuredClone(DELIVERY_ORDERS).map((o) => [o.id, o]));
  const assignKeys = new Map<string, string>(); // idempotency key -> order id
  const proofKeys = new Map<string, string>();
  const remitKeys = new Map<string, string>(); // idempotency key -> approval id
  const dispatchKeys = new Map<string, string>(); // idempotency key -> transfer id
  const receiveKeys = new Map<string, string>();
  const stockRequestKeys = new Map<string, string>(); // idempotency key -> request id
  /** Quantity already returned per product for one sale. */
  const returnedQty = (saleKey: string) => {
    const out: Record<string, number> = {};
    for (const r of returns.values()) if (r.saleKey === saleKey) for (const l of r.lines) out[l.productId] = (out[l.productId] ?? 0) + l.qty;
    return out;
  };
  const cashRefunds = (shiftId: string) => [...returns.values()].filter((r) => r.shiftId === shiftId && r.refundMethod === "cash").reduce((n, r) => n + r.refundPaid, 0);
  let invoiceSeq = 0;
  let approvalSeq = APPROVALS.length;
  const attempts = new Map<string, number>();
  const approvals = new Map<string, Approval>(structuredClone(APPROVALS).map((a) => [a.id, a]));
  /** Idempotency key -> the decision it already made, so a retry never posts twice. */
  const decisions = new Map<string, { approvalId: string; decision: "approve" | "reject" }>();
  /** Idempotency key -> approval, so raising the same request twice returns the first one. */
  const approvalCreates = new Map<string, string>();
  /** An approved discount may be used by one sale only. */
  const approvalUses = new Map<string, string>();

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const fail = (res: http.ServerResponse, status: number, code: ApiError["code"], message: string) =>
    send(res, status, { code, message } satisfies ApiError);
  const readJson = (req: http.IncomingMessage) =>
    new Promise<unknown>((resolve) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { resolve(undefined); } });
    });
  const caps = (u: MockUser): Capabilities => ({
    user: { id: u.id, name: u.name },
    roles: rolesOf(u),
    areas: areasForRoles(rolesOf(u)),
    scope: { branch: u.branch, warehouse: u.warehouse },
  });
  const auth = (req: http.IncomingMessage) => sessions.get((req.headers.authorization ?? "").replace("Bearer ", ""));

  return http.createServer(async (req, res) => {
    if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
    const url = new URL(req.url ?? "/", "http://mock");
    const injected = req.headers["x-mock-fail"];
    if (injected === "unavailable") return fail(res, 503, "unavailable", "The server is not reachable right now.");
    if (injected === "forbidden") return fail(res, 403, "forbidden", "Your role cannot do this.");

    if (req.method === "GET" && url.pathname === "/api/users") {
      return send(res, 200, { deviceBranch: DEVICE_BRANCH, users: USERS.map(({ id, name, role }) => ({ id, name, role })) });
    }
    if (req.method === "POST" && url.pathname === "/api/login") {
      const parsed = LoginRequest.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Enter your 4-digit PIN.");
      const user = USERS.find((u) => u.id === parsed.data.userId);
      const tries = attempts.get(parsed.data.userId) ?? 0;
      if (tries >= 5) return fail(res, 403, "forbidden", "Too many wrong PINs. Ask your manager to unlock you.");
      if (!user || user.pin !== parsed.data.pin) {
        attempts.set(parsed.data.userId, tries + 1);
        return fail(res, 401, "unauthenticated", "That PIN is not right. Try again.");
      }
      attempts.delete(user.id);
      const token = randomUUID();
      sessions.set(token, user);
      return send(res, 200, { token, capabilities: caps(user) });
    }
    const user = auth(req);
    if (!user) return fail(res, 401, "unauthenticated", "Please sign in again.");
    const canSell = (areasForRoles(rolesOf(user))["Stores (POS)"] ?? "").includes("C");
    /** Cost prices are hidden from most roles: only the people who rule on a shortage or write-off see its value at cost. */
    const hideCost = (a: Approval): Approval => {
      if (a.kind === "shortage" && !mayApproveKind(caps(user), "shortage", routing)) return { ...a, amount: 0, limit: 0, shortage: a.shortage && { ...a.shortage, valueAtCost: undefined } };
      if (a.kind === "write_off" && !mayApproveKind(caps(user), "write_off", routing)) return { ...a, amount: 0, limit: 0, writeOff: a.writeOff && { ...a.writeOff, valueAtCost: undefined } };
      return a;
    };

    if (req.method === "GET" && url.pathname === "/api/products") {
      return send(res, 200, { products, asOf: new Date().toISOString() });
    }
    if (req.method === "GET" && url.pathname === "/api/customers") {
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return send(res, 200, { customers: customers.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q)) });
    }
    if (req.method === "GET" && url.pathname === "/api/shift/current") {
      const open = [...shifts.values()].find((sh) => sh.userId === user.id && sh.status === "open");
      return send(res, 200, { shift: open ? { ...open, userId: undefined } : null });
    }

    if (req.method === "POST" && url.pathname === "/api/shifts/open") {
      if (!canSell) return fail(res, 403, "forbidden", "Your role cannot open a shift.");
      const parsed = ShiftOpenInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Enter the opening float.");
      const existing = shifts.get(parsed.data.shiftId);
      if (existing) return send(res, 200, { shift: { ...existing, userId: undefined }, duplicate: true });
      const shift = { id: parsed.data.shiftId, status: "open" as const, openingFloat: parsed.data.openingFloat, openedAt: parsed.data.openedAt, userId: user.id };
      shifts.set(shift.id, shift);
      return send(res, 200, { shift: { ...shift, userId: undefined }, duplicate: false });
    }
    if (req.method === "POST" && url.pathname === "/api/shifts/close") {
      if (!canSell) return fail(res, 403, "forbidden", "Your role cannot close a shift.");
      const parsed = ShiftCloseInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Enter the counted cash.");
      const shift = shifts.get(parsed.data.shiftId);
      if (!shift || shift.userId !== user.id) return fail(res, 400, "validation", "That shift does not exist.");
      if (shift.status === "closed") return send(res, 200, { shift: { ...shift, userId: undefined }, duplicate: true });
      const cashSales = [...sales.values()].filter((x) => x.shiftId === shift.id).reduce((n, x) => n + cashOf(x.payments), 0); // only cash payments go in the drawer
      const { denominations, varianceReason } = parsed.data;
      if (denominations && Object.entries(denominations).reduce((n, [note, count]) => n + Number(note) * count, 0) !== parsed.data.countedCash) {
        return fail(res, 400, "validation", "The notes counted do not add up to the cash counted.");
      }
      const expectedCash = shift.openingFloat + cashSales - cashRefunds(shift.id);
      const variance = parsed.data.countedCash - expectedCash;
      if (variance !== 0 && !(varianceReason && varianceReason.length >= 3)) return fail(res, 400, "validation", "A cash count that does not match needs a reason.");
      shift.status = "closed"; shift.closedAt = parsed.data.closedAt; shift.countedCash = parsed.data.countedCash;
      shift.expectedCash = expectedCash; shift.variance = variance;
      // Closing a shift raises the cash-up for sign-off by someone else (the cashier never signs off their own count).
      const cashUpId = `AP-${String(++approvalSeq).padStart(4, "0")}`;
      approvals.set(cashUpId, {
        id: cashUpId, kind: "cash_up", status: "pending", amount: Math.abs(variance), limit: 0, unit: "naira",
        requestedBy: { id: user.id, name: user.name }, requestedAt: parsed.data.closedAt, requestNote: varianceReason, steps: stepsFor("cash_up", routing),
        cashUp: { shiftId: shift.id, cashierName: user.name, expected: expectedCash, counted: parsed.data.countedCash, variance, reason: varianceReason, denominations },
      });
      return send(res, 200, { shift: { ...shift, userId: undefined }, duplicate: false });
    }
    if (req.method === "POST" && url.pathname === "/api/sales") {
      if (!canSell) return fail(res, 403, "forbidden", "Your role cannot record sales.");
      const parsed = SaleInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "The sale is incomplete.");
      const input = parsed.data;
      const seen = sales.get(input.idempotencyKey);
      if (seen) return send(res, 200, { sale: seen, duplicate: true }); // a retry never posts twice
      // The server is the authority on totals: it recomputes from the lines, any approved discount and its own VAT settings.
      const gross = input.lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);
      let discount = 0;
      if (input.discountApprovalId) {
        const approval = approvals.get(input.discountApprovalId);
        if (!approval || approval.kind !== "discount" || approval.status !== "approved") {
          return fail(res, 400, "validation", "The discount approval is missing or not approved.");
        }
        if (approval.requestedBy.id !== user.id) return fail(res, 400, "validation", "That discount belongs to another cashier.");
        const usedBy = approvalUses.get(approval.id);
        if (usedBy && usedBy !== input.idempotencyKey) return fail(res, 400, "validation", "That discount approval has already been used.");
        discount = discountAmount(gross, approval.amount);
      }
      const expected = computeTotals(gross - discount, vatMode, vatRate);
      if (input.vatMode !== vatMode || input.subtotal !== gross || input.vat !== expected.vat || input.total !== expected.total) {
        return fail(res, 400, "validation", "The sale total or VAT does not match the lines, the discount and the VAT settings.");
      }
      if (input.payments.reduce((n, p) => n + p.amount, 0) !== input.total) return fail(res, 400, "validation", "The payments do not add up to the total.");
      const onCredit = creditOf(input.payments);
      let creditCustomer: Customer | undefined;
      let creditApproval: Approval | undefined;
      if (onCredit > 0) {
        // Credit is billed to a credit partner when one is named, otherwise to the customer.
        const accountId = input.billToId ?? input.customerId;
        creditCustomer = customers.find((c) => c.id === accountId);
        if (input.billToId && creditCustomer?.kind !== "partner") return fail(res, 400, "validation", "Only a credit partner can be billed instead of the customer.");
        if (!accountId || !creditCustomer) return fail(res, 400, "validation", "A credit sale needs a customer.");
        if (creditCustomer.creditLimit === undefined) return fail(res, 400, "validation", `${creditCustomer.name} has no credit terms.`);
        const over = (creditCustomer.balance ?? 0) + onCredit > creditCustomer.creditLimit;
        if (input.creditApprovalId) {
          const approval = approvals.get(input.creditApprovalId);
          if (!approval || approval.kind !== "credit_over_limit" || approval.status !== "approved") {
            return fail(res, 400, "validation", "The credit approval is missing or not approved.");
          }
          if (approval.requestedBy.id !== user.id) return fail(res, 400, "validation", "That credit approval belongs to another cashier.");
          if (approval.customerId !== creditCustomer.id) return fail(res, 400, "validation", "That credit approval is for another customer.");
          if (onCredit > approval.amount) return fail(res, 400, "validation", "The credit approval does not cover this sale.");
          const usedBy = approvalUses.get(approval.id);
          if (usedBy && usedBy !== input.idempotencyKey) return fail(res, 400, "validation", "That credit approval has already been used.");
          creditApproval = approval;
        } else if (over) {
          return fail(res, 400, "validation", `${creditCustomer.name} would go over the credit limit. A manager must approve.`);
        }
      }
      let order: SalesOrder | undefined;
      if (input.orderId) {
        order = orders.get(input.orderId);
        if (!order) return fail(res, 400, "validation", "That order does not exist.");
        if (order.status !== "open") return fail(res, 400, "validation", order.status === "paid" ? "That order has already been paid." : "That order was cancelled.");
        const same = order.lines.length === input.lines.length && input.lines.every((l) => order!.lines.some((o) => o.productId === l.productId && o.qty === l.qty));
        if (!same) return fail(res, 400, "validation", "The sale does not match the order. Start again from the order.");
      }
      const shift = shifts.get(input.shiftId);
      if (!shift || shift.userId !== user.id) return fail(res, 400, "validation", "This sale belongs to a shift that was never opened.");
      if (shift.status !== "open") return fail(res, 400, "validation", "This sale belongs to a shift that is already closed.");
      for (const l of input.lines) { const p = products.find((x) => x.id === l.productId); if (p) p.stock -= l.qty; }
      if (creditCustomer) creditCustomer.balance = (creditCustomer.balance ?? 0) + onCredit; // receivable recorded once, by key
      const sale: Sale = {
        ...input, invoiceNo: `INV-${String(++invoiceSeq).padStart(6, "0")}`,
        cashier: { id: user.id, name: user.name }, postedAt: new Date().toISOString(),
      };
      sales.set(input.idempotencyKey, sale);
      if (order) Object.assign(order, { status: "paid", invoiceNo: sale.invoiceNo, paidAt: sale.postedAt });
      if (input.discountApprovalId) approvalUses.set(input.discountApprovalId, input.idempotencyKey);
      if (creditApproval) approvalUses.set(creditApproval.id, input.idempotencyKey);
      return send(res, 200, { sale, duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/sales/lookup") {
      if (!can(caps(user), "Returns", "V")) return fail(res, 403, "forbidden", "Your role cannot look up sales for returns.");
      const invoiceNo = (url.searchParams.get("invoiceNo") ?? "").trim().toUpperCase();
      const sale = [...sales.values()].find((x) => x.invoiceNo === invoiceNo);
      if (!sale) return fail(res, 400, "validation", "No sale found with that invoice number.");
      return send(res, 200, { sale, returned: returnedQty(sale.idempotencyKey) });
    }
    if (req.method === "POST" && url.pathname === "/api/returns") {
      if (!can(caps(user), "Returns", "C")) return fail(res, 403, "forbidden", "Your role cannot record returns.");
      const parsed = ReturnInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "The return is incomplete.");
      const input = parsed.data;
      const seen = returns.get(input.idempotencyKey);
      if (seen) return send(res, 200, { ret: seen, duplicate: true }); // a retry never refunds twice
      const sale = sales.get(input.saleKey);
      if (!sale) return fail(res, 400, "validation", "That sale does not exist.");
      const shift = shifts.get(input.shiftId);
      if (!shift || shift.userId !== user.id || shift.status !== "open") return fail(res, 400, "validation", "A return is recorded in your open shift.");
      const already = returnedQty(input.saleKey);
      for (const l of input.lines) {
        const sold = sale.lines.find((x) => x.productId === l.productId);
        if (!sold || l.qty > sold.qty - (already[l.productId] ?? 0)) return fail(res, 400, "validation", "More was selected than was sold or is left to return.");
      }
      const approval = approvals.get(input.approvalId);
      if (!approval || approval.kind !== "refund" || approval.status !== "approved" || !approval.refund) return fail(res, 400, "validation", "A manager must approve this refund first.");
      if (approval.requestedBy.id !== user.id) return fail(res, 400, "validation", "That approval belongs to another cashier.");
      if (approval.refund.saleKey !== input.saleKey) return fail(res, 400, "validation", "That approval is for another sale.");
      const usedBy = approvalUses.get(approval.id);
      if (usedBy && usedBy !== input.idempotencyKey) return fail(res, 400, "validation", "That approval has already been used.");
      const refund = refundFor(sale, input.lines);
      const sameLines = approval.refund.lines.length === input.lines.length && input.lines.every((l) => approval.refund!.lines.some((a) => a.productId === l.productId && a.qty === l.qty));
      if (!sameLines || refund.total !== approval.refund.refundTotal) return fail(res, 400, "validation", "The return does not match the approved request.");
      // Money that was owed on credit is taken off what the customer owes; the rest is paid back by the chosen method.
      const customer = customers.find((c) => c.id === sale.customerId);
      const credit = creditOf(sale.payments);
      const toBalance = customer && credit > 0 ? Math.min(Math.round((refund.total * credit) / sale.total), customer.balance ?? 0) : 0;
      if (customer && toBalance > 0) customer.balance = (customer.balance ?? 0) - toBalance;
      const ret: ReturnRecord = {
        ...input, returnNo: `RET-${String(returns.size + 1).padStart(6, "0")}`, invoiceNo: sale.invoiceNo, refundTotal: refund.total,
        refundToBalance: toBalance, refundPaid: refund.total - toBalance, cashier: { id: user.id, name: user.name }, postedAt: new Date().toISOString(),
        faulty: returnRules.faultyReasons.includes(input.reason),
      };
      // A faulty item waits in a check area for an inspector. Anything else goes straight back on the shelf.
      if (ret.faulty) ret.inspection = { status: "pending" };
      else for (const l of input.lines) { const p = products.find((x) => x.id === l.productId); if (p) p.stock += l.qty; }
      returns.set(input.idempotencyKey, ret);
      approvalUses.set(approval.id, input.idempotencyKey);
      return send(res, 200, { ret, duplicate: false });
    }
    // Branches a request can be sent to instead of the warehouse (H02).
    if (req.method === "GET" && url.pathname === "/api/branches") {
      if (!can(caps(user), "Warehouse", "V")) return fail(res, 403, "forbidden", "Your role cannot see other branches.");
      return send(res, 200, { branches: Object.keys(branchStock).filter((b) => b !== user.branch) });
    }
    // Orders built on the floor (S06) and picked up by a cashier, who pays for them at the till.
    if (req.method === "GET" && url.pathname === "/api/orders") {
      if (!can(caps(user), "Stores (POS)", "V")) return fail(res, 403, "forbidden", "Your role cannot see orders.");
      return send(res, 200, { orders: [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    if (req.method === "POST" && url.pathname === "/api/orders") {
      if (!can(caps(user), "Stores (POS)", "C")) return fail(res, 403, "forbidden", "You have not been given permission to build orders.");
      const parsed = CreateOrderInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Add at least one item with a quantity.");
      const input = parsed.data;
      const seenId = orderKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { order: orders.get(seenId), duplicate: true }); // a retry never makes two orders
      const customer = input.customerId ? customers.find((c) => c.id === input.customerId) : undefined;
      if (input.customerId && !customer) return fail(res, 400, "validation", "That customer does not exist.");
      const lines = [];
      for (const l of input.lines) {
        const product = products.find((p) => p.id === l.productId);
        if (!product) return fail(res, 400, "validation", "One of the items does not exist.");
        if (l.qty > product.stock) return fail(res, 400, "validation", `Only ${product.stock} of ${product.name} in stock.`);
        lines.push({ productId: product.id, name: product.name, unitPrice: product.price, qty: l.qty });
      }
      const order: SalesOrder = {
        id: `SO-${String(orders.size + 1).padStart(4, "0")}`, status: "open", lines, customerId: customer?.id, customerName: customer?.name,
        note: input.note || undefined, createdBy: { id: user.id, name: user.name }, createdAt: new Date(now()).toISOString(),
      };
      orders.set(order.id, order);
      orderKeys.set(input.idempotencyKey, order.id);
      return send(res, 200, { order, duplicate: false });
    }
    const cancelOrder = req.method === "POST" && url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
    if (cancelOrder) {
      const order = orders.get(decodeURIComponent(cancelOrder[1] ?? ""));
      if (!order) return fail(res, 400, "validation", "That order does not exist.");
      if (order.createdBy.id !== user.id && !can(caps(user), "Stores (POS)", "A")) return fail(res, 403, "forbidden", "Only the person who built the order, or a manager, can cancel it.");
      if (order.status === "cancelled") return send(res, 200, { order, duplicate: true });
      if (order.status === "paid") return fail(res, 400, "validation", "That order has already been paid.");
      order.status = "cancelled";
      order.cancelledAt = new Date(now()).toISOString();
      return send(res, 200, { order, duplicate: false });
    }
    // Fix a wrong-variant sale (Scenario 13). A manager (anyone holding the Approve permission on the till) makes the correction.
    if (req.method === "POST" && url.pathname === "/api/sales/correct-variant") {
      if (!can(caps(user), "Stores (POS)", "A")) return fail(res, 403, "forbidden", "You have not been given permission to fix a sale.");
      const parsed = MixupCorrectionInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Choose the two items, how many, how the difference was settled, and give a reason.");
      const input = parsed.data;
      const seen = mixups.get(input.idempotencyKey);
      if (seen) return send(res, 200, { correction: seen, duplicate: true }); // a retry never moves stock twice
      const sale = sales.get(input.saleKey);
      if (!sale) return fail(res, 400, "validation", "That sale does not exist.");
      if (sale.cashier.id === user.id) return fail(res, 403, "forbidden", "Someone else must fix a sale you made.");
      const sold = sale.lines.find((l) => l.productId === input.wrongProductId);
      const wrong = products.find((p) => p.id === input.wrongProductId);
      const right = products.find((p) => p.id === input.rightProductId);
      if (!sold || !wrong || !right || wrong.id === right.id) return fail(res, 400, "validation", "Choose the item that was sold and a different item that was really taken.");
      if (!wrong.family || wrong.family !== right.family) return fail(res, 400, "validation", "Only another version of the same item (for example another colour) can be swapped.");
      const alreadyFixed = [...mixups.values()].filter((m) => m.saleKey === input.saleKey && m.wrongProductId === input.wrongProductId).reduce((n, m) => n + m.qty, 0);
      if (input.qty > sold.qty - alreadyFixed) return fail(res, 400, "validation", "More was selected than was sold or is left to fix.");
      const difference = (right.price - sold.unitPrice) * input.qty;
      if ((difference > 0 && input.settlement === "refunded") || (difference < 0 && input.settlement === "collected")) return fail(res, 400, "validation", "That does not match the difference: collect what is owed, or pay back what is due.");
      wrong.stock += input.qty; // the till took the wrong one off the shelf: put it back...
      right.stock -= input.qty; // ...and take off the one the customer really has
      const correction: MixupCorrection = {
        ...input, id: `MX-${String(mixups.size + 1).padStart(4, "0")}`, invoiceNo: sale.invoiceNo, wrongName: wrong.name, rightName: right.name,
        difference, soldBy: sale.cashier, fixedBy: { id: user.id, name: user.name }, fixedAt: new Date(now()).toISOString(),
      };
      mixups.set(input.idempotencyKey, correction);
      return send(res, 200, { correction, duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/reports/mixups") {
      if (!can(caps(user), "Stores (POS)", "A") && !can(caps(user), "Stock control", "V")) return fail(res, 403, "forbidden", "Your role cannot see this report.");
      const corrections = [...mixups.values()].sort((a, b) => b.fixedAt.localeCompare(a.fixedAt));
      const byCashier = new Map<string, { cashier: { id: string; name: string }; count: number; units: number; netDifference: number }>();
      for (const m of corrections) {
        const row = byCashier.get(m.soldBy.id) ?? { cashier: m.soldBy, count: 0, units: 0, netDifference: 0 };
        row.count += 1; row.units += m.qty; row.netDifference += m.difference;
        byCashier.set(m.soldBy.id, row);
      }
      return send(res, 200, { rows: [...byCashier.values()].sort((a, b) => b.count - a.count), corrections });
    }
    // Faulty returns waiting in the check area. Whoever holds the Stock control permission can inspect (a Stock controller,
    // a stock officer, the Auditor or a manager; the permission can be given to anyone).
    if (req.method === "GET" && url.pathname === "/api/returns/inspections") {
      if (!can(caps(user), "Stock control", "V")) return fail(res, 403, "forbidden", "Your role cannot see returns waiting for inspection.");
      const list = [...returns.values()].filter((r) => r.inspection).sort((a, b) => b.postedAt.localeCompare(a.postedAt));
      return send(res, 200, { returns: list });
    }
    const inspectRoute = req.method === "POST" && url.pathname.match(/^\/api\/returns\/([^/]+)\/inspect$/);
    if (inspectRoute) {
      if (!can(caps(user), "Stock control", "C")) return fail(res, 403, "forbidden", "You have not been given permission to inspect returns.");
      const parsed = InspectReturnInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Choose what happens to the item.");
      const input = parsed.data;
      const ret = [...returns.values()].find((r) => r.returnNo === decodeURIComponent(inspectRoute[1] ?? ""));
      if (!ret?.inspection) return fail(res, 400, "validation", "That return is not waiting for inspection.");
      if (inspectionKeys.get(input.idempotencyKey) === ret.returnNo) return send(res, 200, { ret, duplicate: true }); // a retry never restocks twice
      if (ret.inspection.status !== "pending") return fail(res, 400, "validation", "That return has already been inspected.");
      if (ret.cashier.id === user.id) return fail(res, 403, "forbidden", "Someone else must inspect a return you took.");
      if (input.outcome === "restock") for (const l of ret.lines) { const p = products.find((x) => x.id === l.productId); if (p) p.stock += l.qty; }
      ret.inspection = { status: input.outcome === "restock" ? "restocked" : "rma", by: { id: user.id, name: user.name }, at: new Date(now()).toISOString(), note: input.note };
      inspectionKeys.set(input.idempotencyKey, ret.returnNo);
      return send(res, 200, { ret, duplicate: false });
    }
    // Branch stock requests (H02): the branch asks the warehouse, or a sister branch, for stock.
    if (req.method === "GET" && url.pathname === "/api/stock-requests") {
      if (!can(caps(user), "Warehouse", "V")) return fail(res, 403, "forbidden", "Your role cannot see stock requests.");
      return send(res, 200, { requests: [...stockRequests.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)) });
    }
    if (req.method === "POST" && url.pathname === "/api/stock-requests") {
      if (!can(caps(user), "Warehouse", "C")) return fail(res, 403, "forbidden", "Your role cannot request stock.");
      const parsed = CreateStockRequestInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Add at least one item with a quantity.");
      const input = parsed.data;
      const existing = stockRequestKeys.get(input.idempotencyKey);
      if (existing) return send(res, 200, { request: stockRequests.get(existing), duplicate: true }); // a retry never raises two requests
      if (input.fromBranch) {
        if (input.fromBranch === user.branch) return fail(res, 400, "validation", "You cannot request stock from your own branch.");
        if (!branchStock[input.fromBranch]) return fail(res, 400, "validation", "That branch does not exist.");
      }
      const lines = [];
      for (const l of input.lines) {
        const product = products.find((p) => p.id === l.productId);
        if (!product) return fail(res, 400, "validation", "One of the items does not exist.");
        lines.push({ productId: product.id, name: product.name, qty: l.qty });
      }
      const request: StockRequest = {
        id: `SR-${String(stockRequests.size + 1).padStart(4, "0")}`, status: "requested", lines, note: input.note,
        requestedBy: { id: user.id, name: user.name }, requestedAt: new Date().toISOString(), fromBranch: input.fromBranch, toBranch: user.branch,
      };
      stockRequests.set(request.id, request);
      stockRequestKeys.set(input.idempotencyKey, request.id);
      return send(res, 200, { request, duplicate: false });
    }
    // Transfers: the warehouse dispatches what a branch asked for; the branch counts what arrived.
    if (req.method === "GET" && url.pathname === "/api/transfers") {
      if (!can(caps(user), "Warehouse", "V")) return fail(res, 403, "forbidden", "Your role cannot see transfers.");
      return send(res, 200, { transfers: [...transfers.values()].sort((a, b) => b.dispatchedAt.localeCompare(a.dispatchedAt)) });
    }
    if (req.method === "POST" && url.pathname === "/api/transfers") {
      if (!can(caps(user), "Warehouse", "C")) return fail(res, 403, "forbidden", "Your role cannot dispatch stock.");
      const parsed = DispatchInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Pick at least one item with a quantity.");
      const input = parsed.data;
      const seenId = dispatchKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { transfer: transfers.get(seenId), duplicate: true }); // a retry never sends stock twice
      const request = stockRequests.get(input.requestId);
      if (!request) return fail(res, 400, "validation", "That stock request does not exist.");
      if (request.status !== "requested") return fail(res, 400, "validation", "That request has already been dispatched.");
      if (request.requestedBy.id === user.id) return fail(res, 403, "forbidden", "You cannot dispatch a request you raised.");
      // A request addressed to a sister branch can only be sent by someone at that branch; a warehouse-bound one, by someone tied to the warehouse.
      if (request.fromBranch ? request.fromBranch !== user.branch : !user.warehouse) {
        return fail(res, 403, "forbidden", request.fromBranch ? "Only someone at that branch can send its stock." : "Only the warehouse can send its stock.");
      }
      const source = request.fromBranch ? (branchStock[request.fromBranch] ??= {}) : warehouseStock;
      const sourceName = request.fromBranch ?? "the warehouse";
      const lines = [];
      for (const l of input.lines) {
        const asked = request.lines.find((x) => x.productId === l.productId);
        if (!asked || l.qty > asked.qty) return fail(res, 400, "validation", "You cannot send more than was asked for.");
        if (l.qty > (source[l.productId] ?? 0)) return fail(res, 400, "validation", `Only ${source[l.productId] ?? 0} of ${asked.name} in ${sourceName}.`);
        lines.push({ productId: l.productId, name: asked.name, qtySent: l.qty });
      }
      for (const l of lines) source[l.productId] = (source[l.productId] ?? 0) - l.qtySent;
      const transfer: Transfer = {
        id: `TR-${String(transfers.size + 1).padStart(4, "0")}`, requestId: request.id, status: "in_transit", lines,
        dispatchedBy: { id: user.id, name: user.name }, dispatchedAt: new Date(now()).toISOString(), shortage: 0, fromBranch: request.fromBranch, toBranch: request.toBranch,
      };
      transfers.set(transfer.id, transfer);
      dispatchKeys.set(input.idempotencyKey, transfer.id);
      request.status = "dispatched";
      return send(res, 200, { transfer, duplicate: false });
    }
    const receiveRoute = req.method === "POST" && url.pathname.match(/^\/api\/transfers\/([^/]+)\/receive$/);
    if (receiveRoute) {
      if (!can(caps(user), "Warehouse", "C")) return fail(res, 403, "forbidden", "Your role cannot receive stock.");
      const parsed = ReceiveInput.safeParse({ ...(await readJson(req) as object), transferId: decodeURIComponent(receiveRoute[1] ?? "") });
      if (!parsed.success) return fail(res, 400, "validation", "Count what arrived.");
      const input = parsed.data;
      const seenId = receiveKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { transfer: transfers.get(seenId), duplicate: true }); // a retry never adds stock twice
      const transfer = transfers.get(input.transferId);
      if (!transfer) return fail(res, 400, "validation", "That transfer does not exist.");
      if (transfer.status !== "in_transit") return fail(res, 400, "validation", "That transfer has already been received.");
      if (transfer.dispatchedBy.id === user.id) return fail(res, 403, "forbidden", "Someone else must receive what you dispatched.");
      // Only the branch the goods are going to can sign for them (its stock officer or its manager).
      if (transfer.toBranch && transfer.toBranch !== user.branch) return fail(res, 403, "forbidden", `Only someone at ${transfer.toBranch} can receive this.`);
      for (const l of input.lines) {
        const sent = transfer.lines.find((x) => x.productId === l.productId);
        if (!sent) return fail(res, 400, "validation", "One of the items is not on this transfer.");
        if (l.qty > sent.qtySent) return fail(res, 400, "validation", `More ${sent.name} was counted than was sent.`);
      }
      let shortage = 0;
      for (const line of transfer.lines) {
        line.qtyReceived = input.lines.find((x) => x.productId === line.productId)?.qty ?? 0; // an item not counted counts as none
        shortage += line.qtySent - line.qtyReceived;
        // The device's own branch keeps its stock on the products; every other branch has its own stock table.
        if (!transfer.toBranch || transfer.toBranch === DEVICE_BRANCH) {
          const product = products.find((p) => p.id === line.productId);
          if (product) product.stock += line.qtyReceived;
        } else {
          const there = (branchStock[transfer.toBranch] ??= {});
          there[line.productId] = (there[line.productId] ?? 0) + line.qtyReceived;
        }
      }
      Object.assign(transfer, { status: "received", receivedBy: { id: user.id, name: user.name }, receivedAt: new Date(now()).toISOString(), shortage, receiveNote: input.note });
      receiveKeys.set(input.idempotencyKey, transfer.id);
      const request = transfer.requestId ? stockRequests.get(transfer.requestId) : undefined;
      if (request) request.status = "received";
      if (shortage > 0) {
        // A shortage is never charged automatically: it opens a ruling for someone independent of the branch.
        const missing = transfer.lines.filter((l) => l.qtySent > (l.qtyReceived ?? 0)).map((l) => ({ productId: l.productId, name: l.name, qtyMissing: l.qtySent - (l.qtyReceived ?? 0) }));
        const value = missing.reduce((n, m) => n + m.qtyMissing * (COST_PRICE[m.productId] ?? 0), 0);
        const id = `AP-${String(++approvalSeq).padStart(4, "0")}`;
        approvals.set(id, {
          id, kind: "shortage", status: "pending", amount: value, limit: approvalThreshold("shortage").limit, unit: "naira",
          requestedBy: { id: user.id, name: user.name }, requestedAt: new Date(now()).toISOString(), requestNote: input.note,
          shortage: { transferId: transfer.id, lines: missing, valueAtCost: value, receiverNote: input.note }, steps: stepsFor("shortage", routing),
        });
      }
      return send(res, 200, { transfer, duplicate: false });
    }
    // Raise a purchase order (R01). Anyone holding the Procurement permission may, whatever their job title.
    if (req.method === "POST" && url.pathname === "/api/purchase-orders") {
      if (!can(caps(user), "Procurement", "C")) return fail(res, 403, "forbidden", "You have not been given permission to raise purchase orders.");
      const parsed = CreatePurchaseOrderInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Add the supplier and at least one item with a quantity.");
      const input = parsed.data;
      const seenId = purchaseOrderKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { purchaseOrder: purchaseOrders.get(seenId), duplicate: true }); // a retry never raises two orders
      const lines = [];
      for (const l of input.lines) {
        const product = products.find((p) => p.id === l.productId);
        if (!product) return fail(res, 400, "validation", "One of the items does not exist.");
        lines.push({ productId: product.id, name: product.name, qtyOrdered: l.qty, qtyReceived: 0 });
      }
      const po: PurchaseOrder = {
        id: `PO-${String(purchaseOrders.size + 1).padStart(4, "0")}`, supplierName: input.supplierName, reference: input.reference || undefined,
        status: "open", lines, createdAt: new Date(now()).toISOString(), raisedBy: { id: user.id, name: user.name },
      };
      purchaseOrders.set(po.id, po);
      purchaseOrderKeys.set(input.idempotencyKey, po.id);
      return send(res, 200, { purchaseOrder: po, duplicate: false });
    }
    // Goods receipt from a supplier (H01), against a purchase order.
    if (req.method === "GET" && url.pathname === "/api/purchase-orders") {
      if (!can(caps(user), "Warehouse", "V")) return fail(res, 403, "forbidden", "Your role cannot see purchase orders.");
      return send(res, 200, { purchaseOrders: [...purchaseOrders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    const goodsReceiptRoute = req.method === "POST" && url.pathname.match(/^\/api\/purchase-orders\/([^/]+)\/receive$/);
    if (goodsReceiptRoute) {
      if (!can(caps(user), "Warehouse", "C")) return fail(res, 403, "forbidden", "Your role cannot receive stock.");
      const parsed = GoodsReceiptInput.safeParse({ ...(await readJson(req) as object), purchaseOrderId: decodeURIComponent(goodsReceiptRoute[1] ?? "") });
      if (!parsed.success) return fail(res, 400, "validation", "Count what arrived.");
      const input = parsed.data;
      const seenId = goodsReceiptKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { purchaseOrder: purchaseOrders.get(seenId), duplicate: true }); // a retry never adds stock twice
      const po = purchaseOrders.get(input.purchaseOrderId);
      if (!po) return fail(res, 400, "validation", "That purchase order does not exist.");
      if (po.status === "received") return fail(res, 400, "validation", "That purchase order has already been fully received.");
      const open = po.lines.filter((l) => l.qtyReceived < l.qtyOrdered);
      if (open.some((l) => !input.lines.some((x) => x.productId === l.productId))) {
        return fail(res, 400, "validation", "Count every item still waiting on this order, even as zero.");
      }
      for (const l of input.lines) {
        const line = po.lines.find((x) => x.productId === l.productId);
        if (!line) return fail(res, 400, "validation", "One of the items is not on this purchase order.");
        const max = Math.floor(line.qtyOrdered * (1 + overReceiptAllowancePercent / 100));
        if (line.qtyReceived + l.qty > max) return fail(res, 400, "validation", `More ${line.name} was counted than the order (plus the allowed extra) permits.`);
      }
      for (const l of input.lines) {
        const line = po.lines.find((x) => x.productId === l.productId)!;
        line.qtyReceived += l.qty;
        warehouseStock[l.productId] = (warehouseStock[l.productId] ?? 0) + l.qty;
      }
      po.status = po.lines.every((x) => x.qtyReceived >= x.qtyOrdered) ? "received" : po.lines.some((x) => x.qtyReceived > 0) ? "partially_received" : "open";
      goodsReceiptKeys.set(input.idempotencyKey, po.id);
      return send(res, 200, { purchaseOrder: po, duplicate: false });
    }
    // Delivery: the dispatch board assigns, the rider proves delivery, the manager confirms the cash handed in.
    const isRider = user.role === "Rider / courier";
    if (req.method === "GET" && url.pathname === "/api/delivery/orders") {
      if (!can(caps(user), "Delivery", "V")) return fail(res, 403, "forbidden", "Your role cannot see deliveries.");
      const all = [...deliveries.values()].sort((a, b) => a.id.localeCompare(b.id));
      return send(res, 200, { orders: isRider ? all.filter((o) => o.riderId === user.id) : all }); // a rider sees only their own trips
    }
    if (req.method === "GET" && url.pathname === "/api/delivery/riders") {
      if (!can(caps(user), "Delivery", "C")) return fail(res, 403, "forbidden", "Your role cannot assign deliveries.");
      return send(res, 200, { riders: USERS.filter((u) => u.role === "Rider / courier").map((u) => ({ id: u.id, name: u.name })) });
    }
    const assignRoute = req.method === "POST" && url.pathname.match(/^\/api\/delivery\/orders\/([^/]+)\/assign$/);
    if (assignRoute) {
      if (!can(caps(user), "Delivery", "C")) return fail(res, 403, "forbidden", "Your role cannot assign deliveries.");
      const parsed = AssignInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Choose a rider.");
      const seenId = assignKeys.get(parsed.data.idempotencyKey);
      if (seenId) return send(res, 200, { order: deliveries.get(seenId), duplicate: true });
      const order = deliveries.get(decodeURIComponent(assignRoute[1] ?? ""));
      if (!order) return fail(res, 400, "validation", "That delivery does not exist.");
      if (order.status !== "pending" && order.status !== "failed") return fail(res, 400, "validation", "That delivery is already assigned or finished.");
      const rider = USERS.find((u) => u.id === parsed.data.riderId && u.role === "Rider / courier");
      if (!rider) return fail(res, 400, "validation", "That rider does not exist.");
      Object.assign(order, { status: "assigned", riderId: rider.id, riderName: rider.name, assignedAt: new Date(now()).toISOString(), failedReason: undefined });
      assignKeys.set(parsed.data.idempotencyKey, order.id);
      return send(res, 200, { order, duplicate: false });
    }
    if (req.method === "POST" && url.pathname === "/api/delivery/proof") {
      if (!can(caps(user), "Delivery", "E")) return fail(res, 403, "forbidden", "Your role cannot record deliveries.");
      const parsed = ProofInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", parsed.error.issues[0]?.message ?? "The proof is incomplete.");
      const input = parsed.data;
      const seenId = proofKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { order: deliveries.get(seenId), duplicate: true }); // a retry never records it twice
      const order = deliveries.get(input.orderId);
      if (!order) return fail(res, 400, "validation", "That delivery does not exist.");
      if (order.riderId !== user.id) return fail(res, 403, "forbidden", "This delivery is not assigned to you.");
      if (order.status !== "assigned") return fail(res, 400, "validation", "That delivery is already finished.");
      if (input.outcome === "delivered") {
        if (order.payment === "cash_on_delivery" && input.cashCollected !== order.amountDue) return fail(res, 400, "validation", `Collect the full ${order.amountDue} before handing over the goods, or mark the delivery as failed.`);
        if (order.payment === "prepaid" && (input.cashCollected ?? 0) !== 0) return fail(res, 400, "validation", "This order was already paid for. Do not collect cash.");
        Object.assign(order, { status: "delivered", deliveredAt: input.at, recipient: input.recipient ?? order.customerName, cashCollected: order.payment === "cash_on_delivery" ? input.cashCollected : undefined });
      } else {
        Object.assign(order, { status: "failed", failedReason: input.failedReason });
      }
      proofKeys.set(input.idempotencyKey, order.id);
      return send(res, 200, { order, duplicate: false });
    }
    if (req.method === "POST" && url.pathname === "/api/delivery/remit") {
      if (!can(caps(user), "Delivery", "E")) return fail(res, 403, "forbidden", "Your role cannot hand in delivery cash.");
      const parsed = RemitInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Choose the deliveries whose cash you are handing in.");
      const seenId = remitKeys.get(parsed.data.idempotencyKey);
      if (seenId) return send(res, 200, { approval: approvals.get(seenId), duplicate: true }); // a retry never raises two requests
      const orders: DeliveryOrder[] = [];
      for (const id of parsed.data.orderIds) {
        const o = deliveries.get(id);
        if (!o || o.riderId !== user.id) return fail(res, 400, "validation", "One of those deliveries is not yours.");
        if (o.status !== "delivered" || o.payment !== "cash_on_delivery") return fail(res, 400, "validation", "Only delivered cash-on-delivery orders can be handed in.");
        if (o.remitted || o.remittanceId) return fail(res, 400, "validation", "That cash is already handed in or waiting for confirmation.");
        orders.push(o);
      }
      const total = orders.reduce((n, o) => n + (o.cashCollected ?? 0), 0);
      const id = `AP-${String(++approvalSeq).padStart(4, "0")}`;
      const approval: Approval = {
        id, kind: "cash_remittance", status: "pending", amount: total, limit: 0, unit: "naira",
        requestedBy: { id: user.id, name: user.name }, requestedAt: new Date(now()).toISOString(),
        remittance: { riderId: user.id, riderName: user.name, orderIds: orders.map((o) => o.id), total }, steps: stepsFor("cash_remittance", routing),
      };
      approvals.set(id, approval);
      for (const o of orders) o.remittanceId = id;
      remitKeys.set(parsed.data.idempotencyKey, id);
      return send(res, 200, { approval, duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/delivery/outstanding") {
      if (!can(caps(user), "Delivery", "C")) return fail(res, 403, "forbidden", "Your role cannot see delivery cash.");
      const byRider = new Map<string, { riderId: string; riderName: string; orders: number; amount: number; oldest: string }>();
      for (const o of deliveries.values()) {
        if (o.status !== "delivered" || o.payment !== "cash_on_delivery" || o.remitted) continue;
        const row = byRider.get(o.riderId ?? "") ?? { riderId: o.riderId ?? "", riderName: o.riderName ?? "", orders: 0, amount: 0, oldest: o.deliveredAt ?? "" };
        row.orders += 1; row.amount += o.cashCollected ?? 0;
        if ((o.deliveredAt ?? "") < row.oldest) row.oldest = o.deliveredAt ?? row.oldest;
        byRider.set(row.riderId, row);
      }
      const riders = [...byRider.values()].map((r) => {
        const hours = Math.max(0, Math.floor((now() - Date.parse(r.oldest)) / 3_600_000));
        return { riderId: r.riderId, riderName: r.riderName, orders: r.orders, amount: r.amount, oldestDeliveredAt: r.oldest, hoursOutstanding: hours, overdue: hours >= codRemitHours };
      }).sort((a, b) => b.hoursOutstanding - a.hoursOutstanding);
      return send(res, 200, { asOf: new Date(now()).toISOString(), thresholdHours: codRemitHours, riders });
    }

    // Physical stock count (K01) and write-off request (K02).
    if (req.method === "GET" && url.pathname === "/api/count-sheet") {
      if (!can(caps(user), "Stock control", "V")) return fail(res, 403, "forbidden", "Your role cannot count stock.");
      const location = url.searchParams.get("location") === "warehouse" ? "warehouse" : "branch";
      return send(res, 200, { location, asOf: new Date(now()).toISOString(), items: products.map((p) => ({ productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode })) }); // no quantities: a blind count
    }
    if (req.method === "GET" && url.pathname === "/api/counts") {
      if (!can(caps(user), "Stock control", "V")) return fail(res, 403, "forbidden", "Your role cannot see stock counts.");
      return send(res, 200, { counts: [...counts.values()].sort((a, b) => b.id.localeCompare(a.id)).map(blind) });
    }
    if (req.method === "POST" && url.pathname === "/api/counts") {
      if (!can(caps(user), "Stock control", "C")) return fail(res, 403, "forbidden", "Your role cannot count stock.");
      const parsed = CountSubmitInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Count at least one item.");
      const input = parsed.data;
      const seenId = countKeys.get(input.idempotencyKey);
      if (seenId) return send(res, 200, { count: blind(counts.get(seenId)!), duplicate: true }); // a retry never counts twice
      for (const l of input.lines) if (!products.some((p) => p.id === l.productId)) return fail(res, 400, "validation", "One of the items does not exist.");
      if (!input.countId) {
        const lines = input.lines.map((l) => {
          const expected = stockOf(input.location, l.productId);
          return { productId: l.productId, name: products.find((p) => p.id === l.productId)!.name, family: products.find((p) => p.id === l.productId)?.family, counted: l.counted, expected, difference: l.counted - expected, needsRecount: l.counted !== expected };
        });
        const count: StockCount = {
          id: `SC-${String(counts.size + 1).padStart(4, "0")}`, location: input.location, round: 1, status: lines.some((l) => l.needsRecount) ? "needs_recount" : "closed",
          countedBy: { id: user.id, name: user.name }, countedAt: input.countedAt, note: input.note, lines,
        };
        counts.set(count.id, count); countKeys.set(input.idempotencyKey, count.id);
        return send(res, 200, { count: blind(count), duplicate: false });
      }
      const count = counts.get(input.countId);
      if (!count) return fail(res, 400, "validation", "That count does not exist.");
      if (count.status !== "needs_recount") return fail(res, 400, "validation", "That count does not need a recount.");
      if (recountByDifferentPerson && count.countedBy.id === user.id) return fail(res, 403, "forbidden", "A different person must recount these items.");
      const flagged = count.lines.filter((l) => l.needsRecount).map((l) => l.productId);
      if (input.lines.some((l) => !flagged.includes(l.productId))) return fail(res, 400, "validation", "Only the items that differ are recounted.");
      if (flagged.some((id) => !input.lines.some((l) => l.productId === id))) return fail(res, 400, "validation", "Count every item that needs a recount.");
      for (const l of input.lines) {
        const line = count.lines.find((x) => x.productId === l.productId)!;
        const expected = stockOf(count.location, l.productId);
        Object.assign(line, { counted: l.counted, expected, difference: l.counted - expected, needsRecount: false }); // the recount is the final figure
      }
      count.round = 2; count.recountBy = { id: user.id, name: user.name };
      count.status = count.lines.some((l) => (l.difference ?? 0) !== 0) ? "review" : "closed";
      countKeys.set(input.idempotencyKey, count.id);
      return send(res, 200, { count: blind(count), duplicate: false });
    }
    const writeOffRoute = req.method === "POST" && url.pathname.match(/^\/api\/counts\/([^/]+)\/write-off$/);
    if (writeOffRoute) {
      if (!can(caps(user), "Stock control", "C")) return fail(res, 403, "forbidden", "Your role cannot ask for a write-off.");
      const parsed = WriteOffRequestInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "The request is incomplete.");
      const count = counts.get(decodeURIComponent(writeOffRoute[1] ?? ""));
      if (!count) return fail(res, 400, "validation", "That count does not exist.");
      const seenId = writeOffKeys.get(parsed.data.idempotencyKey);
      if (seenId) return send(res, 200, { count: blind(count), approval: hideCost(approvals.get(seenId)!), duplicate: true }); // a retry never raises two requests
      if (count.status !== "review") return fail(res, 400, "validation", "Only a finished count with differences can go for a write-off.");
      const diff = count.lines.filter((l) => (l.difference ?? 0) !== 0);
      const value = diff.reduce((n, l) => n + Math.abs(l.difference ?? 0) * (COST_PRICE[l.productId] ?? 0), 0);
      const id = `AP-${String(++approvalSeq).padStart(4, "0")}`;
      const approval: Approval = {
        id, kind: "write_off", status: "pending", amount: value, limit: approvalThreshold("write_off").limit, unit: "naira",
        requestedBy: { id: user.id, name: user.name }, requestedAt: new Date(now()).toISOString(), requestNote: parsed.data.note,
        writeOff: { countId: count.id, location: count.location, lines: diff.map((l) => ({ productId: l.productId, name: l.name, family: l.family, expected: l.expected ?? 0, counted: l.counted, difference: l.difference ?? 0 })), valueAtCost: value, note: parsed.data.note },
        steps: stepsFor("write_off", routing),
      };
      approvals.set(id, approval);
      writeOffKeys.set(parsed.data.idempotencyKey, id);
      count.status = "write_off_requested"; count.writeOffApprovalId = id;
      return send(res, 200, { count: blind(count), approval: hideCost(approval), duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/stock") {
      if (!can(caps(user), "Warehouse", "V")) return fail(res, 403, "forbidden", "Your role cannot see stock levels.");
      const q = (url.searchParams.get("q") ?? "").toLowerCase();
      return send(res, 200, {
        asOf: new Date(now()).toISOString(),
        levels: products.filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode.includes(q))
          .map((p) => ({
            productId: p.id, name: p.name, sku: p.sku, barcode: p.barcode, branch: p.stock, warehouse: warehouseStock[p.id] ?? 0,
            branches: Object.fromEntries(Object.entries(branchStock).filter(([b]) => b !== user.branch).map(([b, stock]) => [b, stock[p.id] ?? 0])),
          })),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/reports/in-transit") {
      if (!can(caps(user), "Reporting", "V")) return fail(res, 403, "forbidden", "Your role cannot see this report.");
      const rows = [...transfers.values()].filter((x) => x.status === "in_transit")
        .map((x) => ({ transferId: x.id, dispatchedBy: x.dispatchedBy.name, dispatchedAt: x.dispatchedAt, hoursInTransit: Math.floor((now() - Date.parse(x.dispatchedAt)) / 3_600_000), units: x.lines.reduce((n, l) => n + l.qtySent, 0) }))
        .filter((x) => x.hoursInTransit >= inTransitAlertHours).sort((a, b) => b.hoursInTransit - a.hoursInTransit);
      return send(res, 200, { asOf: new Date(now()).toISOString(), thresholdHours: inTransitAlertHours, rows });
    }
    if (req.method === "POST" && url.pathname === "/api/print-log") {
      const parsed = PrintLogInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "Invalid print log.");
      printLog.add(parsed.data.idempotencyKey);
      return send(res, 200, {});
    }

    // Approvals are decided only on the server. The inbox shows what the role may decide; the server enforces it.
    if (req.method === "POST" && url.pathname === "/api/approvals") {
      const parsed = CreateApprovalInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", parsed.error.issues[0]?.message ?? "The request is incomplete.");
      const input = parsed.data;
      if (input.kind === "cash_up") return fail(res, 403, "forbidden", "A cash-up is raised by closing a shift, not by a request.");
      if (!can(caps(user), input.kind === "refund" ? "Returns" : "Stores (POS)", "C")) return fail(res, 403, "forbidden", "Your role cannot raise this request.");
      const existingId = approvalCreates.get(input.idempotencyKey);
      if (existingId) {
        const existing = approvals.get(existingId);
        if (existing) return send(res, 200, { approval: existing, duplicate: true });
      }
      let limit: number;
      let unit = input.unit;
      let customer: Customer | undefined;
      let amount = input.amount;
      let refundInfo: Approval["refund"];
      if (input.kind === "refund") {
        // The server works out the refund itself from the sale; the client's amount is not trusted.
        const rr = input.refund!;
        const sale = sales.get(rr.saleKey);
        if (!sale) return fail(res, 400, "validation", "That sale does not exist.");
        const already = returnedQty(rr.saleKey);
        for (const l of rr.lines) {
          const sold = sale.lines.find((x) => x.productId === l.productId);
          if (!sold || l.qty > sold.qty - (already[l.productId] ?? 0)) return fail(res, 400, "validation", "More was selected than was sold or is left to return.");
        }
        // The return window depends on the product and on whether the item is faulty. The server decides; the screen only explains.
        const faulty = returnRules.faultyReasons.includes(rr.reason);
        const age = daysSince(sale.postedAt, now());
        for (const l of rr.lines) {
          const product = PRODUCTS.find((x) => x.id === l.productId);
          const allowed = returnDaysFor(returnRules, { id: l.productId, category: product?.category }, faulty);
          if (age > allowed) return fail(res, 400, "validation", `${product?.name ?? "This item"} can only be returned within ${allowed} days${faulty ? " when faulty" : ""}. This sale is ${age} days old.`);
        }
        const r = refundFor(sale, rr.lines);
        if (r.largestItem < 1) return fail(res, 400, "validation", "There is nothing to refund.");
        amount = r.largestItem; // the per-item limit is compared with the biggest line
        refundInfo = {
          saleKey: rr.saleKey, invoiceNo: sale.invoiceNo, reason: rr.reason, refundTotal: r.total,
          lines: r.lines.map((l) => ({ productId: l.productId, name: sale.lines.find((x) => x.productId === l.productId)?.name ?? l.productId, qty: l.qty, amount: l.amount })),
        };
      }
      if (input.kind === "credit_over_limit") {
        customer = customers.find((c) => c.id === input.customerId);
        if (!customer) return fail(res, 400, "validation", "That customer does not exist.");
        if (customer.creditLimit === undefined) return fail(res, 400, "validation", `${customer.name} has no credit terms.`);
        const available = Math.max(0, customer.creditLimit - (customer.balance ?? 0));
        if (input.amount <= available) return fail(res, 400, "validation", `${customer.name} still has room under their limit; no approval is needed.`);
        limit = customer.creditLimit;
        unit = "naira";
      } else {
        const threshold = approvalThreshold(input.kind);
        limit = threshold.limit;
        unit = threshold.unit;
      }
      const approval: Approval = {
        id: `AP-${String(++approvalSeq).padStart(4, "0")}`,
        kind: input.kind, status: "pending", amount, limit, unit, refund: refundInfo,
        requestedBy: { id: user.id, name: user.name }, requestedAt: new Date().toISOString(),
        customerId: customer?.id, customerName: customer?.name, requestNote: input.requestNote,
        // Credit approval depends on the account: a customer or partner that names its own approvers overrides the general route.
        steps: input.kind === "credit_over_limit" && customer?.approverRoles?.length ? [{ roles: [...customer.approverRoles], status: "pending" as const }] : stepsFor(input.kind, routing),
      };
      approvals.set(approval.id, approval);
      approvalCreates.set(input.idempotencyKey, approval.id);
      return send(res, 200, { approval, duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/approvals") {
      const mine = [...approvals.values()]
        .filter((a) => mayViewApproval(caps(user), a))
        .map(hideCost)
        .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      return send(res, 200, { approvals: mine });
    }
    const decisionRoute = req.method === "POST" && url.pathname.match(/^\/api\/approvals\/([^/]+)\/decision$/);
    if (decisionRoute) {
      const parsed = ApprovalDecisionInput.safeParse(await readJson(req));
      if (!parsed.success) return fail(res, 400, "validation", "A rejection needs a reason.");
      const approvalId = decodeURIComponent(decisionRoute[1] ?? "");
      const approval = approvals.get(approvalId);
      if (!approval) return fail(res, 400, "validation", "That request does not exist.");
      // A retried decision returns the same result and changes nothing.
      const seen = decisions.get(parsed.data.idempotencyKey);
      if (seen) {
        if (seen.approvalId !== approvalId) return fail(res, 400, "validation", "This key was used for another request.");
        return send(res, 200, { approval, duplicate: true });
      }
      if (approval.requestedBy.id === user.id) return fail(res, 403, "forbidden", "You cannot decide a request you raised.");
      if (approval.status !== "pending") return fail(res, 400, "validation", "This request has already been decided.");
      const step = currentStep(approval);
      if (approval.steps?.length) {
        // A chain: only the roles of the current step, and never someone who already decided an earlier step.
        if (!step || !step.step.roles.some((r) => caps(user).roles.includes(r))) return fail(res, 403, "forbidden", "This step is for another role.");
        if (decidedEarlier(approval, user.id)) return fail(res, 403, "forbidden", "A different person must decide this step.");
      } else if (!mayDecideApproval(caps(user), { ...approval, amount: 0 })) { // role check only; the limit has its own message below
        return fail(res, 403, "forbidden", "Your role cannot decide this request.");
      }
      if (!withinApprovalLimitFor(caps(user), approval.kind, approval.amount)) return fail(res, 403, "forbidden", "This is above your limit. The MD must approve it.");
      if (approval.kind === "shortage" && parsed.data.decision === "approve" && !parsed.data.outcome) return fail(res, 400, "validation", "Choose who bears the loss.");
      const now = new Date().toISOString();
      const decided = { id: user.id, name: user.name };
      if (step) Object.assign(step.step, { status: parsed.data.decision === "approve" ? "approved" : "rejected", decidedBy: decided, decidedAt: now, reason: parsed.data.reason });
      const finished = parsed.data.decision === "reject" || !step || step.index === (approval.steps?.length ?? 1) - 1;
      if (finished) approval.status = parsed.data.decision === "approve" ? "approved" : "rejected";
      if (approval.kind === "cash_remittance" && approval.remittance && finished) {
        for (const id of approval.remittance.orderIds) {
          const o = deliveries.get(id);
          if (!o) continue;
          if (approval.status === "approved") o.remitted = true; // the manager confirmed the cash was handed in
          else o.remittanceId = undefined; // not confirmed: the rider can hand it in again
        }
      }
      if (approval.kind === "write_off" && approval.writeOff && finished) {
        const count = counts.get(approval.writeOff.countId);
        if (count) {
          if (approval.status === "approved") { for (const l of count.lines) if ((l.difference ?? 0) !== 0) setStock(count.location, l.productId, l.counted); count.status = "adjusted"; } // stock now matches what was counted
          else count.status = "closed"; // not written off: nothing is adjusted
        }
      }
      if (approval.kind === "shortage" && approval.shortage && parsed.data.decision === "approve" && parsed.data.outcome) {
        approval.shortage.bearer = parsed.data.outcome;
        if (finished) {
          const lossId = `LS-${String(losses.size + 1).padStart(4, "0")}`;
          losses.set(lossId, { id: lossId, transferId: approval.shortage.transferId, bearer: parsed.data.outcome, valueAtCost: approval.shortage.valueAtCost ?? 0, decidedBy: user.name, decidedAt: now });
          approval.shortage.lossId = lossId;
        }
      }
      approval.decidedBy = decided;
      approval.decidedAt = now;
      approval.decisionReason = parsed.data.reason;
      decisions.set(parsed.data.idempotencyKey, { approvalId, decision: parsed.data.decision });
      return send(res, 200, { approval, duplicate: false });
    }
    // Read-only figures for managers. The server computes them; the screens only display.
    const mayReport = can(caps(user), "Reporting", "V");
    if (req.method === "GET" && url.pathname === "/api/summary") {
      if (!mayReport) return fail(res, 403, "forbidden", "Your role cannot see branch figures.");
      const all = [...sales.values()];
      const decidable = [...approvals.values()].filter((a) => mayDecideApproval(caps(user), a));
      return send(res, 200, {
        asOf: new Date().toISOString(),
        salesCount: all.length,
        salesTotal: all.reduce((n, x) => n + x.total, 0),
        cashTotal: all.reduce((n, x) => n + cashOf(x.payments), 0),
        creditTotal: all.reduce((n, x) => n + creditOf(x.payments), 0),
        returnsTotal: [...returns.values()].reduce((n, r) => n + r.refundTotal, 0),
        shortagesCharged: [...losses.values()].filter((l) => l.bearer === "branch").reduce((n, l) => n + l.valueAtCost, 0),
        shortagesWaiting: decidable.filter((a) => a.kind === "shortage").length,
        openShifts: [...shifts.values()].filter((x) => x.status === "open").length,
        pendingApprovals: decidable.length,
        cashUpsAwaiting: decidable.filter((a) => a.kind === "cash_up").length,
      });
    }
    if (req.method === "GET" && url.pathname === "/api/reports/cashup-variance") {
      if (!mayReport) return fail(res, 403, "forbidden", "Your role cannot see this report.");
      const names = new Map(USERS.map((u) => [u.id, u.name]));
      const byCashier = new Map<string, { cashierId: string; cashierName: string; shifts: number; totalVariance: number; shortShifts: number; largestShort: number }>();
      for (const sh of shifts.values()) {
        if (sh.status !== "closed" || sh.variance === undefined) continue;
        const row = byCashier.get(sh.userId) ?? { cashierId: sh.userId, cashierName: names.get(sh.userId) ?? sh.userId, shifts: 0, totalVariance: 0, shortShifts: 0, largestShort: 0 };
        row.shifts += 1; row.totalVariance += sh.variance;
        if (sh.variance < 0) { row.shortShifts += 1; row.largestShort = Math.max(row.largestShort, -sh.variance); }
        byCashier.set(sh.userId, row);
      }
      return send(res, 200, { asOf: new Date().toISOString(), rows: [...byCashier.values()].sort((a, b) => a.totalVariance - b.totalVariance) });
    }
    if (req.method === "GET" && url.pathname === "/api/_debug/state") {
      return send(res, 200, { sales: sales.size, shifts: shifts.size, printLog: printLog.size, shiftKeys: shiftKeys.size });
    }
    if (req.method === "GET" && url.pathname === "/api/capabilities") return send(res, 200, caps(user));
    if (req.method === "GET" && url.pathname === "/api/tasks") return send(res, 200, { tasks: TASKS[user.role] ?? [] });
    if (req.method === "POST" && url.pathname === "/api/logout") { sessions.delete((req.headers.authorization ?? "").replace("Bearer ", "")); return send(res, 200, {}); }
    return fail(res, 403, "forbidden", "Unknown or restricted endpoint.");
  });
}
