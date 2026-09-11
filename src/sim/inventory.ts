import type { Inventory, Item } from "./types";

export function total(inv: Inventory): number {
  let n = 0;
  for (const count of Object.values(inv)) n += count ?? 0;
  return n;
}

export function addItem(inv: Inventory, item: Item, count: number): void {
  inv[item] = (inv[item] ?? 0) + count;
}

export function removeItem(inv: Inventory, item: Item, count: number): void {
  const have = inv[item] ?? 0;
  if (have < count) throw new Error(`not enough ${item}`);
  const left = have - count;
  if (left === 0) delete inv[item];
  else inv[item] = left;
}
