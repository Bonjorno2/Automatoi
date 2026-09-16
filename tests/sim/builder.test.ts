import { World } from "../../src/sim/world";
import { RESEARCH_ITEM, TICK_COST } from "../../src/sim/config";
import { run, ticks } from "./helpers";

/**
 * The builder arm: the first time a player's *script* changes the world's
 * layout rather than moving through it.
 *
 * Every placement goes through the same `canPlace` the ghost and the build menu
 * ask. That is the rule Decision 7 of the milestone 4 plan exists to enforce,
 * one level up: three callers, one predicate, no copies to keep in step.
 */
function builderWorld(): World {
  const w = new World({ seed: 1 });
  const bot = w.getBot(1);
  bot.modules.add("builder");
  bot.pos = { x: 20, y: 20 };
  for (const r of ["conveyor", "crate", "mill"] as const) w.research.unlocked.add(r);
  return w;
}

describe("the builder arm places", () => {
  it("needs the module, and says so in the design's words", () => {
    const w = builderWorld();
    w.getBot(1).modules.delete("builder");
    expect(run(w, 1, { kind: "place", machine: "conveyor", dir: "north" })).toEqual({
      ok: false,
      error: "Bot 1 has no Builder module",
    });
  });

  it("puts a machine on the tile in that direction", () => {
    const w = builderWorld();
    expect(run(w, 1, { kind: "place", machine: "crate", dir: "east" })).toEqual({
      ok: true,
      value: true,
    });
    expect(w.machineAt({ x: 21, y: 20 })!.kind).toBe("crate");
    expect(w.time).toBe(TICK_COST.place);
  });

  it("faces a belt the way the bot is building, unless told otherwise", () => {
    // The natural loop is place north, move north, repeat, and that should lay
    // a line that points the way the bot is walking.
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "conveyor", dir: "north" });
    expect(w.machineAt({ x: 20, y: 19 })!.dir).toBe("north");

    run(w, 1, { kind: "place", machine: "conveyor", dir: "east", facing: "south" });
    expect(w.machineAt({ x: 21, y: 20 })!.dir).toBe("south");
  });

  it("refuses with the sim's own reason, and builds nothing", () => {
    const w = builderWorld();
    w.getBot(1).pos = { x: 17, y: 16 }; // east of the console
    const why = w.canPlace("crate", { x: 16, y: 16 });
    expect(why).toBe("tile occupied");
    expect(run(w, 1, { kind: "place", machine: "crate", dir: "west" })).toEqual({
      ok: false,
      error: why,
    });
    // Still the console, and no second machine anywhere.
    expect(w.machineAt({ x: 16, y: 16 })!.kind).toBe("console");
  });

  it("will not build what research has not unlocked", () => {
    const w = builderWorld();
    w.research.unlocked.delete("conveyor");
    expect(run(w, 1, { kind: "place", machine: "conveyor", dir: "north" })).toEqual({
      ok: false,
      error: "conveyor not researched",
    });
  });

  it("will not build a second console, whatever research says", () => {
    const w = builderWorld();
    expect(run(w, 1, { kind: "place", machine: "console", dir: "north" })).toEqual({
      ok: false,
      error: "cannot place a second console",
    });
  });

  it("leaves a world-side signal when it refuses", () => {
    // "Failure is content": a script that can see a false is not the only
    // reader. Somebody watching the canvas gets the same mark a refused plant
    // already produces.
    const w = builderWorld();
    w.getBot(1).pos = { x: 17, y: 16 };
    run(w, 1, { kind: "place", machine: "crate", dir: "west" });
    expect(w.drainEvents()).toContainEqual({
      kind: "refused",
      botId: 1,
      pos: { x: 17, y: 16 },
      command: "place",
    });
  });
});

describe("the builder arm removes", () => {
  it("clears an empty belt off its tile, and lets a bot walk there", () => {
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "conveyor", dir: "east" });
    expect(w.machineAt({ x: 21, y: 20 })).toBeDefined();

    expect(run(w, 1, { kind: "remove", dir: "east" })).toEqual({ ok: true, value: true });
    expect(w.machineAt({ x: 21, y: 20 })).toBeUndefined();
    // The point of being able to remove one at all: a belt is a wall, and a
    // player who has fenced themselves in needs a way out.
    expect(run(w, 1, { kind: "move", dir: "east" })).toEqual({ ok: true, value: true });
  });

  it("refuses a machine that is holding something", () => {
    // This is what keeps milestone 6 from being the milestone where items can
    // be deleted. There is no ground to spill onto, and silently destroying a
    // full crate is the worst thing in this task that could be written by
    // accident.
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "crate", dir: "east" });
    w.machineAt({ x: 21, y: 20 })!.inventory = { wheat: 3 };

    expect(run(w, 1, { kind: "remove", dir: "east" })).toEqual({
      ok: false,
      error: "crate is not empty",
    });
    expect(w.machineAt({ x: 21, y: 20 })!.inventory).toEqual({ wheat: 3 });
  });

  it("refuses a machine part-way through a conversion", () => {
    // Its inputs are already consumed and its output does not exist yet, so an
    // empty inventory is not the same as nothing to lose.
    const w = builderWorld();
    w.getBot(1).pos = { x: 20, y: 20 };
    run(w, 1, { kind: "place", machine: "mill", dir: "east" });
    const mill = w.machineAt({ x: 21, y: 20 })!;
    mill.inventory = { wheat: 3 };
    ticks(w, 2);
    expect(mill.progress).toBeGreaterThan(0);
    expect(mill.inventory).toEqual({});

    expect(run(w, 1, { kind: "remove", dir: "east" })).toEqual({
      ok: false,
      error: "mill is working",
    });
  });

  it("refuses the Research Console", () => {
    const w = builderWorld();
    w.getBot(1).pos = { x: 17, y: 16 };
    expect(run(w, 1, { kind: "remove", dir: "west" })).toEqual({
      ok: false,
      error: "the Research Console cannot be removed",
    });
  });

  it("says when there is nothing there", () => {
    const w = builderWorld();
    expect(run(w, 1, { kind: "remove", dir: "north" })).toEqual({
      ok: false,
      error: "no machine to the north",
    });
  });

  it("costs the ticks the config says", () => {
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "conveyor", dir: "east" });
    const placed = w.time;
    run(w, 1, { kind: "remove", dir: "east" });
    expect(w.time - placed).toBe(TICK_COST.remove);
  });

  it("leaves nothing of the machine behind", () => {
    // A removed machine that is still flagged starved somewhere is a leak that
    // only shows up as a mark on an empty tile.
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "mill", dir: "east" });
    ticks(w, 3); // long enough for the mill to report itself starved
    w.drainEvents();
    run(w, 1, { kind: "remove", dir: "east" });
    ticks(w, 3);

    expect(w.snapshot().machines.map((m) => m.kind)).toEqual(["console"]);
    expect(w.drainEvents().filter((e) => e.kind === "starved")).toEqual([]);
  });
});

/**
 * The hands-phase half, added by milestone 7's Task 0.
 *
 * Milestone 6 shipped removal as a script command only, and its playtest found
 * the soft-lock that follows: a bot fenced in by belts cannot harvest, so the
 * console cannot be fed, so the arm that would free it can never be researched.
 * The player's own hands are the way out, and these tests are about the two
 * paths staying one rule.
 */
describe("removing by hand", () => {
  it("gives the same reason canRemove returns and removeMachine throws", () => {
    const w = builderWorld();
    w.placeMachine("conveyor", { x: 25, y: 25 }, "north");
    w.placeMachine("crate", { x: 26, y: 25 });
    w.machineAt({ x: 26, y: 25 })!.inventory = { wheat: 1 };

    const cases = [
      { x: 25, y: 25 }, // an empty belt: allowed
      { x: 26, y: 25 }, // a crate with something in it
      { x: 16, y: 16 }, // the console
      { x: 2, y: 2 }, // bare ground
    ];
    for (const pos of cases) {
      const reason = w.canRemove(pos);
      if (reason === null) expect(() => w.removeMachine(pos)).not.toThrow();
      else expect(() => w.removeMachine(pos)).toThrow(reason);
    }
  });

  it("refuses what the arm refuses, for the same reason", () => {
    // The anti-drift test this task exists to make possible. Milestone 6 wrote
    // these rules inside doRemove, where a menu could not ask them; two copies
    // would part company the first time one of them was edited.
    const w = builderWorld();
    run(w, 1, { kind: "place", machine: "mill", dir: "east" });
    const mill = w.machineAt({ x: 21, y: 20 })!;
    mill.inventory = { wheat: 3 };
    ticks(w, 2);

    expect(w.canRemove({ x: 21, y: 20 })).toBe("mill is working");
    expect(run(w, 1, { kind: "remove", dir: "east" })).toEqual({
      ok: false,
      error: "mill is working",
    });
    expect(w.canRemove({ x: 16, y: 16 })).toBe("the Research Console cannot be removed");
  });

  it("frees a caged bot, which is the whole point", () => {
    const w = builderWorld();
    const bot = w.getBot(1);
    const around = [
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
    ];
    for (const { dx, dy } of around) {
      w.placeMachine("conveyor", { x: bot.pos.x + dx, y: bot.pos.y + dy }, "north");
    }
    // A wall is not an error: the move runs and reports that it went nowhere.
    expect(run(w, 1, { kind: "move", dir: "north" })).toEqual({ ok: true, value: false });

    w.removeMachine({ x: bot.pos.x, y: bot.pos.y - 1 });
    expect(run(w, 1, { kind: "move", dir: "north" })).toEqual({ ok: true, value: true });
  });

  it("leaves nothing of the machine behind, on this path too", () => {
    const w = builderWorld();
    w.placeMachine("mill", { x: 25, y: 25 });
    ticks(w, 3); // long enough for the mill to report itself starved
    w.drainEvents();

    w.removeMachine({ x: 25, y: 25 });
    ticks(w, 3);
    expect(w.machineAt({ x: 25, y: 25 })).toBeUndefined();
    expect(w.drainEvents().filter((e) => e.kind === "starved")).toEqual([]);
  });

  it("costs no ticks, because a player's click is not a thing the sim charges for", () => {
    const w = builderWorld();
    w.placeMachine("conveyor", { x: 25, y: 25 }, "north");
    const before = w.time;
    w.removeMachine({ x: 25, y: 25 });
    expect(w.time).toBe(before);
  });
});

describe("researching the builder arm", () => {
  it("is bought with bread and stocks a module to fit", () => {
    const w = new World({ seed: 1 });
    expect(RESEARCH_ITEM.builder).toBe("bread");
    w.machineAt({ x: 16, y: 16 })!.inventory = { bread: 100 };
    w.queueResearch("builder");
    ticks(w, 200);

    expect(w.research.unlocked.has("builder")).toBe(true);
    expect(w.research.spareModules.builder).toBe(1);
    w.installModule(1, "builder");
    expect(w.getBot(1).modules.has("builder")).toBe(true);
  });
});
