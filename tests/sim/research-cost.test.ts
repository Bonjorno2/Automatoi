import { World } from "../../src/sim/world";
import { RESEARCH_COST, RESEARCH_ITEM } from "../../src/sim/config";
import type { Item, ResearchName } from "../../src/sim/types";
import { ticks } from "./helpers";

function stocked(item: Item, amount: number): World {
  const w = new World({ seed: 1 });
  w.machineAt({ x: 16, y: 16 })!.inventory = { [item]: amount };
  w.drainEvents();
  return w;
}

const fuelFor = (name: ResearchName): Item => RESEARCH_ITEM[name] ?? "wheat";

describe("what a research is priced in", () => {
  it("leaves the opening researches in raw wheat", () => {
    // Milestone 3 measured and pinned the first ten minutes. Repricing the
    // planter would move a number another suite asserts.
    for (const name of ["planter", "scanner", "crate"] as const) {
      expect(fuelFor(name), name).toBe("wheat");
    }
  });

  it("prices the second bot and the radio in bread", () => {
    expect(fuelFor("chassis")).toBe("bread");
    expect(fuelFor("radio")).toBe("bread");
  });

  it("gives every research a cost", () => {
    for (const [name, cost] of Object.entries(RESEARCH_COST)) {
      expect(cost, name).toBeGreaterThan(0);
      expect(Number.isInteger(cost), name).toBe(true);
    }
  });
});

describe("paying for research", () => {
  it("completes the planter on wheat, as it always did", () => {
    const w = stocked("wheat", 100);
    w.queueResearch("planter");
    ticks(w, RESEARCH_COST.planter + 1);
    expect(w.research.unlocked.has("planter")).toBe(true);
    expect(w.machineAt({ x: 16, y: 16 })!.inventory.wheat).toBe(100 - RESEARCH_COST.planter);
  });

  it("completes the chassis on bread, and leaves wheat untouched", () => {
    const w = stocked("bread", 20);
    w.machineAt({ x: 16, y: 16 })!.inventory.wheat = 50;
    w.queueResearch("chassis");
    ticks(w, RESEARCH_COST.chassis + 1);

    expect(w.research.spareChassis).toBe(1);
    const inv = w.machineAt({ x: 16, y: 16 })!.inventory;
    expect(inv.bread).toBe(20 - RESEARCH_COST.chassis);
    expect(inv.wheat).toBe(50);
  });

  it("starves a bread research on a console full of wheat", () => {
    // The most interesting way to be stuck in this game so far, and the whole
    // Factorio lesson in one state: you have plenty, of the wrong thing.
    const w = stocked("wheat", 500);
    w.queueResearch("chassis");
    ticks(w, 30);

    expect(w.research.spareChassis).toBe(0);
    expect(w.research.progress).toBe(0);
    expect(w.machineAt({ x: 16, y: 16 })!.inventory.wheat).toBe(500);
    expect(w.snapshot().machines[0]!.starved).toBe(true);
  });

  it("resumes the moment the right item arrives", () => {
    const w = stocked("wheat", 500);
    w.queueResearch("chassis");
    ticks(w, 10);
    w.machineAt({ x: 16, y: 16 })!.inventory.bread = RESEARCH_COST.chassis;
    ticks(w, RESEARCH_COST.chassis + 1);
    expect(w.research.spareChassis).toBe(1);
  });
});

describe("the new machine researches", () => {
  it("unlock placement and stock nothing, exactly like the crate", () => {
    for (const name of ["mill", "oven"] as const) {
      const w = stocked("wheat", 500);
      w.queueResearch(name);
      ticks(w, RESEARCH_COST[name] + 1);

      expect(w.research.unlocked.has(name), name).toBe(true);
      expect(w.research.spareModules, name).toEqual({});
      expect(w.research.spareChassis, name).toBe(0);
      // And the unlock is what placement checks.
      expect(() => w.placeMachine(name, { x: 20, y: 20 })).not.toThrow();
    }
  });

  it("refuses placement before the research completes", () => {
    const w = stocked("wheat", 500);
    expect(() => w.placeMachine("mill", { x: 20, y: 20 })).toThrow("mill not researched");
  });
});
