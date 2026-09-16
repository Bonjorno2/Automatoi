import { World } from "../../src/sim/world";
import { RESEARCH_COST } from "../../src/sim/config";
import type { Item } from "../../src/sim/types";
import { ticks } from "./helpers";

/**
 * A console stocked with one item.
 *
 * This took an item parameter in milestone 5, when the chassis was repriced in
 * bread and the case below stopped completing. Naming the payment at the call
 * site rather than stocking everything keeps the suite's other assertions — one
 * of which checks the wheat count exactly — about what they were about.
 */
function fundedWorld(amount: number, item: Item = "wheat"): World {
  const w = new World({ seed: 1 });
  w.machineAt({ x: 16, y: 16 })!.inventory = { [item]: amount };
  return w;
}

describe("research", () => {
  it("consumes one wheat per tick and completes at the cost", () => {
    const w = fundedWorld(100);
    w.queueResearch("planter");
    ticks(w, RESEARCH_COST.planter - 1);
    expect(w.research.unlocked.has("planter")).toBe(false);
    expect(w.research.progress).toBe(RESEARCH_COST.planter - 1);
    w.tick();
    expect(w.research.unlocked.has("planter")).toBe(true);
    expect(w.research.queue).toEqual([]);
    expect(w.research.progress).toBe(0);
    expect(w.machineAt({ x: 16, y: 16 })!.inventory).toEqual({
      wheat: 100 - RESEARCH_COST.planter,
    });
  });

  it("stalls when the console runs out of wheat, then resumes", () => {
    const w = fundedWorld(3);
    w.queueResearch("planter");
    ticks(w, 10);
    expect(w.research.progress).toBe(3);
    w.machineAt({ x: 16, y: 16 })!.inventory = { wheat: 100 };
    ticks(w, RESEARCH_COST.planter - 3);
    expect(w.research.unlocked.has("planter")).toBe(true);
  });

  it("processes the queue in order", () => {
    const w = fundedWorld(1000);
    w.queueResearch("planter");
    w.queueResearch("scanner");
    ticks(w, RESEARCH_COST.planter);
    expect(w.research.unlocked.has("scanner")).toBe(false);
    ticks(w, RESEARCH_COST.scanner);
    expect(w.research.unlocked.has("scanner")).toBe(true);
  });

  it("grants a spare module for module research", () => {
    const w = fundedWorld(1000);
    w.queueResearch("scanner");
    ticks(w, RESEARCH_COST.scanner);
    expect(w.research.spareModules).toEqual({ scanner: 1 });
  });

  it("grants a spare chassis for chassis research", () => {
    // Bread, not wheat: milestone 5 prices the second bot in what the chain
    // makes, so that reaching it requires having built the chain.
    const w = fundedWorld(1000, "bread");
    w.queueResearch("chassis");
    ticks(w, RESEARCH_COST.chassis);
    expect(w.research.spareChassis).toBe(1);
    const bot = w.deployBot({ x: 18, y: 16 });
    expect(bot.id).toBe(3);
    expect(bot.modules.has("harvester")).toBe(true);
    expect(w.research.spareChassis).toBe(0);
    expect(() => w.deployBot({ x: 19, y: 16 })).toThrow("no spare chassis");
  });

  it("shrugs at a research already queued or already had, and only throws at a typo", () => {
    // Asking twice stopped being an error in milestone 10, when the opening
    // playtest found a script with `queue("planter")` at the top — which is what
    // the opening teaches — dying on line 1 the second time Run was pressed.
    // Pressing Run twice is the most likely single action in this game.
    const w = fundedWorld(1000);
    w.queueResearch("planter");
    expect(() => w.queueResearch("planter")).not.toThrow();
    expect(w.research.queue).toEqual(["planter"]);

    ticks(w, RESEARCH_COST.planter);
    expect(w.research.unlocked.has("planter")).toBe(true);
    expect(() => w.queueResearch("planter")).not.toThrow();
    // And it does not sneak back into the queue once it is already had.
    expect(w.research.queue).toEqual([]);

    // A name that is not research at all really is a mistake.
    expect(() => w.queueResearch("laser" as never)).toThrow("unknown research laser");
  });
});

describe("installModule", () => {
  it("moves a spare module onto a bot", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { planter: 1 };
    w.installModule(1, "planter");
    expect(w.getBot(1).modules.has("planter")).toBe(true);
    expect(w.research.spareModules).toEqual({ planter: 0 });
  });

  it("refuses without a spare", () => {
    const w = new World({ seed: 1 });
    expect(() => w.installModule(1, "planter")).toThrow("no spare planter module");
  });

  it("refuses a duplicate on the same bot", () => {
    const w = new World({ seed: 1 });
    w.research.spareModules = { harvester: 1 };
    expect(() => w.installModule(1, "harvester")).toThrow("bot 1 already has harvester");
  });
});
