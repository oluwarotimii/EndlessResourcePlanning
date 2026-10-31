import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  ApprovalDecisionInput, CreateApprovalInput, LoginRequest, PrintLogInput, SaleInput, ShiftCloseInput, ShiftOpenInput,
  cashOf, computeTotals, creditOf, discountAmount,
  type ApiError, type Approval, type Capabilities, type Customer, type Product, type Sale, type Shift, type VatMode,
} from "@erp/api-contract";
import { approvalArea, approvalThreshold, areasForRoles, can, withinApprovalLimitFor } from "@erp/permissions";
import { APPROVALS, CUSTOMERS, PRODUCTS, TASKS, USERS, type MockUser } from "./fixtures";

export interface MockOptions { latencyMs?: number; vatRate?: number; vatMode?: VatMode }

/**
 * Stand-in for ERPNext until the adapter exists. It deliberately includes the awkward cases:
 * wrong PIN, forbidden, unavailable (header x-mock-fail), latency and unknown routes.
 */
export function createMockServer({ latencyMs = 0, vatRate = 0.075, vatMode = "inclusive" }: MockOptions = {}) {
  const sessions = new Map<string, MockUser>();
  // In-memory "ERPNext": the idempotency keys make every write safe to retry.
  const products: Product[] = structuredClone(PRODUCTS);
  const customers: Customer[] = structuredClone(CUSTOMERS);
  const sales = new Map<string, Sale>(); // by idempotency key
  const shifts = new Map<string, Shift & { userId: string }>();
  const shiftKeys = new Map<string, string>(); // idempotency key -> shiftId + action
  const printLog = new Set<string>();
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
    roles: [u.role],
    areas: areasForRoles([u.role]),
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
      return send(res, 200, { deviceBranch: "Pilot Branch", users: USERS.map(({ id, name, role }) => ({ id, name, role })) });
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
    const canSell = (areasForRoles([user.role])["Stores (POS)"] ?? "").includes("C");

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
      shift.status = "closed"; shift.closedAt = parsed.data.closedAt; shift.countedCash = parsed.data.countedCash;
      shift.expectedCash = shift.openingFloat + cashSales; shift.variance = parsed.data.countedCash - shift.expectedCash;
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
      if (onCredit > 0) {
        creditCustomer = customers.find((c) => c.id === input.customerId);
        if (!input.customerId || !creditCustomer) return fail(res, 400, "validation", "A credit sale needs a customer.");
        if (creditCustomer.creditLimit === undefined) return fail(res, 400, "validation", `${creditCustomer.name} has no credit terms.`);
        if ((creditCustomer.balance ?? 0) + onCredit > creditCustomer.creditLimit) return fail(res, 400, "validation", `${creditCustomer.name} would go over the credit limit. A manager must approve.`);
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
      if (input.discountApprovalId) approvalUses.set(input.discountApprovalId, input.idempotencyKey);
      return send(res, 200, { sale, duplicate: false });
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
      if (!can(caps(user), "Stores (POS)", "C")) return fail(res, 403, "forbidden", "Your role cannot raise this request.");
      const existingId = approvalCreates.get(input.idempotencyKey);
      if (existingId) {
        const existing = approvals.get(existingId);
        if (existing) return send(res, 200, { approval: existing, duplicate: true });
      }
      let limit: number;
      let unit = input.unit;
      let customer: Customer | undefined;
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
        kind: input.kind, status: "pending", amount: input.amount, limit, unit,
        requestedBy: { id: user.id, name: user.name }, requestedAt: new Date().toISOString(),
        customerName: customer?.name, requestNote: input.requestNote,
      };
      approvals.set(approval.id, approval);
      approvalCreates.set(input.idempotencyKey, approval.id);
      return send(res, 200, { approval, duplicate: false });
    }
    if (req.method === "GET" && url.pathname === "/api/approvals") {
      const mine = [...approvals.values()]
        .filter((a) => a.requestedBy.id === user.id || can(caps(user), approvalArea(a.kind), "A"))
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
      if (!can(caps(user), approvalArea(approval.kind), "A")) return fail(res, 403, "forbidden", "Your role cannot decide this request.");
      if (!withinApprovalLimitFor(caps(user), approval.kind, approval.amount)) return fail(res, 403, "forbidden", "This is above your limit. The MD must approve it.");
      if (approval.status !== "pending") return fail(res, 400, "validation", "This request has already been decided.");
      approval.status = parsed.data.decision === "approve" ? "approved" : "rejected";
      approval.decidedBy = { id: user.id, name: user.name };
      approval.decidedAt = new Date().toISOString();
      approval.decisionReason = parsed.data.reason;
      decisions.set(parsed.data.idempotencyKey, { approvalId, decision: parsed.data.decision });
      return send(res, 200, { approval, duplicate: false });
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
