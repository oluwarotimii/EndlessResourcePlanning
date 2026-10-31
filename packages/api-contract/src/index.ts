import { z } from "zod";

/** Our own domain contract. The ERPNext adapter (Sprint 5) maps to this, never the reverse. */

/** V = view, C = create, E = edit, A = approve (a workflow step, not a permission). */
export const PermissionLetters = z.string().regex(/^[VCEA]*$/);

export const RegisteredUser = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
});
export type RegisteredUser = z.infer<typeof RegisteredUser>;

export const UsersResponse = z.object({
  deviceBranch: z.string(),
  users: z.array(RegisteredUser),
});
export type UsersResponse = z.infer<typeof UsersResponse>;

export const LoginRequest = z.object({ userId: z.string(), pin: z.string().regex(/^\d{4}$/) });
export type LoginRequest = z.infer<typeof LoginRequest>;

/** Returned once at sign-in. Roles are read from the server; the front end never keeps its own copy. */
export const Capabilities = z.object({
  user: z.object({ id: z.string(), name: z.string() }),
  roles: z.array(z.string()).min(1),
  /** Area name -> permission letters, e.g. "Cash-up": "VCE". */
  areas: z.record(z.string(), PermissionLetters),
  scope: z.object({ branch: z.string().optional(), warehouse: z.string().optional() }),
});
export type Capabilities = z.infer<typeof Capabilities>;

export const LoginResponse = z.object({ token: z.string(), capabilities: Capabilities });
export type LoginResponse = z.infer<typeof LoginResponse>;

export const TaskStatus = z.enum(["pending", "overdue", "done", "blocked"]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const Task = z.object({
  id: z.string(),
  screenId: z.string(),
  title: z.string(),
  detail: z.string().optional(),
  status: TaskStatus,
  /** Whole naira. Money is never a float string. */
  amount: z.number().int().optional(),
  limit: z.number().int().optional(),
  limitUnit: z.enum(["percent", "naira"]).optional(),
  requestedBy: z.string().optional(),
});
export type Task = z.infer<typeof Task>;

export const TasksResponse = z.object({ tasks: z.array(Task) });
export type TasksResponse = z.infer<typeof TasksResponse>;

export const ApiError = z.object({
  code: z.enum(["unauthenticated", "forbidden", "validation", "duplicate", "unavailable"]),
  message: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;

/* ───────────── Sprint 2: till, shifts, printing ───────────── */

const Id = z.string().min(8);
/** Whole naira, VAT-inclusive. Never a float string. */
const Naira = z.number().int().nonnegative();

export const Product = z.object({
  id: z.string(), sku: z.string(), barcode: z.string(), name: z.string(),
  price: Naira, stock: z.number().int(), category: z.string().optional(),
  /** Items that come in variants (colour, size, power) share a family. A mix-up between variants is a common cause of false shortages. */
  family: z.string().optional(), variant: z.string().optional(),
});
export type Product = z.infer<typeof Product>;
export const ProductsResponse = z.object({ products: z.array(Product), asOf: z.string() });
export type ProductsResponse = z.infer<typeof ProductsResponse>;

export const Customer = z.object({
  id: z.string(), name: z.string(), phone: z.string().optional(),
  /** Credit terms, whole naira. Absent means no credit is allowed. */
  creditLimit: Naira.optional(),
  /** Amount the customer already owes. */
  balance: Naira.optional(),
  /** A credit partner (for example a lender) is billed instead of the buyer. Absent means an ordinary customer. */
  kind: z.enum(["customer", "partner"]).optional(),
  /** Who approves credit over this account's limit. Each account can name its own (for example the Credit controller). */
  approverRoles: z.array(z.string()).optional(),
});
export type Customer = z.infer<typeof Customer>;
export const CustomersResponse = z.object({ customers: z.array(Customer) });
export type CustomersResponse = z.infer<typeof CustomersResponse>;

/** "credit" means the customer pays later; it needs an identified customer. "other" covers anything else the company accepts. */
export const PaymentMethod = z.enum(["cash", "transfer", "card", "credit", "other"]);
export type PaymentMethod = z.infer<typeof PaymentMethod>;

/** A sale can be paid with several methods, including part credit. The amounts must add up to the total. */
export const Payment = z.object({ method: PaymentMethod, amount: z.number().int().positive() });
export type Payment = z.infer<typeof Payment>;

/**
 * inclusive: prices already contain VAT (the customer pays the price).
 * exclusive: VAT is added on top (the customer pays price + VAT).
 * none: the company does not charge VAT.
 */
export const VatMode = z.enum(["inclusive", "exclusive", "none"]);
export type VatMode = z.infer<typeof VatMode>;

export interface Totals { subtotal: number; vat: number; total: number }
/** One rule for the till, the mock and (later) the contract tests against ERPNext. Whole naira, rounded half up. */
export function computeTotals(subtotal: number, mode: VatMode, rate: number): Totals {
  if (mode === "none" || rate === 0) return { subtotal, vat: 0, total: subtotal };
  if (mode === "exclusive") { const vat = Math.round(subtotal * rate); return { subtotal, vat, total: subtotal + vat }; }
  return { subtotal, vat: Math.round((subtotal * rate) / (1 + rate)), total: subtotal };
}
export const creditOf = (payments: readonly Payment[]) => payments.filter((p) => p.method === "credit").reduce((n, p) => n + p.amount, 0);
export const cashOf = (payments: readonly Payment[]) => payments.filter((p) => p.method === "cash").reduce((n, p) => n + p.amount, 0);

export const SaleLine = z.object({
  productId: z.string(), name: z.string(), unitPrice: Naira, qty: z.number().int().positive(),
});
export type SaleLine = z.infer<typeof SaleLine>;

/** The idempotency key is generated on the device. Posting the same key twice never creates a second sale. */
export const SaleInput = z.object({
  idempotencyKey: Id,
  clientCreatedAt: z.string(),
  shiftId: Id,
  customerId: z.string().optional(),
  /** The order from the floor this sale pays for. The server checks the lines match and marks the order paid. */
  orderId: z.string().optional(),
  /** Bill the credit part of this sale to a credit partner instead of the customer. The partner's limit and balance are used. */
  billToId: z.string().optional(),
  /** An approved discount may be applied once. The server checks the approval and recomputes the totals. */
  discountApprovalId: z.string().min(1).optional(),
  /** An approved credit_over_limit request for this customer and at least this much credit. */
  creditApprovalId: z.string().min(1).optional(),
  lines: z.array(SaleLine).min(1),
  /** Sum of the lines. */
  subtotal: Naira,
  vatMode: VatMode,
  vat: Naira,
  /** What the customer owes: subtotal, plus VAT when it is added on top. */
  total: Naira,
  payments: z.array(Payment).min(1),
});
export type SaleInput = z.infer<typeof SaleInput>;

export const Sale = SaleInput.extend({
  invoiceNo: z.string(),
  cashier: z.object({ id: z.string(), name: z.string() }),
  postedAt: z.string(),
});
export type Sale = z.infer<typeof Sale>;
export const SaleResponse = z.object({ sale: Sale, duplicate: z.boolean() });
export type SaleResponse = z.infer<typeof SaleResponse>;

export const ShiftOpenInput = z.object({ idempotencyKey: Id, shiftId: Id, openedAt: z.string(), openingFloat: Naira });
export type ShiftOpenInput = z.infer<typeof ShiftOpenInput>;
export const ShiftCloseInput = z.object({
  idempotencyKey: Id, shiftId: Id, closedAt: z.string(), countedCash: Naira,
  /** Notes counted per denomination, e.g. {"1000": 12}. When present it must add up to countedCash. */
  denominations: z.record(z.string(), z.number().int().nonnegative()).optional(),
  /** Required by the server when the count does not match the expected cash. */
  varianceReason: z.string().trim().max(300).optional(),
});
export type ShiftCloseInput = z.infer<typeof ShiftCloseInput>;

export const Shift = z.object({
  id: z.string(), status: z.enum(["open", "closed"]), openingFloat: Naira, openedAt: z.string(),
  closedAt: z.string().optional(), countedCash: Naira.optional(),
  expectedCash: Naira.optional(), variance: z.number().int().optional(),
});
export type Shift = z.infer<typeof Shift>;
export const ShiftResponse = z.object({ shift: Shift, duplicate: z.boolean() });
export type ShiftResponse = z.infer<typeof ShiftResponse>;

/** Reprints are allowed but logged. */
export const PrintLogInput = z.object({
  idempotencyKey: Id, documentType: z.enum(["invoice", "receipt"]), documentNo: z.string(), reprint: z.boolean(), at: z.string(),
});
export type PrintLogInput = z.infer<typeof PrintLogInput>;

/* ───────────── Sprint 3: approvals ───────────── */

/** An exception that needs someone else to approve it. The server is the authority on limits. */
export const ApprovalKind = z.enum(["discount", "void", "credit_over_limit", "cash_up", "refund", "shortage", "write_off", "cash_remittance"]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Percent for discounts, whole naira for money amounts. */
export const ApprovalUnit = z.enum(["percent", "naira"]);
export type ApprovalUnit = z.infer<typeof ApprovalUnit>;

/* ───────────── Returns and refunds ───────────── */

export const ReturnLine = z.object({ productId: z.string(), qty: z.number().int().positive() });
export type ReturnLine = z.infer<typeof ReturnLine>;

/** What a cashier asks a manager to approve: which sale, which lines, why. */
export const RefundRequest = z.object({
  saleKey: z.string().min(8),
  lines: z.array(ReturnLine).min(1),
  reason: z.string().trim().min(2).max(200),
});
export type RefundRequest = z.infer<typeof RefundRequest>;

/**
 * The refund for returned lines is what the customer actually paid for them: a share of the sale total,
 * by the lines' share of the gross subtotal. That is right with a discount and with VAT added on top.
 * `largestItem` is the biggest single line, which is what the per-item refund limit is compared with.
 */
export function refundFor(sale: { lines: Array<{ productId: string; unitPrice: number }>; subtotal: number; total: number }, lines: ReturnLine[]) {
  const per = lines.map((l) => {
    const sold = sale.lines.find((x) => x.productId === l.productId);
    const gross = (sold?.unitPrice ?? 0) * l.qty;
    return { productId: l.productId, qty: l.qty, amount: sale.subtotal === 0 ? 0 : Math.round((sale.total * gross) / sale.subtotal) };
  });
  return { total: per.reduce((n, x) => n + x.amount, 0), largestItem: Math.max(0, ...per.map((x) => x.amount)), lines: per };
}

/** Who bears the cost of stock that went missing in transit. The ruling is a decision by someone independent of the branch. */
export const ShortageBearer = z.enum(["branch", "warehouse", "transit"]);
export type ShortageBearer = z.infer<typeof ShortageBearer>;

/** A stock count's differences, put up for approval before stock is adjusted. Cost is shown only to the people who approve it. */
export const WriteOffDetail = z.object({
  countId: z.string(),
  location: z.enum(["branch", "warehouse"]),
  lines: z.array(z.object({ productId: z.string(), name: z.string(), family: z.string().optional(), expected: z.number().int(), counted: z.number().int().nonnegative(), difference: z.number().int() })),
  valueAtCost: Naira.optional(),
  note: z.string().optional(),
});
export type WriteOffDetail = z.infer<typeof WriteOffDetail>;

/** A rider handing over the cash collected on delivery. A manager confirms they received it. */
export const RemittanceDetail = z.object({
  riderId: z.string(), riderName: z.string(), orderIds: z.array(z.string()), total: Naira,
});
export type RemittanceDetail = z.infer<typeof RemittanceDetail>;

/** One step of an approval chain. Steps are decided in order; each names the roles allowed to decide it. */
export const ApprovalStep = z.object({
  roles: z.array(z.string()).min(1),
  status: ApprovalStatus,
  decidedBy: z.object({ id: z.string(), name: z.string() }).optional(),
  decidedAt: z.string().optional(),
  reason: z.string().optional(),
});
export type ApprovalStep = z.infer<typeof ApprovalStep>;

export const Approval = z.object({
  id: z.string(),
  kind: ApprovalKind,
  status: ApprovalStatus,
  /** What is being approved: a discount percentage, or a whole-naira amount. */
  amount: z.number().int().nonnegative(),
  /** The limit of the person who raised the request, shown on the approval card. */
  limit: z.number().int().nonnegative(),
  unit: ApprovalUnit,
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  requestedAt: z.string(),
  /** The customer the exception is about, when there is one. */
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  /** For a cash_up approval: what was counted at shift close. Created by the server, never by a client. */
  cashUp: z.object({
    shiftId: z.string(), cashierName: z.string(), expected: Naira, counted: Naira, variance: z.number().int(),
    reason: z.string().optional(), denominations: z.record(z.string(), z.number().int().nonnegative()).optional(),
  }).optional(),
  /** Why the request was raised, in the requester's words. */
  requestNote: z.string().optional(),
  decidedBy: z.object({ id: z.string(), name: z.string() }).optional(),
  decidedAt: z.string().optional(),
  /** Required on rejection; an approval may also carry a note. */
  decisionReason: z.string().optional(),
  /**
   * For a shortage: the transfer, what is missing and who was ruled to bear it. Raised by the server when a transfer is
   * received short. `valueAtCost` is only shown to the people who rule on it (cost prices are hidden from most roles).
   */
  shortage: z.object({
    transferId: z.string(),
    lines: z.array(z.object({ productId: z.string(), name: z.string(), qtyMissing: z.number().int().positive() })),
    valueAtCost: Naira.optional(),
    receiverNote: z.string().optional(),
    bearer: ShortageBearer.optional(),
    lossId: z.string().optional(),
  }).optional(),
  /** For a cash remittance: whose cash, which deliveries, how much. Built by the server. */
  remittance: RemittanceDetail.optional(),
  /** For a write-off: what the count found and what stock would be adjusted. Built by the server. */
  writeOff: WriteOffDetail.optional(),
  /** For a refund: the sale, the lines coming back and what will be refunded. Built by the server. */
  refund: z.object({
    saleKey: z.string(), invoiceNo: z.string(), reason: z.string(), refundTotal: Naira,
    lines: z.array(z.object({ productId: z.string(), name: z.string(), qty: z.number().int().positive(), amount: Naira })),
  }).optional(),
  /** The chain that must approve it, in order. Absent for a single approval decided by the matrix Approve letter. */
  steps: z.array(ApprovalStep).optional(),
});
export type Approval = z.infer<typeof Approval>;
export const ApprovalsResponse = z.object({ approvals: z.array(Approval) });
export type ApprovalsResponse = z.infer<typeof ApprovalsResponse>;

/**
 * Every decision carries an idempotency key, so a retry after a dropped connection
 * can never approve the same request twice. The creator of a request may never decide it.
 */
export const ApprovalDecisionInput = z.object({
  idempotencyKey: Id,
  decision: z.enum(["approve", "reject"]),
  reason: z.string().trim().max(500).optional(),
  /** For a shortage ruling: who bears the loss. Required by the server when approving a shortage. */
  outcome: ShortageBearer.optional(),
}).refine((v) => v.decision !== "reject" || (v.reason?.length ?? 0) >= 3, {
  message: "A rejection needs a reason.", path: ["reason"],
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

export const ApprovalResponse = z.object({ approval: Approval, duplicate: z.boolean() });
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;

/** A cashier raises an exception; it lands in the inbox for someone else to decide. */
export const CreateApprovalInput = z.object({
  idempotencyKey: Id,
  kind: ApprovalKind,
  amount: z.number().int().nonnegative(),
  unit: ApprovalUnit,
  /** Required for credit_over_limit: the customer the sale is about. */
  customerId: z.string().optional(),
  /** Required for a refund: which sale and lines. The amount is recomputed by the server. */
  refund: RefundRequest.optional(),
  /** Why the cashier is asking, shown on the approval card. */
  requestNote: z.string().trim().max(300).optional(),
}).superRefine((v, ctx) => {
  if (v.kind === "discount" && (v.unit !== "percent" || v.amount < 1 || v.amount > 100)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A discount is a percentage from 1 to 100.", path: ["amount"] });
  }
  if (v.kind !== "discount" && (v.unit !== "naira" || v.amount < 1)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a whole-naira amount.", path: ["amount"] });
  }
  if (v.kind === "refund" && !v.refund) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A refund request needs the sale and the lines coming back.", path: ["refund"] });
  }
  if (v.kind === "credit_over_limit" && !v.customerId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A credit request needs a customer.", path: ["customerId"] });
  }
});
export type CreateApprovalInput = z.infer<typeof CreateApprovalInput>;

/** An approved discount is a percentage of the gross subtotal, rounded half up to whole naira. */
export const discountAmount = (subtotal: number, percent: number) => Math.round((subtotal * percent) / 100);

/* ───────────── Sprint 3: branch summary and loss report ───────────── */

/** Figures for the manager home (A02). Computed by the server; the screen only displays them. */
export const BranchSummary = z.object({
  asOf: z.string(),
  salesCount: z.number().int().nonnegative(),
  salesTotal: Naira,
  cashTotal: Naira,
  creditTotal: Naira,
  /** Money refunded so far (paid out or taken off what customers owe). */
  returnsTotal: Naira,
  /** Stock losses ruled against the branch, at cost. */
  shortagesCharged: Naira,
  /** Shortages waiting for a ruling that this user may decide. */
  shortagesWaiting: z.number().int().nonnegative(),
  openShifts: z.number().int().nonnegative(),
  /** Requests this user may decide. */
  pendingApprovals: z.number().int().nonnegative(),
  cashUpsAwaiting: z.number().int().nonnegative(),
});
export type BranchSummary = z.infer<typeof BranchSummary>;

/** G01. Cash-up variance by cashier over all closed shifts. A negative variance is cash missing. */
export const CashUpVarianceRow = z.object({
  cashierId: z.string(), cashierName: z.string(), shifts: z.number().int().nonnegative(),
  totalVariance: z.number().int(), shortShifts: z.number().int().nonnegative(), largestShort: Naira,
});
export type CashUpVarianceRow = z.infer<typeof CashUpVarianceRow>;
export const CashUpVarianceReport = z.object({ asOf: z.string(), rows: z.array(CashUpVarianceRow) });
export type CashUpVarianceReport = z.infer<typeof CashUpVarianceReport>;

/** One rule: days for a change of mind and days for a faulty item. Either may be left out to fall back to the next rule. */
export interface ReturnRule { days?: number; faultyDays?: number }
export interface ReturnRules { defaultDays: number; faultyDays: number; faultyReasons: string[]; byCategory: Record<string, ReturnRule>; byProduct: Record<string, ReturnRule> }
/** Days allowed for a return: product rule, then category rule, then the company default. */
export function returnDaysFor(rules: ReturnRules, product: { id: string; category?: string }, faulty: boolean): number {
  const pick = (r?: ReturnRule) => (faulty ? r?.faultyDays : r?.days);
  return pick(rules.byProduct[product.id]) ?? pick(product.category ? rules.byCategory[product.category] : undefined) ?? (faulty ? rules.faultyDays : rules.defaultDays);
}
/** Whole days between the sale and now (a part day counts as the day it falls in, so day 7 is still allowed). */
export function daysSince(iso: string, nowMs: number): number { return Math.floor((nowMs - Date.parse(iso)) / 86_400_000); }

/* ───────────── Sale lookup and returns (T01) ───────────── */

export const SaleLookupResponse = z.object({
  sale: Sale,
  /** Quantity already returned, by product, so the screen only offers what is left. */
  returned: z.record(z.string(), z.number().int().nonnegative()),
});
export type SaleLookupResponse = z.infer<typeof SaleLookupResponse>;

export const ReturnInput = z.object({
  idempotencyKey: Id,
  clientCreatedAt: z.string(),
  shiftId: Id,
  saleKey: z.string().min(8),
  lines: z.array(ReturnLine).min(1),
  reason: z.string().trim().min(2).max(200),
  /** How the money goes back. Credit is not a refund method: money owed on credit is reduced automatically. */
  refundMethod: PaymentMethod.exclude(["credit"]),
  /** The approved refund request this return is made under. Every return needs one. */
  approvalId: z.string().min(1),
});
export type ReturnInput = z.infer<typeof ReturnInput>;

export const ReturnRecord = ReturnInput.extend({
  returnNo: z.string(),
  invoiceNo: z.string(),
  refundTotal: Naira,
  /** The part that reduced what the customer owes (their credit share), not paid out. */
  refundToBalance: Naira,
  /** The part paid out by refundMethod. */
  refundPaid: Naira,
  cashier: z.object({ id: z.string(), name: z.string() }),
  postedAt: z.string(),
  /** True when the reason is one of `returns.rules.faultyReasons`. A faulty item waits in a check area for an inspector. */
  faulty: z.boolean().optional(),
  /** Where the returned goods are. Absent for a change-of-mind return, which goes straight back on the shelf. */
  inspection: z.object({
    status: z.enum(["pending", "restocked", "rma"]),
    by: z.object({ id: z.string(), name: z.string() }).optional(),
    at: z.string().optional(),
    note: z.string().optional(),
  }).optional(),
});
export type ReturnRecord = z.infer<typeof ReturnRecord>;
/* ───────────── Orders built on the floor, paid at the till ───────────── */

export const OrderStatus = z.enum(["open", "paid", "cancelled"]);
export type OrderStatus = z.infer<typeof OrderStatus>;
/**
 * An order is built by a sales attendant on a phone or tablet and handed to a cashier, who picks it up and takes payment.
 * Prices are set by the server when the order is made. In ERPNext this is a Sales Order that becomes the Sales Invoice.
 */
export const SalesOrder = z.object({
  id: z.string(),
  status: OrderStatus,
  lines: z.array(SaleLine),
  customerId: z.string().optional(),
  customerName: z.string().optional(),
  note: z.string().optional(),
  createdBy: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string(),
  /** Set when the order was paid. */
  invoiceNo: z.string().optional(),
  paidAt: z.string().optional(),
  cancelledAt: z.string().optional(),
});
export type SalesOrder = z.infer<typeof SalesOrder>;
export const CreateOrderInput = z.object({
  idempotencyKey: Id,
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1),
  customerId: z.string().optional(),
  note: z.string().trim().max(300).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
export const OrdersResponse = z.object({ orders: z.array(SalesOrder) });
export type OrdersResponse = z.infer<typeof OrdersResponse>;
export const OrderResponse = z.object({ order: SalesOrder, duplicate: z.boolean() });
export type OrderResponse = z.infer<typeof OrderResponse>;

/* ───────────── Fixing a wrong-variant sale (Scenario 13) ───────────── */

/**
 * A Black case was sold as Clear. A manager fixes it: the stock of both is corrected, the price difference is settled
 * (collected from the customer, paid back, or covered by the shop) and the reason and the people are recorded.
 * The sale document itself is not rewritten here; in ERPNext that is a credit note and a new invoice (docs/ERPNEXT-MAPPING.md).
 */
export const MixupSettlement = z.enum(["collected", "refunded", "shop_covers"]);
export type MixupSettlement = z.infer<typeof MixupSettlement>;
export const MixupCorrectionInput = z.object({
  idempotencyKey: Id,
  saleKey: z.string().min(8),
  /** What the till said was sold. */
  wrongProductId: z.string(),
  /** What the customer really took. */
  rightProductId: z.string(),
  qty: z.number().int().positive(),
  settlement: MixupSettlement,
  note: z.string().trim().min(2).max(300),
});
export type MixupCorrectionInput = z.infer<typeof MixupCorrectionInput>;
export const MixupCorrection = MixupCorrectionInput.extend({
  id: z.string(),
  invoiceNo: z.string(),
  wrongName: z.string(),
  rightName: z.string(),
  /** Price of what was really taken minus the price charged, times quantity. Positive: the customer owed more. */
  difference: z.number().int(),
  soldBy: z.object({ id: z.string(), name: z.string() }),
  fixedBy: z.object({ id: z.string(), name: z.string() }),
  fixedAt: z.string(),
});
export type MixupCorrection = z.infer<typeof MixupCorrection>;
export const MixupCorrectionResponse = z.object({ correction: MixupCorrection, duplicate: z.boolean() });
export type MixupCorrectionResponse = z.infer<typeof MixupCorrectionResponse>;
/** Mix-ups by the person who made the sale, to coach staff and to spot a pattern. */
export const MixupReport = z.object({
  rows: z.array(z.object({ cashier: z.object({ id: z.string(), name: z.string() }), count: z.number().int(), units: z.number().int(), netDifference: z.number().int() })),
  corrections: z.array(MixupCorrection),
});
export type MixupReport = z.infer<typeof MixupReport>;

/** An inspector decides what happens to a faulty return: back on the shelf, or sent back to the supplier (RMA). */
export const InspectReturnInput = z.object({
  idempotencyKey: Id,
  outcome: z.enum(["restock", "rma"]),
  note: z.string().trim().max(300).optional(),
});
export type InspectReturnInput = z.infer<typeof InspectReturnInput>;
export const ReturnInspectionsResponse = z.object({ returns: z.array(ReturnRecord) });
export type ReturnInspectionsResponse = z.infer<typeof ReturnInspectionsResponse>;
export const ReturnResponse = z.object({ ret: ReturnRecord, duplicate: z.boolean() });
export type ReturnResponse = z.infer<typeof ReturnResponse>;

/* ───────────── Branch stock request (H02) ───────────── */

export const StockRequestStatus = z.enum(["requested", "dispatched", "received", "cancelled"]);
export type StockRequestStatus = z.infer<typeof StockRequestStatus>;

export const CreateStockRequestInput = z.object({
  idempotencyKey: Id,
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1),
  note: z.string().trim().max(300).optional(),
  /** Ask a sister branch instead of the central warehouse. Absent means the warehouse, as before. */
  fromBranch: z.string().optional(),
});
export type CreateStockRequestInput = z.infer<typeof CreateStockRequestInput>;

export const StockRequest = z.object({
  id: z.string(),
  status: StockRequestStatus,
  lines: z.array(z.object({ productId: z.string(), name: z.string(), qty: z.number().int().positive() })),
  note: z.string().optional(),
  requestedBy: z.object({ id: z.string(), name: z.string() }),
  requestedAt: z.string(),
  /** Set when this is a request to a sister branch rather than the warehouse. */
  fromBranch: z.string().optional(),
  /** The branch that asked, and so the branch whose people must sign for the goods when they arrive. */
  toBranch: z.string().optional(),
});
export type StockRequest = z.infer<typeof StockRequest>;
export const StockRequestsResponse = z.object({ requests: z.array(StockRequest) });
export type StockRequestsResponse = z.infer<typeof StockRequestsResponse>;
export const StockRequestResponse = z.object({ request: StockRequest, duplicate: z.boolean() });
export type StockRequestResponse = z.infer<typeof StockRequestResponse>;

/* ───────────── Sprint 4: transfers, stock levels, in-transit report ───────────── */

export const TransferStatus = z.enum(["in_transit", "received"]);
export type TransferStatus = z.infer<typeof TransferStatus>;

export const Transfer = z.object({
  id: z.string(),
  requestId: z.string().optional(),
  status: TransferStatus,
  lines: z.array(z.object({ productId: z.string(), name: z.string(), qtySent: z.number().int().positive(), qtyReceived: z.number().int().nonnegative().optional() })),
  dispatchedBy: z.object({ id: z.string(), name: z.string() }),
  dispatchedAt: z.string(),
  receivedBy: z.object({ id: z.string(), name: z.string() }).optional(),
  receivedAt: z.string().optional(),
  /** Units that were sent but not received. A shortage is flagged against the transfer, never hidden. */
  shortage: z.number().int().nonnegative(),
  receiveNote: z.string().optional(),
  /** Set when this transfer was sent by a sister branch rather than the warehouse. */
  fromBranch: z.string().optional(),
  /** The branch the goods are going to. Only that branch's stock officer or manager can sign for them. */
  toBranch: z.string().optional(),
});
export type Transfer = z.infer<typeof Transfer>;
export const TransfersResponse = z.object({ transfers: z.array(Transfer) });
export type TransfersResponse = z.infer<typeof TransfersResponse>;
export const TransferResponse = z.object({ transfer: Transfer, duplicate: z.boolean() });
export type TransferResponse = z.infer<typeof TransferResponse>;

/** Sister branches that may be asked for stock (never the caller's own branch). */
export const BranchesResponse = z.object({ branches: z.array(z.string()) });
export type BranchesResponse = z.infer<typeof BranchesResponse>;

/** The warehouse, or a sister branch, picks and packs a requested stock order and sends it. It may send less than was asked for. */
export const DispatchInput = z.object({
  idempotencyKey: Id,
  requestId: z.string(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1),
});
export type DispatchInput = z.infer<typeof DispatchInput>;

/** The branch counts what arrived. Receiving less than was sent is a shortage; receiving more is refused. */
export const ReceiveInput = z.object({
  idempotencyKey: Id,
  transferId: z.string(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().nonnegative() })).min(1),
  note: z.string().trim().max(300).optional(),
});
export type ReceiveInput = z.infer<typeof ReceiveInput>;

export const StockLevel = z.object({
  productId: z.string(), name: z.string(), sku: z.string(), barcode: z.string(), branch: z.number().int(), warehouse: z.number().int(),
  /** Quantity held by each sister branch (name -> qty), excluding the caller's own branch and the warehouse. */
  branches: z.record(z.string(), z.number().int()),
});
export type StockLevel = z.infer<typeof StockLevel>;
export const StockLevelsResponse = z.object({ asOf: z.string(), levels: z.array(StockLevel) });
export type StockLevelsResponse = z.infer<typeof StockLevelsResponse>;

/** G02. Transfers that have been on the road longer than the alert time. */
export const InTransitReport = z.object({
  asOf: z.string(),
  thresholdHours: z.number().int().positive(),
  rows: z.array(z.object({
    transferId: z.string(), dispatchedBy: z.string(), dispatchedAt: z.string(), hoursInTransit: z.number().int().nonnegative(), units: z.number().int().nonnegative(),
  })),
});
export type InTransitReport = z.infer<typeof InTransitReport>;

/* ───────────── Physical stock count (K01) and write-off (K02) ───────────── */

export const CountLocation = z.enum(["branch", "warehouse"]);
export type CountLocation = z.infer<typeof CountLocation>;

/** needs_recount: some items differ and a different person must count them again. review: differences stand. */
export const CountStatus = z.enum(["needs_recount", "review", "write_off_requested", "adjusted", "closed"]);
export type CountStatus = z.infer<typeof CountStatus>;

/** The sheet to count from. It never carries the system quantity: the count is blind. */
export const CountSheet = z.object({
  location: CountLocation,
  asOf: z.string(),
  items: z.array(z.object({ productId: z.string(), name: z.string(), sku: z.string(), barcode: z.string() })),
});
export type CountSheet = z.infer<typeof CountSheet>;

export const CountSubmitInput = z.object({
  idempotencyKey: Id,
  location: CountLocation,
  /** Present on the recount (round 2) of an existing count. */
  countId: z.string().optional(),
  lines: z.array(z.object({ productId: z.string(), counted: z.number().int().nonnegative() })).min(1),
  countedAt: z.string(),
  note: z.string().trim().max(300).optional(),
});
export type CountSubmitInput = z.infer<typeof CountSubmitInput>;

export const StockCount = z.object({
  id: z.string(),
  location: CountLocation,
  status: CountStatus,
  round: z.number().int().min(1).max(2),
  countedBy: z.object({ id: z.string(), name: z.string() }),
  countedAt: z.string(),
  recountBy: z.object({ id: z.string(), name: z.string() }).optional(),
  note: z.string().optional(),
  lines: z.array(z.object({
    productId: z.string(), name: z.string(), counted: z.number().int().nonnegative(), family: z.string().optional(),
    /** True while this item must be counted again. The expected quantity is not shown until the count is final. */
    needsRecount: z.boolean(),
    expected: z.number().int().optional(),
    difference: z.number().int().optional(),
  })),
  writeOffApprovalId: z.string().optional(),
});
export type StockCount = z.infer<typeof StockCount>;
export const CountsResponse = z.object({ counts: z.array(StockCount) });
export type CountsResponse = z.infer<typeof CountsResponse>;
export const CountResponse = z.object({ count: StockCount, duplicate: z.boolean() });
export type CountResponse = z.infer<typeof CountResponse>;

export const WriteOffRequestInput = z.object({ idempotencyKey: Id, note: z.string().trim().max(300).optional() });
export type WriteOffRequestInput = z.infer<typeof WriteOffRequestInput>;
export const WriteOffRequestResponse = z.object({ count: StockCount, approval: Approval, duplicate: z.boolean() });
export type WriteOffRequestResponse = z.infer<typeof WriteOffRequestResponse>;

/* ───────────── Goods receipt from a supplier (H01) ───────────── */

/** A line of a purchase order. qtyReceived is cumulative across every receipt made against this order so far. */
export const PurchaseOrderLine = z.object({
  productId: z.string(), name: z.string(), qtyOrdered: z.number().int().positive(), qtyReceived: z.number().int().nonnegative(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const PurchaseOrderStatus = z.enum(["open", "partially_received", "received"]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

/** A purchase order is raised on R01 by anyone holding the Procurement permission, and received on H01. */
export const PurchaseOrder = z.object({
  id: z.string(),
  supplierName: z.string(),
  /** The supplier's own order or invoice number, free text. */
  reference: z.string().optional(),
  status: PurchaseOrderStatus,
  lines: z.array(PurchaseOrderLine),
  createdAt: z.string(),
  /** Who raised it. Absent for orders that arrived from outside the app. */
  raisedBy: z.object({ id: z.string(), name: z.string() }).optional(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;
/**
 * Raise a purchase order (R01). Who may is a permission (the Procurement area), given to a role or to named people;
 * it is not tied to a job title. Safe to retry (idempotency key).
 */
export const CreatePurchaseOrderInput = z.object({
  idempotencyKey: Id,
  supplierName: z.string().trim().min(2).max(120),
  reference: z.string().trim().max(60).optional(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().positive() })).min(1),
});
export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderInput>;
export const PurchaseOrdersResponse = z.object({ purchaseOrders: z.array(PurchaseOrder) });
export type PurchaseOrdersResponse = z.infer<typeof PurchaseOrdersResponse>;
export const PurchaseOrderResponse = z.object({ purchaseOrder: PurchaseOrder, duplicate: z.boolean() });
export type PurchaseOrderResponse = z.infer<typeof PurchaseOrderResponse>;

/**
 * What arrived from a supplier against one purchase order, scanned as it comes off the truck. Receiving less than
 * ordered is normal (the rest may arrive in a later receipt); receiving more than the order plus the configured
 * over-receipt allowance is refused.
 */
export const GoodsReceiptInput = z.object({
  idempotencyKey: Id,
  purchaseOrderId: z.string(),
  lines: z.array(z.object({ productId: z.string(), qty: z.number().int().nonnegative() })).min(1),
  note: z.string().trim().max(300).optional(),
});
export type GoodsReceiptInput = z.infer<typeof GoodsReceiptInput>;

/* ───────────── Sprint 4: delivery ───────────── */

export const DeliveryStatus = z.enum(["pending", "assigned", "delivered", "failed"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;
export const DeliveryPayment = z.enum(["prepaid", "cash_on_delivery"]);
export type DeliveryPayment = z.infer<typeof DeliveryPayment>;

export const DeliveryOrder = z.object({
  id: z.string(),
  customerName: z.string(),
  phone: z.string(),
  address: z.string(),
  items: z.array(z.object({ productId: z.string(), name: z.string(), qty: z.number().int().positive() })),
  payment: DeliveryPayment,
  /** What the rider must collect. Zero when the customer already paid. */
  amountDue: Naira,
  status: DeliveryStatus,
  riderId: z.string().optional(),
  riderName: z.string().optional(),
  assignedAt: z.string().optional(),
  deliveredAt: z.string().optional(),
  recipient: z.string().optional(),
  failedReason: z.string().optional(),
  /** What the rider actually collected (cash on delivery). */
  cashCollected: Naira.optional(),
  /** Set while the cash is waiting for a manager to confirm it. */
  remittanceId: z.string().optional(),
  /** True once a manager confirmed the cash was handed in. */
  remitted: z.boolean(),
  createdAt: z.string(),
});
export type DeliveryOrder = z.infer<typeof DeliveryOrder>;
export const DeliveryOrdersResponse = z.object({ orders: z.array(DeliveryOrder) });
export type DeliveryOrdersResponse = z.infer<typeof DeliveryOrdersResponse>;
export const RidersResponse = z.object({ riders: z.array(z.object({ id: z.string(), name: z.string() })) });
export type RidersResponse = z.infer<typeof RidersResponse>;

export const AssignInput = z.object({ idempotencyKey: Id, riderId: z.string() });
export type AssignInput = z.infer<typeof AssignInput>;
export const DeliveryOrderResponse = z.object({ order: DeliveryOrder, duplicate: z.boolean() });
export type DeliveryOrderResponse = z.infer<typeof DeliveryOrderResponse>;

/** Proof of delivery, or of a failed delivery with its reason. Safe to retry; works offline. */
export const ProofInput = z.object({
  idempotencyKey: Id,
  orderId: z.string(),
  outcome: z.enum(["delivered", "failed"]),
  recipient: z.string().trim().max(100).optional(),
  failedReason: z.string().trim().max(200).optional(),
  /** Required to deliver a cash-on-delivery order: what was actually collected. */
  cashCollected: Naira.optional(),
  /** A photo as a data URL, kept small by the screen. */
  photo: z.string().max(700_000).optional(),
  at: z.string(),
}).superRefine((v, ctx) => {
  if (v.outcome === "failed" && (v.failedReason?.length ?? 0) < 2) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A failed delivery needs a reason.", path: ["failedReason"] });
});
export type ProofInput = z.infer<typeof ProofInput>;

export const RemitInput = z.object({ idempotencyKey: Id, orderIds: z.array(z.string()).min(1) });
export type RemitInput = z.infer<typeof RemitInput>;
export const RemitResponse = z.object({ approval: Approval, duplicate: z.boolean() });
export type RemitResponse = z.infer<typeof RemitResponse>;

/** L05. Cash on delivery that riders collected and have not yet handed in. */
export const CodOutstanding = z.object({
  asOf: z.string(),
  thresholdHours: z.number().int().positive(),
  riders: z.array(z.object({
    riderId: z.string(), riderName: z.string(), orders: z.number().int().nonnegative(), amount: Naira,
    oldestDeliveredAt: z.string(), hoursOutstanding: z.number().int().nonnegative(), overdue: z.boolean(),
  })),
});
export type CodOutstanding = z.infer<typeof CodOutstanding>;
