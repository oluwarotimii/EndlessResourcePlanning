import { describe, expect, it } from "vitest";
import { CreateApprovalInput, ReturnInput, refundFor } from "./index";

const sale = { lines: [{ productId: "a", unitPrice: 6500 }, { productId: "b", unitPrice: 2500 }], subtotal: 15500, total: 15500 };

describe("refundFor: the refund is what the customer actually paid for the returned lines", () => {
  it("is the price when nothing changed the total", () => {
    expect(refundFor(sale, [{ productId: "a", qty: 1 }])).toMatchObject({ total: 6500, largestItem: 6500 });
    expect(refundFor(sale, [{ productId: "a", qty: 1 }, { productId: "b", qty: 2 }])).toMatchObject({ total: 11500, largestItem: 6500 });
  });
  it("shares an approved discount: the customer gets back less than the shelf price", () => {
    const discounted = { ...sale, total: 13950 }; // 10% off
    expect(refundFor(discounted, [{ productId: "a", qty: 1 }]).total).toBe(5850);
  });
  it("includes VAT that was added on top", () => {
    const exclusive = { ...sale, total: 16663 }; // 15,500 + 7.5% VAT
    expect(refundFor(exclusive, [{ productId: "b", qty: 1 }]).total).toBe(Math.round((16663 * 2500) / 15500));
  });
  it("returning every line refunds (about) the whole sale, and an unknown product refunds nothing", () => {
    const all = refundFor(sale, [{ productId: "a", qty: 1 }, { productId: "b", qty: 1 }]);
    expect(all.total).toBe(9000); // only 1 of each was sold... lines are by unit price
    expect(refundFor(sale, [{ productId: "zzz", qty: 1 }]).total).toBe(0);
  });
});

describe("refund request and return inputs", () => {
  const base = { idempotencyKey: "abcdefgh-1234", kind: "refund" as const, amount: 6500, unit: "naira" as const };
  it("a refund request must say which sale and lines, and why", () => {
    expect(CreateApprovalInput.safeParse(base).success).toBe(false);
    expect(CreateApprovalInput.safeParse({ ...base, refund: { saleKey: "abcdefgh-1234", lines: [{ productId: "a", qty: 1 }], reason: "Faulty" } }).success).toBe(true);
    expect(CreateApprovalInput.safeParse({ ...base, refund: { saleKey: "abcdefgh-1234", lines: [], reason: "Faulty" } }).success).toBe(false);
  });
  it("a return cannot be refunded to 'credit', and always carries an approval", () => {
    const ok = { idempotencyKey: "abcdefgh-1234", clientCreatedAt: "x", shiftId: "shift-0001", saleKey: "abcdefgh-5678", lines: [{ productId: "a", qty: 1 }], reason: "Faulty", refundMethod: "cash", approvalId: "AP-0001" };
    expect(ReturnInput.safeParse(ok).success).toBe(true);
    expect(ReturnInput.safeParse({ ...ok, refundMethod: "credit" }).success).toBe(false);
    expect(ReturnInput.safeParse({ ...ok, approvalId: "" }).success).toBe(false);
  });
});

import { daysSince, returnDaysFor, type ReturnRules } from "./index";
describe("returnDaysFor: product, then category, then default", () => {
  const rules: ReturnRules = { defaultDays: 7, faultyDays: 30, faultyReasons: [], byCategory: { Audio: { days: 3 } }, byProduct: { p9: { days: 14, faultyDays: 60 } } };
  it("uses the most specific rule", () => {
    expect(returnDaysFor(rules, { id: "p1", category: "Accessories" }, false)).toBe(7);
    expect(returnDaysFor(rules, { id: "p1", category: "Accessories" }, true)).toBe(30);
    expect(returnDaysFor(rules, { id: "p3", category: "Audio" }, false)).toBe(3);
    expect(returnDaysFor(rules, { id: "p3", category: "Audio" }, true)).toBe(30); // category gave no faulty days
    expect(returnDaysFor(rules, { id: "p9", category: "Audio" }, false)).toBe(14);
    expect(returnDaysFor(rules, { id: "p9", category: "Audio" }, true)).toBe(60);
  });
  it("counts whole days", () => {
    expect(daysSince("2026-11-01T10:00:00.000Z", Date.parse("2026-11-08T09:00:00.000Z"))).toBe(6);
    expect(daysSince("2026-11-01T10:00:00.000Z", Date.parse("2026-11-08T10:00:00.000Z"))).toBe(7);
  });
});
