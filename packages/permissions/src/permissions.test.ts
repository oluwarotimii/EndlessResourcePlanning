import { describe, expect, it } from "vitest";
import type { Capabilities } from "@erp/api-contract";
import { AREAS, ROLE_MATRIX, SCREENS, approvalArea, areasForRoles, buildNavigation, mayDecideApproval } from "./index";

const PILOT = ["Cashier", "Branch manager", "Warehouse officer", "Stock controller", "Rider / courier", "Delivery coordinator"];
const TASK_ROLES = ["Cashier", "Rider / courier", "Technician"];

const caps = (role: string): Capabilities => ({
  user: { id: "u", name: "Test" }, roles: [role], areas: areasForRoles([role]), scope: {},
});
const nav = (role: string) => buildNavigation({ caps: caps(role), taskRoles: TASK_ROLES, enabledScopes: ["MVP"] });

describe("generated fixtures", () => {
  it("match the planning documents: 20 roles, 24 areas, 93 screens, 29 MVP", () => {
    expect(Object.keys(ROLE_MATRIX)).toHaveLength(20);
    expect(AREAS).toHaveLength(24);
    expect(SCREENS).toHaveLength(93);
    expect(SCREENS.filter((s) => s.scope === "MVP")).toHaveLength(29);
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
    expect(mayDecideApproval(caps("Branch manager"), "discount", "u-cashier")).toBe(true);
    expect(mayDecideApproval(caps("Cashier"), "discount", "u-manager")).toBe(false);
    expect(mayDecideApproval(caps("Warehouse officer"), "void", "u-cashier")).toBe(false);
  });

  it("never lets the creator approve their own request", () => {
    expect(mayDecideApproval(caps("Branch manager"), "discount", "u")).toBe(false);
  });
});
