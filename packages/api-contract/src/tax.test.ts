import { describe, expect, it } from "vitest";
import { cashOf, computeTotals, creditOf } from "./index";

describe("computeTotals: VAT handling is configurable", () => {
  it("inclusive: the customer pays the price; VAT is the portion inside it", () => {
    expect(computeTotals(10750, "inclusive", 0.075)).toEqual({ subtotal: 10750, vat: 750, total: 10750 });
  });
  it("exclusive: VAT is added on top and the customer pays more", () => {
    expect(computeTotals(10000, "exclusive", 0.075)).toEqual({ subtotal: 10000, vat: 750, total: 10750 });
  });
  it("none: no VAT is charged or shown", () => {
    expect(computeTotals(10000, "none", 0.075)).toEqual({ subtotal: 10000, vat: 0, total: 10000 });
  });
  it("rounds to whole naira", () => {
    expect(computeTotals(13000, "inclusive", 0.075).vat).toBe(907);
    expect(computeTotals(1234, "exclusive", 0.075).total).toBe(1234 + 93);
  });
  it("splits payments into cash and credit", () => {
    const p = [{ method: "cash" as const, amount: 4000 }, { method: "credit" as const, amount: 6000 }, { method: "transfer" as const, amount: 500 }];
    expect(cashOf(p)).toBe(4000);
    expect(creditOf(p)).toBe(6000);
  });
});
