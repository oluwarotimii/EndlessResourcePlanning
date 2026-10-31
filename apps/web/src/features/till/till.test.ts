import { describe, expect, it } from "vitest";
import type { Product } from "@erp/api-contract";
import type { QueueItem } from "@erp/offline";
import { addProduct, cartSubtotal, type Cart, emptyCart, itemCount, setQty } from "./cart";
import { findExact, search } from "./catalog";
import { saleBlock } from "./limits";
import { expectedCash, provisionalNumber, type LocalSale } from "../shift/shift";

const p = (id: string, price: number, extra: Partial<Product> = {}): Product => ({ id, sku: `SKU-${id}`, barcode: `600${id}`, name: `Item ${id}`, price, stock: 5, ...extra });

describe("cart", () => {
  it("merges repeat scans into one line and totals in whole naira", () => {
    let c = addProduct(emptyCart(), p("1", 6500));
    c = addProduct(c, p("1", 6500));
    c = addProduct(c, p("2", 2500));
    expect(c.lines).toHaveLength(2);
    expect(itemCount(c)).toBe(3);
    expect(cartSubtotal(c)).toBe(15500);
  });
  it("a quantity of zero removes the line, and any edit clears a pending charge key", () => {
    let c: Cart = { ...addProduct(emptyCart(), p("1", 1000)), chargeKey: "k" };
    c = setQty(c, "1", 3);
    expect(c.chargeKey).toBeUndefined();
    expect(cartSubtotal(c)).toBe(3000);
    expect(setQty(c, "1", 0).lines).toHaveLength(0);
  });
});

describe("catalogue lookup", () => {
  const list = [p("1", 100, { name: "Phone charger", barcode: "6001" }), p("2", 100, { name: "Phone case", barcode: "6002" })];
  it("a scanned barcode or SKU matches exactly", () => {
    expect(findExact(list, "6002")?.id).toBe("2");
    expect(findExact(list, "sku-1")?.id).toBe("1");
    expect(findExact(list, "phone")).toBeUndefined();
  });
  it("typing searches by name", () => {
    expect(search(list, "charger").map((x) => x.id)).toEqual(["1"]);
    expect(search(list, "").length).toBe(2);
  });
});

describe("offline safety limits", () => {
  const sale = (n: number, at: number): QueueItem => ({ id: `s${n}`, type: "sale.create", recordKey: "sh", userId: "u", payload: {}, status: "pending", attempts: 0, createdAt: at });
  const limits = { maxOfflineSalesPerTill: 3, syncWindowHours: 12 };
  const now = 1_000_000_000_000;
  it("allows selling under the cap", () => expect(saleBlock([sale(1, now), sale(2, now)], limits, now)).toBeNull());
  it("blocks at the cap", () => expect(saleBlock([sale(1, now), sale(2, now), sale(3, now)], limits, now)).toBe("cap"));
  it("blocks when the oldest unsynced sale is past the sync window", () => expect(saleBlock([sale(1, now - 13 * 3_600_000)], limits, now)).toBe("syncWindow"));
  it("ignores non-sale items", () => expect(saleBlock([{ ...sale(1, now - 99 * 3_600_000), type: "print.log" }], limits, now)).toBeNull());
});

describe("shift cash", () => {
  const sale = (over: Partial<LocalSale>): LocalSale => ({ key: "k", shiftId: "s1", lines: [], subtotal: 1000, vatMode: "inclusive", vat: 0, total: 1000, payments: [{ method: "cash", amount: 1000 }], cashierName: "A", createdAt: "x", provisionalNo: "o", synced: false, ...over });
  it("expected cash = float + CASH payments of this shift only (card, transfer and credit never enter the drawer)", () => {
    const shift = { id: "s1", status: "open" as const, openingFloat: 20000, openedAt: "x" };
    const cash = (n: number) => sale({ total: n, payments: [{ method: "cash", amount: n }] });
    const split = sale({ total: 10000, payments: [{ method: "cash", amount: 3000 }, { method: "credit", amount: 7000 }] });
    const card = sale({ total: 9999, payments: [{ method: "card", amount: 9999 }] });
    const other = sale({ shiftId: "s2", total: 7777, payments: [{ method: "cash", amount: 7777 }] });
    expect(expectedCash(shift, [cash(13000), split, card, other])).toBe(20000 + 13000 + 3000);
  });
  it("provisional receipt numbers are stable and short", () => expect(provisionalNumber("abcdef12-0000")).toBe("OFF-ABCDEF"));
});
