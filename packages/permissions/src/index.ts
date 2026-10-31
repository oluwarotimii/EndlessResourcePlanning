import type { ApprovalKind, Capabilities } from "@erp/api-contract";
import matrix from "./data/roles-matrix.json";
import limits from "./data/approval-limits.json";
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
};
export const approvalArea = (kind: ApprovalKind): string => APPROVAL_AREA[kind];

/** The server enforces this too; the UI only hides the buttons. The creator never approves their own request. */
export function mayDecideApproval(caps: Capabilities, kind: ApprovalKind, requesterId: string): boolean {
  return caps.user.id !== requesterId && can(caps, approvalArea(kind), "A");
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
