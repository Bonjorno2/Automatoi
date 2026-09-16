import {
  cargoFraction,
  fieldLines,
  fleetRows,
  researchLines,
  stockLines,
} from "../../src/render/hud";
import { describeBotActivity } from "../../src/render/inspector";
import { botColor } from "../../src/render/palette";
import { World } from "../../src/sim/world";
import { BOT_CAPACITY, RESEARCH_COST, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import type { Vec } from "../../src/sim/types";
import { run, ticks } from "../sim/helpers";

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

/** The first tile holding a ripe crop, which is where a bot goes to harvest. */
function ripeTile(world: World): Vec {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tileAt({ x, y });
      if (tile?.crop && tile.crop.growth >= WHEAT_GROWTH_TICKS) return { x, y };
    }
  }
  throw new Error("world has no ripe crop");
}

/** The first bare soil tile, which is where a bot goes to plant. */
function bareSoil(world: World): Vec {
  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const tile = world.tileAt({ x, y });
      if (tile?.terrain === "soil" && !tile.crop && !world.machineAt({ x, y })) return { x, y };
    }
  }
  throw new Error("world has no bare soil");
}

describe("fieldLines", () => {
  it("counts the wild wheat a fresh world starts with", () => {
    // Pinned rather than derived. This is the number milestone 5's finding 3 is
    // about — the field is finite, the chain eats it at roughly ten wheat per
    // bread, and it runs out one hauling round after the chassis research
    // completes. Every balance measurement in milestones 3-5 was driven against
    // seed 1's field, so a change here should have to be argued for.
    expect(fieldLines(new World({ seed: 1 }).snapshot())).toEqual(["wheat — 119 ready"]);
  });

  it("drops by one when a bot harvests", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).pos = ripeTile(w);
    expect(run(w, 1, { kind: "harvest" })).toEqual({ ok: true, value: true });
    expect(fieldLines(w.snapshot())).toEqual(["wheat — 118 ready"]);
  });

  it("counts a planted tile as growing rather than as ready", () => {
    // The distinction is the whole point of the line. A player who has just
    // replanted has done the thing that saves them, and a read-out that showed
    // only ripe wheat would tell them they still had nothing.
    const w = new World({ seed: 1 });
    w.getBot(1).pos = bareSoil(w);
    w.getBot(1).modules.add("planter");
    w.getBot(1).inventory = { wheat: 1 };
    expect(run(w, 1, { kind: "plant", item: "wheat" })).toEqual({ ok: true, value: true });
    expect(fieldLines(w.snapshot())).toEqual(["wheat — 119 ready, 1 growing"]);
  });

  it("moves a crop from growing to ready when it matures", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).pos = bareSoil(w);
    w.getBot(1).modules.add("planter");
    w.getBot(1).inventory = { wheat: 1 };
    run(w, 1, { kind: "plant", item: "wheat" });
    ticks(w, WHEAT_GROWTH_TICKS);
    expect(fieldLines(w.snapshot())).toEqual(["wheat — 120 ready"]);
  });

  it("says the field is empty rather than saying nothing at all", () => {
    // An empty field looks identical to a field somebody already harvested,
    // which is finding 3's complaint. A line that vanished when the count hit
    // zero would be silent at exactly the moment it matters most.
    const w = new World({ seed: 1 });
    for (const tile of w.tiles) tile.crop = null;
    expect(fieldLines(w.snapshot())).toEqual(["wheat — none ready"]);
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

/**
 * Milestone 8's Task 5, closing milestone 4's finding 6 in full.
 *
 * The cheap half — a colour and a number per bot — shipped in milestone 6. This
 * is the rest: a fleet a player can read without hovering it one bot at a time,
 * which the design calls the Overseer and which had been deferred four times.
 */
describe("fleetRows", () => {
  it("gives one row per bot, in the world's own order", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 2;
    w.deployBot({ x: 20, y: 20 });
    w.deployBot({ x: 21, y: 20 });
    expect(fleetRows(w.snapshot(), null).map((r) => r.id)).toEqual(
      w.snapshot().bots.map((b) => b.id),
    );
  });

  it("colours a row the way the canvas colours the bot", () => {
    // The list and the map must agree by construction. `botColor` is indexed by
    // position in the bot list, not by id, so the rows have to be too.
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    w.deployBot({ x: 20, y: 20 });
    const rows = fleetRows(w.snapshot(), null);
    expect(rows.map((r) => r.color)).toEqual([botColor(0, false), botColor(1, false)]);
  });

  it("says what each bot is doing, in the inspector's own words", () => {
    // Fact 2 of the plan: one definition of what a bot is doing, called rather
    // than restated, or the panel and the tooltip disagree on the same screen.
    const w = new World({ seed: 1 });
    expect(fleetRows(w.snapshot(), null)[0]!.activity).toBe("idle");

    w.issue(1, { kind: "move", dir: "east" });
    const moving = fleetRows(w.snapshot(), null)[0]!;
    expect(moving.activity).toBe(describeBotActivity(w.snapshot().bots[0]!));
    expect(moving.activity).toContain("move east");
  });

  it("reports a blocked bot as blocked rather than as idle", () => {
    const w = new World({ seed: 1 });
    w.getBot(1).modules.add("radio");
    w.issue(1, { kind: "receive" });
    ticks(w, 3);
    expect(fleetRows(w.snapshot(), null)[0]!.activity).toBe("waiting for a message");
  });

  it("says empty rather than going blank for a bot carrying nothing", () => {
    const w = new World({ seed: 1 });
    expect(fleetRows(w.snapshot(), null)[0]!.carrying).toBe("empty");
    w.getBot(1).inventory = { wheat: 3, bread: 1 };
    expect(fleetRows(w.snapshot(), null)[0]!.carrying).toBe("3 wheat, 1 bread");
  });

  it("marks the selected bot, and only that one", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const second = w.deployBot({ x: 20, y: 20 });
    expect(fleetRows(w.snapshot(), second.id).map((r) => r.selected)).toEqual([false, true]);
    expect(fleetRows(w.snapshot(), null).every((r) => !r.selected)).toBe(true);
  });
});
