import { describe, expect, it } from "vitest";
import { Approval, ApprovalDecisionInput, CreateApprovalInput, discountAmount } from "./index";

const approval = {
  id: "ap-1",
  kind: "discount",
  status: "pending",
  amount: 12,
  limit: 3,
  unit: "percent",
  requestedBy: { id: "u-cashier", name: "Amaka Obi" },
  requestedAt: "2026-10-31T10:00:00.000Z",
};

describe("approval contract", () => {
  it("accepts an approval with the facts the inbox must show (who, what, amount, limit)", () => {
    const parsed = Approval.parse(approval);
    expect(parsed).toMatchObject({ amount: 12, limit: 3, unit: "percent", requestedBy: { name: "Amaka Obi" } });
  });

  it("a rejection always needs a reason", () => {
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "ap-key-0001", decision: "reject" }).success).toBe(false);
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "ap-key-0001", decision: "reject", reason: "  " }).success).toBe(false);
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "ap-key-0001", decision: "reject", reason: "No" }).success).toBe(false);
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "ap-key-0001", decision: "reject", reason: "Price is already discounted" }).success).toBe(true);
  });

  it("an approval may be given without a reason", () => {
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "ap-key-0001", decision: "approve" }).success).toBe(true);
  });

  it("a decision needs an idempotency key so a retry cannot post twice", () => {
    expect(ApprovalDecisionInput.safeParse({ decision: "approve" }).success).toBe(false);
    expect(ApprovalDecisionInput.safeParse({ idempotencyKey: "short", decision: "approve" }).success).toBe(false);
  });
});

describe("raising an approval request", () => {
  const base = { idempotencyKey: "ap-key-0001", amount: 2, unit: "percent" as const };

  it("a discount is a percentage from 1 to 100", () => {
    expect(CreateApprovalInput.safeParse({ ...base, kind: "discount" }).success).toBe(true);
    expect(CreateApprovalInput.safeParse({ ...base, kind: "discount", amount: 0 }).success).toBe(false);
    expect(CreateApprovalInput.safeParse({ ...base, kind: "discount", amount: 101 }).success).toBe(false);
    expect(CreateApprovalInput.safeParse({ ...base, kind: "discount", unit: "naira" }).success).toBe(false);
  });

  it("a void or credit request is a whole-naira amount", () => {
    expect(CreateApprovalInput.safeParse({ ...base, kind: "void", unit: "naira", amount: 13000 }).success).toBe(true);
    expect(CreateApprovalInput.safeParse({ ...base, kind: "void", unit: "naira", amount: 0 }).success).toBe(false);
    expect(CreateApprovalInput.safeParse({ ...base, kind: "void" }).success).toBe(false);
  });

  it("a credit request needs a customer", () => {
    const credit = { idempotencyKey: "ap-key-0001", kind: "credit_over_limit" as const, unit: "naira" as const, amount: 13000 };
    expect(CreateApprovalInput.safeParse(credit).success).toBe(false);
    expect(CreateApprovalInput.safeParse({ ...credit, customerId: "c2" }).success).toBe(true);
  });

  it("a discount is rounded half up to whole naira", () => {
    expect(discountAmount(13000, 2)).toBe(260);
    expect(discountAmount(6500, 3)).toBe(195);
    expect(discountAmount(333, 1)).toBe(3);
    expect(discountAmount(13000, 0)).toBe(0);
  });
});
