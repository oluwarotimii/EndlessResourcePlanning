import { describe, expect, it } from "vitest";
import { findMixups } from "./mixups";

describe("findMixups: a shortage on one variant with a surplus on its sibling", () => {
  const black = { productId: "p13", name: "Black phone case", family: "Phone case" };
  const clear = { productId: "p6", name: "Clear phone case", family: "Phone case" };

  it("flags both sides when one variant is short and the other over", () => {
    const m = findMixups([{ ...black, difference: -1 }, { ...clear, difference: 1 }]);
    expect(m.get("p13")).toEqual(["Clear phone case"]);
    expect(m.get("p6")).toEqual(["Black phone case"]);
  });
  it("does not flag a shortage on its own, or two shortages in one family", () => {
    expect(findMixups([{ ...black, difference: -1 }]).size).toBe(0);
    expect(findMixups([{ ...black, difference: -1 }, { ...clear, difference: -2 }]).size).toBe(0);
  });
  it("does not flag items from different families or items with no family", () => {
    expect(findMixups([{ ...black, difference: -1 }, { productId: "p9", name: "USB flash drive", family: "Storage", difference: 1 }]).size).toBe(0);
    expect(findMixups([{ productId: "a", name: "A", difference: -1 }, { productId: "b", name: "B", difference: 1 }]).size).toBe(0);
  });
  it("ignores items that matched", () => {
    expect(findMixups([{ ...black, difference: -1 }, { ...clear, difference: 0 }]).size).toBe(0);
  });
});
