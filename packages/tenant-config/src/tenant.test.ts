import { describe, expect, it } from "vitest";
import tenantJson from "../tenant.json";
import { TenantConfigError, formatMoney, loadTenant } from "./index";

describe("tenant.json", () => {
  it("the shipped file is valid", () => {
    expect(loadTenant(tenantJson).currency).toBe("NGN");
  });
  it("fails at start-up with readable issues, not later in a screen", () => {
    const bad = { ...tenantJson, currency: "NAIRA", theme: { ...tenantJson.theme, default: "missing" } };
    try { loadTenant(bad); throw new Error("should have thrown"); } catch (e) {
      expect(e).toBeInstanceOf(TenantConfigError);
      expect((e as TenantConfigError).issues.join("\n")).toMatch(/currency/);
      expect((e as TenantConfigError).issues.join("\n")).toMatch(/theme\.default/);
    }
  });
  it("refuses touch targets below the 48px / 56px minimums", () => {
    expect(() => loadTenant({ ...tenantJson, touch: { minPx: 40, tillPx: 56 } })).toThrow(TenantConfigError);
  });
  it("formats naira without decimals", () => {
    expect(formatMoney(loadTenant(tenantJson), 4200)).toMatch(/4,200/);
  });
});
