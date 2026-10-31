import { describe, expect, it } from "vitest";
import type { Capabilities } from "@erp/api-contract";
import { AREAS, ROLE_MATRIX, SCREENS, approvalArea, approvalThreshold, areasForRoles, buildNavigation, mayDecideApproval, withinApprovalLimit } from "./index";

const PILOT = ["Cashier", "Branch manager", "Warehouse officer", "Stock controller", "Rider / courier", "Delivery coordinator", "Procurement officer"];
const TASK_ROLES = ["Cashier", "Rider / courier", "Technician"];

const caps = (role: string): Capabilities => ({
  user: { id: "u", name: "Test" }, roles: [role], areas: areasForRoles([role]), scope: {},
});
type Kind = "discount" | "void" | "credit_over_limit" | "cash_up";
const ap = (kind: Kind, requester: string, amount = 1, extra: Record<string, unknown> = {}) =>
  ({ kind, requestedBy: { id: requester, name: requester }, amount, status: "pending" as const, ...extra });
const nav = (role: string) => buildNavigation({ caps: caps(role), taskRoles: TASK_ROLES, enabledScopes: ["MVP"] });

describe("generated fixtures", () => {
  it("match the planning documents: 20 roles, 24 areas, 93 screens, 29 MVP in the spreadsheet plus R01 promoted by scope-overrides.json", () => {
    expect(Object.keys(ROLE_MATRIX)).toHaveLength(20);
    expect(AREAS).toHaveLength(24);
    expect(SCREENS).toHaveLength(93);
    expect(SCREENS.filter((s) => s.scope === "MVP")).toHaveLength(30);
  });
  it("every MVP screen is reachable by at least one pilot role", () => {
    const seen = new Set(PILOT.flatMap((r) => nav(r).visible.map((s) => s.id)));
    const missing = SCREENS.filter((s) => s.scope === "MVP" && !seen.has(s.id)).map((s) => s.id);
    expect(missing).toEqual([]);
  });
});

describe("permission-driven navigation", () => {
  it("gives different roles different screens", () => {
    const ids = (r: string) => nav(r).visible.map((s) => s.id).sort().join();
    expect(ids("Cashier")).not.toBe(ids("Branch manager"));
    expect(ids("Branch manager")).not.toBe(ids("Warehouse officer"));
  });
  it("cashier and rider get task screens, managers get a menu", () => {
    expect(nav("Cashier").workspace).toBe("tasks");
    expect(nav("Rider / courier").workspace).toBe("tasks");
    expect(nav("Branch manager").workspace).toBe("menu");
  });
  it("only roles that can approve see the approvals inbox", () => {
    const has = (r: string) => nav(r).visible.some((s) => s.id === "A01");
    expect(has("Branch manager")).toBe(true);
    expect(has("Cashier")).toBe(false);
    expect(has("Warehouse officer")).toBe(false);
  });
  it("cashier never sees the cash-up sign-off or the stock count", () => {
    const ids = nav("Cashier").visible.map((s) => s.id);
    expect(ids).toContain("Q01");
    expect(ids).not.toContain("Q02");
    expect(ids).not.toContain("K01");
  });
  it("keeps every pilot role to five destinations or fewer", () => {
    for (const r of PILOT) expect(nav(r).destinations.length, r).toBeLessThanOrEqual(5);
  });
  it("hides Later screens until their scope is enabled", () => {
    const later = buildNavigation({ caps: caps("Branch manager"), taskRoles: TASK_ROLES, enabledScopes: ["MVP", "Later"] });
    expect(later.visible.length).toBeGreaterThan(nav("Branch manager").visible.length);
  });
});

describe("who may decide an approval", () => {
  it("maps each exception to the area that holds the approve step", () => {
    expect(approvalArea("discount")).toBe("Stores (POS)");
    expect(approvalArea("void")).toBe("Returns");
    expect(approvalArea("credit_over_limit")).toBe("Credit sales");
  });

  it("needs the approve letter on that area", () => {
    expect(mayDecideApproval(caps("Branch manager"), ap("discount", "u-cashier"))).toBe(true);
    expect(mayDecideApproval(caps("Cashier"), ap("discount", "u-manager"))).toBe(false);
    expect(mayDecideApproval(caps("Warehouse officer"), ap("void", "u-cashier"))).toBe(false);
  });

  it("never lets the creator approve their own request", () => {
    expect(mayDecideApproval(caps("Branch manager"), ap("discount", "u"))).toBe(false);
  });

  it("reads the approver limit from the approval-limits table", () => {
    expect(approvalThreshold("discount")).toEqual({ limit: 3, unit: "percent" });
    expect(approvalThreshold("void")).toEqual({ limit: 50000, unit: "naira" });
  });

  it("refuses an approval above the approver's own limit", () => {
    expect(withinApprovalLimit("Branch manager", "discount", 2)).toBe(true);
    expect(withinApprovalLimit("Branch manager", "discount", 5)).toBe(false);
    expect(withinApprovalLimit("Branch manager", "void", 50000)).toBe(true);
    expect(withinApprovalLimit("Branch manager", "void", 50001)).toBe(false);
    expect(withinApprovalLimit("Branch manager", "credit_over_limit", 999999)).toBe(true);
    expect(withinApprovalLimit("MD / Executive", "discount", 99)).toBe(true);
    expect(mayDecideApproval(caps("Branch manager"), ap("discount", "u-cashier", 5))).toBe(false);
    expect(mayDecideApproval(caps("Branch manager"), ap("discount", "u-cashier", 2))).toBe(true);
  });
});

describe("cash-up sign-off (owner to confirm the approver, see docs/DECISIONS.md)", () => {
  it("the Branch manager and the Cash controller may approve a cash-up; the Cashier may not", async () => {
    const { can, areasForRoles: areas, withinApprovalLimit, approvalArea } = await import("./index");
    const caps = (role: string) => ({ user: { id: "u", name: "T" }, roles: [role], areas: areas([role]), scope: {} });
    expect(approvalArea("cash_up")).toBe("Cash-up");
    expect(can(caps("Branch manager"), "Cash-up", "A")).toBe(true);
    expect(can(caps("Cash controller"), "Cash-up", "A")).toBe(true);
    expect(can(caps("Cashier"), "Cash-up", "A")).toBe(false);
    expect(withinApprovalLimit("Branch manager", "cash_up", 999999)).toBe(true); // a sign-off, no naira cap
  });
});

describe("who decides is a setting (approval routing)", () => {
  const step = (roles: string[], status: "pending" | "approved" = "pending", by?: string) => ({ roles, status, ...(by ? { decidedBy: { id: by, name: by } } : {}) });

  it("every role named in the routing file exists in the roles matrix (typo guard)", async () => {
    const { APPROVAL_ROUTING, ROLE_MATRIX } = await import("./index");
    for (const [kind, steps] of Object.entries(APPROVAL_ROUTING)) {
      for (const r of steps ?? []) for (const role of r.roles) expect(Object.keys(ROLE_MATRIX), `${kind}: ${role}`).toContain(role);
    }
  });
  it("a kind with no routing has no chain and falls back to the matrix letter", async () => {
    const { stepsFor } = await import("./index");
    expect(stepsFor("discount", {})).toBeUndefined();
    expect(stepsFor("cash_up", { cash_up: [{ roles: ["Auditor"] }] })).toEqual([{ roles: ["Auditor"], status: "pending" }]);
  });
  it("with a chain only the roles of the CURRENT step may decide", () => {
    const chain = [step(["Branch manager"]), step(["MD / Executive"])];
    expect(mayDecideApproval(caps("Branch manager"), ap("credit_over_limit", "u-cashier", 1, { steps: chain }))).toBe(true);
    expect(mayDecideApproval(caps("MD / Executive"), ap("credit_over_limit", "u-cashier", 1, { steps: chain }))).toBe(false); // not their turn yet
    const afterFirst = [step(["Branch manager"], "approved", "u-boss"), step(["MD / Executive"])];
    expect(mayDecideApproval(caps("MD / Executive"), ap("credit_over_limit", "u-cashier", 1, { steps: afterFirst }))).toBe(true);
    expect(mayDecideApproval(caps("Branch manager"), ap("credit_over_limit", "u-cashier", 1, { steps: afterFirst }))).toBe(false);
  });
  it("a role not in the matrix as an approver can still be named in the routing (for example the Auditor)", () => {
    expect(mayDecideApproval(caps("Auditor"), ap("cash_up", "u-cashier", 1))).toBe(false); // no chain: matrix says no
    expect(mayDecideApproval(caps("Auditor"), ap("cash_up", "u-cashier", 1, { steps: [step(["Auditor"])] }))).toBe(true);
    expect(mayDecideApproval(caps("Branch manager"), ap("cash_up", "u-cashier", 1, { steps: [step(["Auditor"])] }))).toBe(false);
  });
  it("one person can never decide two steps of the same request", () => {
    const chain = [step(["Branch manager", "MD / Executive"], "approved", "u"), step(["Branch manager", "MD / Executive"])];
    const me = { ...caps("Branch manager"), user: { id: "u", name: "u" } };
    expect(mayDecideApproval(me, ap("credit_over_limit", "u-cashier", 1, { steps: chain }))).toBe(false);
    const md = { ...caps("MD / Executive"), user: { id: "u-md", name: "MD" } };
    expect(mayDecideApproval(md, ap("credit_over_limit", "u-cashier", 1, { steps: chain }))).toBe(true); // a different person
  });
  it("a finished approval can no longer be decided", () => {
    expect(mayDecideApproval(caps("Branch manager"), ap("discount", "u-cashier", 1, { status: "approved" }))).toBe(false);
  });
});

describe("the inbox follows the approval setting, not a fixed role list", () => {
  it("anyone named in the routing sees the approvals inbox, even a role the matrix gives no Approve letter (Auditor)", () => {
    const ids = (role: string) => nav(role).visible.map((s) => s.id);
    expect(ids("Auditor")).toContain("A01"); // named in the shortage routing
    expect(ids("Cash controller")).toContain("A01");
    expect(ids("Cash controller")).toContain("Q02"); // may approve a closing balance
    expect(ids("Cashier")).not.toContain("A01");
    expect(ids("Warehouse officer")).not.toContain("A01");
  });
  it("the Branch manager does not rule on shortages (they receive the stock); the Auditor and MD do", async () => {
    const { mayApproveKind } = await import("./index");
    expect(mayApproveKind(caps("Branch manager"), "shortage")).toBe(false);
    expect(mayApproveKind(caps("Auditor"), "shortage")).toBe(true);
    expect(mayApproveKind(caps("MD / Executive"), "shortage")).toBe(true);
    expect(mayApproveKind(caps("Branch manager"), "shortage", { shortage: [{ roles: ["Branch manager"] }] })).toBe(true); // the setting wins
  });
});

describe("stock count access (K01/K02)", () => {
  it("anyone who may create counts can open K01, so a different person can do the recount; K02 stays with the Stock controller", () => {
    const ids = (role: string) => nav(role).visible.map((s) => s.id);
    expect(ids("Stock controller")).toEqual(expect.arrayContaining(["K01", "K02"]));
    expect(ids("Warehouse officer")).toContain("K01");
    expect(ids("Branch manager")).toContain("K01");
    expect(ids("Warehouse officer")).not.toContain("K02");
    expect(ids("Cashier")).not.toContain("K01");
  });
});
