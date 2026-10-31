import { describe, expect, it } from "vitest";
import { Approval, ApprovalDecisionInput } from "./index";

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
