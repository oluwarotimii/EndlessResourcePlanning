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
export const ShiftCloseInput = z.object({ idempotencyKey: Id, shiftId: Id, closedAt: z.string(), countedCash: Naira });
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
export const ApprovalKind = z.enum(["discount", "void", "credit_over_limit"]);
export type ApprovalKind = z.infer<typeof ApprovalKind>;

export const ApprovalStatus = z.enum(["pending", "approved", "rejected"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;

/** Percent for discounts, whole naira for money amounts. */
export const ApprovalUnit = z.enum(["percent", "naira"]);
export type ApprovalUnit = z.infer<typeof ApprovalUnit>;

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
  customerName: z.string().optional(),
  /** Why the request was raised, in the requester's words. */
  requestNote: z.string().optional(),
  decidedBy: z.object({ id: z.string(), name: z.string() }).optional(),
  decidedAt: z.string().optional(),
  /** Required on rejection; an approval may also carry a note. */
  decisionReason: z.string().optional(),
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
}).refine((v) => v.decision !== "reject" || (v.reason?.length ?? 0) >= 3, {
  message: "A rejection needs a reason.", path: ["reason"],
});
export type ApprovalDecisionInput = z.infer<typeof ApprovalDecisionInput>;

export const ApprovalResponse = z.object({ approval: Approval, duplicate: z.boolean() });
export type ApprovalResponse = z.infer<typeof ApprovalResponse>;
