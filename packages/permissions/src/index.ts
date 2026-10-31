import type { Approval, ApprovalKind, ApprovalStep, Capabilities } from "@erp/api-contract";
import matrix from "./data/roles-matrix.json";
import limits from "./data/approval-limits.json";
import routingData from "./data/approval-routing.json";
import screensData from "./data/screens.json";

export interface ScreenDef {
  id: string;
  area: string;
  title: string;
  roles: string[];
  erpnext: string;
  verdict: "Use ERPNext" | "Configure ERPNext" | "Build custom";
  pattern: string;
  device: string;
  offline: string;
  scope: "MVP" | "Later";
  sprint: string;
}

export const SCREENS = screensData as ScreenDef[];
export const AREAS = matrix.areas as string[];
export const ROLE_MATRIX = matrix.roles as Record<string, Record<string, string>>;
export const APPROVAL_LIMITS = limits as Array<{
  control: string; placeholder: boolean; actor: string; limit: number; unit: string; above: string;
}>;

/** Screens that are not a menu destination: shown by the shell itself. */
export const UTILITY_IDS = new Set(["P01", "P02", "P03", "P06"]);

export type DestinationKey =
  | "approvals" | "sell" | "stock" | "delivery" | "cash" | "reports"
  | "customers" | "buy" | "money" | "people" | "repairs" | "oversight" | "more";

const AREA_TO_DESTINATION: Record<string, DestinationKey> = {
  Approvals: "approvals",
  "Stores (POS)": "sell", Returns: "sell", "Credit sales": "sell",
  Warehouse: "stock", "Stock control": "stock",
  Delivery: "delivery",
  "Cash-up": "cash",
  Reporting: "reports",
  "Web and app": "customers", CRM: "customers", "Customer success": "customers", Marketing: "customers", "Digital media": "customers",
  Procurement: "buy",
  Accounting: "money", Payments: "money", Payroll: "money", "Tax and VAT": "money", Expenses: "money", Assets: "money",
  "HR and staff": "people",
  Repairs: "repairs",
  Audit: "oversight", "Admin and IT": "oversight",
};
export const destinationFor = (area: string): DestinationKey => AREA_TO_DESTINATION[area] ?? "more";

/** Does this user hold the permission letter (V, C, E or A) on a matrix area? */
export function can(caps: Capabilities, area: string, letter: "V" | "C" | "E" | "A"): boolean {
  return (caps.areas[area] ?? "").includes(letter);
}
const canApproveAnywhere = (caps: Capabilities) => Object.values(caps.areas).some((l) => l.includes("A"));

/** Which matrix area holds the approve step for each kind of exception. */
const APPROVAL_AREA: Record<ApprovalKind, string> = {
  discount: "Stores (POS)",
  void: "Returns",
  credit_over_limit: "Credit sales",
  cash_up: "Cash-up",
  refund: "Returns",
  shortage: "Stock control",
  write_off: "Stock control",
  cash_remittance: "Delivery",
};
export const approvalArea = (kind: ApprovalKind): string => APPROVAL_AREA[kind];

const controlFor = (kind: ApprovalKind, role?: string) =>
  kind === "discount"
    ? role === "Cashier" ? "Discount at till" : "Discount"
    : kind === "void" || kind === "refund" ? "Refund or void" : kind === "shortage" || kind === "write_off" ? "Stock write-off" : "credit sale over limit or overdue";

/** The limit that applies to the approver level, read from the approval-limits table (configuration, not code). */
export function approvalThreshold(kind: ApprovalKind): { limit: number; unit: "percent" | "naira" } {
  if (kind === "cash_up" || kind === "cash_remittance") return { limit: 0, unit: "naira" }; // a sign-off, not a limit
  const row = APPROVAL_LIMITS.find((r) => r.control === controlFor(kind));
  return { limit: row?.limit ?? 0, unit: kind === "discount" ? "percent" : "naira" };
}

/** Can this role decide this amount? Credit over-limit is a block release, so it has no naira cap. */
export function withinApprovalLimit(role: string, kind: ApprovalKind, amount: number): boolean {
  if (kind === "credit_over_limit" || kind === "cash_up" || kind === "cash_remittance") return true; // block release / sign-off: no naira cap
  // The role named in the "above" column is the top approver, so no cap applies at that level.
  const above = APPROVAL_LIMITS.find((r) => r.control === controlFor(kind))?.above ?? "";
  if (above && role.toLowerCase().includes(above.toLowerCase())) return true;
  const row = APPROVAL_LIMITS.find((r) => r.control === controlFor(kind, role));
  if (!row) return true; // no configured cap at this level (the MD or an unreviewed control)
  return amount <= row.limit;
}
export const withinApprovalLimitFor = (caps: Capabilities, kind: ApprovalKind, amount: number): boolean =>
  caps.roles.some((role) => withinApprovalLimit(role, kind, amount));

/** Who decides each kind of approval (data/approval-routing.json). Roles are role names, in ordered steps. */
export type ApprovalRouting = Partial<Record<ApprovalKind, Array<{ roles: string[] }>>>;
export const APPROVAL_ROUTING = Object.fromEntries(Object.entries(routingData).filter(([k]) => !k.startsWith("_"))) as ApprovalRouting;

/** The pending chain for a new approval of this kind, or undefined when the kind uses the matrix Approve letter. */
export function stepsFor(kind: ApprovalKind, routing: ApprovalRouting = APPROVAL_ROUTING): ApprovalStep[] | undefined {
  const route = routing[kind];
  return route?.length ? route.map((r) => ({ roles: [...r.roles], status: "pending" as const })) : undefined;
}

/** The step waiting for a decision, or undefined when there is no chain or it is finished. */
export const currentStep = (a: Pick<Approval, "steps">): { index: number; step: ApprovalStep } | undefined => {
  const index = a.steps?.findIndex((s) => s.status === "pending") ?? -1;
  return index >= 0 && a.steps ? { index, step: a.steps[index]! } : undefined;
};

/** Has this person already decided an earlier step of the same request? (Dual control: a second person must decide the next step.) */
export const decidedEarlier = (a: Pick<Approval, "steps">, userId: string): boolean =>
  (a.steps ?? []).some((s) => s.status !== "pending" && s.decidedBy?.id === userId);

/** Can this person decide this kind of approval at all (the matrix Approve letter, or named in its routing)? Used to show the inbox. */
export function mayApproveKind(caps: Capabilities, kind: ApprovalKind, routing: ApprovalRouting = APPROVAL_ROUTING): boolean {
  const route = routing[kind];
  if (route?.length) return route.some((st) => st.roles.some((r) => caps.roles.includes(r)));
  return can(caps, approvalArea(kind), "A");
}
const KINDS: ApprovalKind[] = ["discount", "void", "credit_over_limit", "cash_up", "refund", "shortage", "write_off", "cash_remittance"];

/** May this role see the approval at all (so it can appear in their inbox)? */
export function mayViewApproval(caps: Capabilities, a: Pick<Approval, "kind" | "steps" | "requestedBy">): boolean {
  if (a.requestedBy.id === caps.user.id) return true;
  if (a.steps?.length) return a.steps.some((s) => s.roles.some((r) => caps.roles.includes(r)));
  return can(caps, approvalArea(a.kind), "A");
}

/**
 * Can this person decide the approval right now? The server enforces this too; the UI only hides the buttons.
 * - the requester never decides their own request;
 * - with a chain, only the roles of the current step, and never a person who already decided an earlier step;
 * - without a chain, the Approve letter on the matrix area;
 * - and the amount must be within the approver's limit.
 */
export function mayDecideApproval(caps: Capabilities, a: Pick<Approval, "kind" | "steps" | "requestedBy" | "amount" | "status">): boolean {
  if (a.status !== "pending" || caps.user.id === a.requestedBy.id) return false;
  const roleOk = a.steps?.length
    ? (() => { const cur = currentStep(a); return !!cur && cur.step.roles.some((r) => caps.roles.includes(r)) && !decidedEarlier(a, caps.user.id); })()
    : can(caps, approvalArea(a.kind), "A");
  return roleOk && withinApprovalLimitFor(caps, a.kind, a.amount);
}

/** The areas a set of roles can see, merged across roles (used by the mock server; the real one is ERPNext). */
export function areasForRoles(roles: string[]): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const role of roles) {
    for (const [area, letters] of Object.entries(ROLE_MATRIX[role] ?? {})) {
      merged[area] = [...new Set((merged[area] ?? "") + letters)].sort().join("");
    }
  }
  return merged;
}

export interface NavInput {
  caps: Capabilities;
  taskRoles: string[];
  enabledScopes: Array<"MVP" | "Later">;
  screens?: ScreenDef[];
}
export interface Destination { key: DestinationKey; screens: ScreenDef[] }
export interface Navigation {
  /** "tasks" roles (cashier, rider) get big task tiles and no menu. */
  workspace: "menu" | "tasks";
  destinations: Destination[];
  utilities: ScreenDef[];
  visible: ScreenDef[];
}

/** Server is the authority; this only decides what to show. Hidden, never greyed out. */
export function isVisible(screen: ScreenDef, caps: Capabilities, enabledScopes: string[]): boolean {
  if (!enabledScopes.includes(screen.scope)) return false;
  // Approver screens follow the approval setting, not the screen's role list: whoever can decide something sees the inbox.
  if (screen.id === "A01") return canApproveAnywhere(caps) || KINDS.some((k) => mayApproveKind(caps, k));
  if (screen.id === "Q02") return mayApproveKind(caps, "cash_up");
  // Counting stock: anyone who may create counts, so a different person can do the recount (not only the Stock controller).
  if (screen.id === "K01") return can(caps, "Stock control", "C");
  if (!screen.roles.some((r) => caps.roles.includes(r))) return false;
  if (screen.area === "Approvals") return canApproveAnywhere(caps);
  if (AREAS.includes(screen.area)) return can(caps, screen.area, "V");
  return true; // Platform screens
}

export function buildNavigation(input: NavInput): Navigation {
  const { caps, taskRoles, enabledScopes, screens = SCREENS } = input;
  const visible = screens.filter((s) => isVisible(s, caps, enabledScopes));
  const utilities = visible.filter((s) => UTILITY_IDS.has(s.id));
  const content = visible.filter((s) => !UTILITY_IDS.has(s.id) && s.area !== "Platform");
  const byKey = new Map<DestinationKey, ScreenDef[]>();
  for (const s of content) {
    const k = destinationFor(s.area);
    byKey.set(k, [...(byKey.get(k) ?? []), s]);
  }
  const order: DestinationKey[] = ["approvals", "sell", "stock", "delivery", "cash", "reports", "customers", "buy", "money", "people", "repairs", "oversight", "more"];
  const destinations = order.filter((k) => byKey.has(k)).map((key) => ({ key, screens: byKey.get(key)! }));
  const workspace = caps.roles.some((r) => taskRoles.includes(r)) ? "tasks" : "menu";
  return { workspace, destinations, utilities, visible };
}
