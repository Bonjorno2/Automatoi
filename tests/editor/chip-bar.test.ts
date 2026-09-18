import { ChipBar, SLOT_COUNT, refKey, resolveRef, sameRef } from "../../src/editor/chip-bar.ts";
import { SavedChips, type SavedChip } from "../../src/editor/saved-chips.ts";
import { LADDERS } from "../../src/editor/snippets.ts";

/**
 * The bar, and the one rule it exists to keep: **a slot holds a reference, not a
 * copy.** Factorio's quickbar works that way and the reason is the failure this
 * file guards against — a shortcut that still inserts the old text after the
 * chip was renamed, or still inserts anything at all after it was deleted.
 */

function chipsOf(...chips: SavedChip[]): readonly SavedChip[] {
  return chips;
}

describe("nine slots", () => {
  it("pins to the first free slot and says which", () => {
    const bar = new ChipBar();
    expect(bar.pin({ kind: "saved", id: "c1" })).toBe(0);
    expect(bar.pin({ kind: "saved", id: "c2" })).toBe(1);
  });

  it("pinning something already pinned answers its slot rather than taking another", () => {
    // The button on a chip means "put this where I can reach it". Pressing it
    // twice meant it once.
    const bar = new ChipBar();
    bar.pin({ kind: "rung", title: "Harvest in a loop" });
    expect(bar.pin({ kind: "rung", title: "Harvest in a loop" })).toBe(0);
    expect(bar.slots().filter((s) => s !== null)).toHaveLength(1);
  });

  it("answers null when all nine are taken", () => {
    const bar = new ChipBar();
    for (let i = 0; i < SLOT_COUNT; i++) bar.pin({ kind: "saved", id: `c${i}` });
    expect(bar.pin({ kind: "saved", id: "one too many" })).toBeNull();
  });

  it("clears a slot, and forgets every slot pointing at one chip", () => {
    const bar = new ChipBar();
    const ref = { kind: "saved", id: "c1" } as const;
    bar.pin(ref);
    bar.set(4, ref);
    bar.forget(ref);
    expect(bar.slots().every((s) => s === null)).toBe(true);
  });

  it("ignores a slot index off the end rather than growing the bar", () => {
    const bar = new ChipBar();
    bar.set(SLOT_COUNT, { kind: "saved", id: "c1" });
    bar.set(-1, { kind: "saved", id: "c1" });
    expect(bar.slots()).toHaveLength(SLOT_COUNT);
    expect(bar.slots().every((s) => s === null)).toBe(true);
  });
});

describe("a slot holds a reference, not a copy", () => {
  it("shows a renamed chip's new name, and its edited code", () => {
    const chips = new SavedChips();
    const saved = chips.save("first go", "bot.wait(1);");
    if (!saved.ok) throw new Error("save refused");
    const ref = { kind: "saved", id: saved.chip.id } as const;

    expect(resolveRef(ref, chips.list())!.name).toBe("first go");
    chips.rename(saved.chip.id, "second thoughts");
    expect(resolveRef(ref, chips.list())!.name).toBe("second thoughts");
  });

  it("resolves to nothing when the chip is gone, instead of throwing", () => {
    expect(resolveRef({ kind: "saved", id: "never existed" }, chipsOf())).toBeNull();
    expect(resolveRef({ kind: "rung", title: "No such rung" }, chipsOf())).toBeNull();
  });

  it("resolves an authored rung by title, against the real ladders", () => {
    const rung = LADDERS[0]!.rungs[0]!;
    const found = resolveRef({ kind: "rung", title: rung.title }, chipsOf());
    expect(found).toEqual({ name: rung.title, code: rung.code });
  });
});

describe("comparing references", () => {
  it("tells the two kinds apart even when the strings match", () => {
    expect(sameRef({ kind: "saved", id: "x" }, { kind: "rung", title: "x" })).toBe(false);
    expect(sameRef({ kind: "rung", title: "x" }, { kind: "rung", title: "x" })).toBe(true);
    expect(refKey({ kind: "saved", id: "x" })).not.toBe(refKey({ kind: "rung", title: "x" }));
  });
});
