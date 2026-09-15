import { cargoFraction, researchLines, stockLines } from "../../src/render/hud";
import { World } from "../../src/sim/world";
import { BOT_CAPACITY, RESEARCH_COST } from "../../src/sim/config";
import { ticks } from "../sim/helpers";

describe("researchLines", () => {
  it("says nothing when nothing is queued", () => {
    expect(researchLines(new World({ seed: 1 }).snapshot())).toEqual([]);
  });

  it("reports the head of the queue against its cost", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 3 };
    w.queueResearch("planter");
    ticks(w, 3);
    expect(researchLines(w.snapshot())).toEqual([`planter 3/${RESEARCH_COST.planter}`]);
  });

  it("shows queued-but-not-started research at zero, not at the head's progress", () => {
    // Only one research is worked on at a time. Showing both at the same
    // progress would say two things are happening when one is.
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 4 };
    w.queueResearch("planter");
    w.queueResearch("scanner");
    ticks(w, 4);

    const lines = researchLines(w.snapshot());
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`planter 4/${RESEARCH_COST.planter}`);
    expect(lines[1]).toBe(`scanner 0/${RESEARCH_COST.scanner}`);
  });

  it("drops a research from the list once it completes", () => {
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: RESEARCH_COST.planter };
    w.queueResearch("planter");
    ticks(w, RESEARCH_COST.planter + 1);
    expect(researchLines(w.snapshot())).toEqual([]);
  });
});

describe("cargoFraction", () => {
  it("is zero for an empty bot and for no bot at all", () => {
    const w = new World({ seed: 1 });
    expect(cargoFraction(w.snapshot().bots[0])).toBe(0);
    expect(cargoFraction(undefined)).toBe(0);
  });

  it("is one when the bot is at capacity", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: BOT_CAPACITY };
    expect(cargoFraction(w.snapshot().bots[0])).toBe(1);
  });

  it("is proportional in between", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: BOT_CAPACITY / 2 };
    expect(cargoFraction(w.snapshot().bots[0])).toBeCloseTo(0.5, 10);
  });

  it("never exceeds one, however the inventory got there", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).inventory = { wheat: BOT_CAPACITY * 4 };
    expect(cargoFraction(w.snapshot().bots[0])).toBe(1);
  });
});

describe("stockLines", () => {
  it("is empty for a world that has researched nothing", () => {
    expect(stockLines(new World({ seed: 1 }).snapshot())).toEqual([]);
  });

  it("names a module the moment its research completes", () => {
    // Milestone 4's finding 1: this line is the only thing that tells a player
    // the planter they paid ten wheat for actually exists.
    const w = new World({ seed: 1 });
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: RESEARCH_COST.planter };
    w.queueResearch("planter");
    ticks(w, RESEARCH_COST.planter + 1);
    expect(stockLines(w.snapshot())).toEqual(["planter module"]);
  });

  it("names a spare chassis", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    expect(stockLines(w.snapshot())).toEqual(["spare chassis"]);
  });

  it("counts duplicates rather than repeating a line", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { scanner: 3 };
    w.research.spareChassis = 2;
    expect(stockLines(w.snapshot())).toEqual(["scanner module x3", "spare chassis x2"]);
  });

  it("lists every kind of stock at once", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 1, radio: 1 };
    w.research.spareChassis = 1;
    expect(stockLines(w.snapshot())).toHaveLength(3);
  });

  it("drops a module from the list once it is installed", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 1 };
    expect(stockLines(w.snapshot())).toEqual(["planter module"]);
    w.installModule(1, "planter");
    expect(stockLines(w.snapshot())).toEqual([]);
  });

  it("ignores a zeroed entry rather than printing x0", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 0 };
    expect(stockLines(w.snapshot())).toEqual([]);
  });
});
