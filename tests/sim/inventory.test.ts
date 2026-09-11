import { addItem, removeItem, total } from "../../src/sim/inventory";
import type { Inventory } from "../../src/sim/types";

describe("inventory helpers", () => {
  it("total sums all counts", () => {
    expect(total({})).toBe(0);
    expect(total({ wheat: 4 })).toBe(4);
  });

  it("addItem creates or increments", () => {
    const inv: Inventory = {};
    addItem(inv, "wheat", 2);
    addItem(inv, "wheat", 3);
    expect(inv).toEqual({ wheat: 5 });
  });

  it("removeItem decrements and deletes the key at zero", () => {
    const inv: Inventory = { wheat: 3 };
    removeItem(inv, "wheat", 2);
    expect(inv).toEqual({ wheat: 1 });
    removeItem(inv, "wheat", 1);
    expect(inv).toEqual({});
  });

  it("removeItem throws when short", () => {
    const inv: Inventory = { wheat: 1 };
    expect(() => removeItem(inv, "wheat", 2)).toThrow("not enough wheat");
  });
});
