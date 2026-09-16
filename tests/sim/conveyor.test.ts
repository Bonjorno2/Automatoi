import { CLOCKWISE, World } from "../../src/sim/world";
import {
  CAPACITY,
  CONVEYOR_TICKS,
  MACHINE_CAPACITY,
  capacityOf,
  RESEARCH_ITEM,
} from "../../src/sim/config";
import type { Direction, Item, Vec } from "../../src/sim/types";
import { run, ticks } from "./helpers";

/**
 * A belt before it moves anything: a machine kind that faces a direction and
 * holds a little. Task 4 makes it carry.
 */

/** A world where belts may be placed, with the bot out of the way. */
function beltWorld(): World {
  const w = new World({ seed: 1 });
  w.research.unlocked.add("conveyor");
  return w;
}

describe("a conveyor is a machine that faces a direction", () => {
  it("records the facing it was placed with", () => {
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    expect(belt.dir).toBe("east");
    expect(w.snapshot().machines.find((m) => m.id === belt.id)!.dir).toBe("east");
  });

  it("faces north when nobody says otherwise", () => {
    const w = beltWorld();
    expect(w.placeMachine("conveyor", { x: 18, y: 18 }).dir).toBe("north");
  });

  it("gives a machine that cannot face anything a null facing", () => {
    // A crate has no front. Passing one a facing is not an error — the build
    // menu offers the same call for every kind — it is simply not recorded.
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const crate = w.placeMachine("crate", { x: 18, y: 18 }, "east");
    expect(crate.dir).toBeNull();
    expect(w.machineAt({ x: 16, y: 16 })!.dir).toBeNull(); // the console
  });

  it("refuses to place one that has not been researched", () => {
    const w = new World({ seed: 1 });
    expect(w.canPlace("conveyor", { x: 18, y: 18 })).toBe("conveyor not researched");
  });

  it("is bought with bread, like everything the chain pays for", () => {
    expect(RESEARCH_ITEM.conveyor).toBe("bread");
  });
});

describe("capacity is per machine kind", () => {
  it("lets a belt hold four of an item where a crate holds sixteen", () => {
    expect(capacityOf("conveyor")).toBe(CAPACITY.conveyor);
    expect(capacityOf("conveyor")).toBe(4);
    expect(capacityOf("crate")).toBe(MACHINE_CAPACITY);
  });

  it("falls back to the shared capacity for a kind with no entry", () => {
    // The table is partial on purpose: only a kind that differs needs a row.
    expect(capacityOf("console")).toBe(MACHINE_CAPACITY);
    expect(capacityOf("mill")).toBe(MACHINE_CAPACITY);
  });

  it("stops a deposit at the belt's own limit, not the shared one", () => {
    const w = beltWorld();
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    bot.inventory = { wheat: 10 };
    w.placeMachine("conveyor", { x: 19, y: 20 }, "west");

    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 10 });
    // A partial transfer, which is what every machine at capacity already does.
    expect(r).toEqual({ ok: true, value: 4 });
    expect(w.machineAt({ x: 19, y: 20 })!.inventory).toEqual({ wheat: 4 });
    expect(bot.inventory).toEqual({ wheat: 6 });
  });

  it("still lets a crate take sixteen", () => {
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    bot.inventory = { wheat: 10 };
    w.placeMachine("crate", { x: 19, y: 20 });
    const r = run(w, 1, { kind: "deposit", dir: "west", item: "wheat", count: 10 });
    expect(r).toEqual({ ok: true, value: 10 });
  });
});

describe("a belt is inert until Task 4", () => {
  it("converts nothing, however long it is left", () => {
    // It has no recipe, so the conversion step skips it the way it already
    // skips the console and the crate.
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 4 };
    ticks(w, 100);
    expect(belt.inventory).toEqual({ wheat: 4 });
    expect(belt.progress).toBe(0);
  });

  it("is never reported as starved, and an empty one is never jammed either", () => {
    // Narrowed by milestone 8's Task 3, which made a *loaded* dead-ended belt
    // jammed. The assertions below never covered that case — the belt here is
    // empty — but the name did, and a test whose title denies a rule it does not
    // exercise is worse than one that fails.
    //
    // Starved stays false for any belt at all: starvation is a recipe's problem
    // and a belt has no recipe.
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    ticks(w, 10);
    const snap = w.snapshot().machines.find((m) => m.id === belt.id)!;
    expect(snap.starved).toBe(false);
    expect(snap.jammed).toBe(false);
  });
});

/**
 * Milestone 6's finding 3: "a belt that cannot deliver looks exactly like one
 * that is briefly full".
 *
 * The wrong-facing corner is the case — four wheat ride the line, reach the belt
 * whose facing was never turned, and stop there for two hundred ticks. The mill
 * beyond it correctly reported `starved`; the belt itself had no state for this.
 *
 * The rule is about the layout, not about the belt being full: nothing ahead of
 * it *ever*, versus no room ahead of it *right now*.
 */
describe("a belt with nowhere to put its cargo says so", () => {
  const snapOf = (w: World, id: number) => w.snapshot().machines.find((m) => m.id === id)!;

  it("is jammed when it holds something and faces bare ground", () => {
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 2 };
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(true);
  });

  it("is jammed facing the world's edge, which is the same mistake", () => {
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 31, y: 20 }, "east");
    belt.inventory = { wheat: 1 };
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(true);
    // And still holds it: a flag is not a way to destroy something.
    expect(belt.inventory).toEqual({ wheat: 1 });
  });

  it("is not jammed when it is merely backed up behind a full machine", () => {
    // The line that matters. This belt is in a working line whose far end is
    // busy; flagging it would light up the whole line and teach the player that
    // the colour means nothing. Whatever is at the end is what is stuck.
    //
    // A crate rather than a mill, which the first version of this test used and
    // which does not hold still: a mill filled to capacity immediately eats
    // three wheat and makes room, so the belt delivered and the case under test
    // never happened.
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const crate = w.placeMachine("crate", { x: 19, y: 18 });
    crate.inventory = { wheat: capacityOf("crate") };
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 2 };

    ticks(w, CONVEYOR_TICKS * 2);
    expect(snapOf(w, belt.id).jammed).toBe(false);
    expect(belt.inventory).toEqual({ wheat: 2 });
  });

  it("stops being jammed the step after something is built in front of it", () => {
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 2 };
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(true);

    w.placeMachine("crate", { x: 19, y: 18 });
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(false);
  });

  it("stops being jammed once it is emptied", () => {
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 1 };
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(true);

    belt.inventory = {};
    ticks(w, CONVEYOR_TICKS);
    expect(snapOf(w, belt.id).jammed).toBe(false);
  });

  it("says so once, not every step", () => {
    // The edge-triggered `flag` helper every other machine state uses. A belt
    // steps every CONVEYOR_TICKS and a per-step event would be a mark that
    // never fades.
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    belt.inventory = { wheat: 2 };
    ticks(w, CONVEYOR_TICKS * 5);
    const jams = w.drainEvents().filter((e) => e.kind === "jammed" && e.machineId === belt.id);
    expect(jams).toHaveLength(1);
  });
});

describe("a belt is a wall, because every machine is", () => {
  it("stops a bot walking into it, and says so", () => {
    // Decision 2 of the milestone 6 plan, and the most likely thing in it to be
    // wrong. What makes it survivable is that the bump is already a signal:
    // milestone 4's mark fires for any machine, belts included.
    const w = beltWorld();
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    w.placeMachine("conveyor", { x: 21, y: 20 }, "east");

    expect(run(w, 1, { kind: "move", dir: "east" })).toEqual({ ok: true, value: false });
    expect(bot.pos).toEqual({ x: 20, y: 20 });
    expect(w.drainEvents().filter((e) => e.kind === "bump")).toHaveLength(1);
  });
});

/**
 * A line of belts along a row, all facing east, ending one tile short of a sink.
 *
 * `order` is the only thing that differs between the two worlds Fact 2 compares:
 * built downstream-first, the belts' ids ascend along the direction of travel,
 * which is exactly the ordering under which a naive loop carries an item the
 * whole length of the line in one step.
 */
function beltLine(
  world: World,
  from: Vec,
  length: number,
  order: "downstream" | "upstream",
): Vec[] {
  const tiles: Vec[] = [];
  for (let i = 0; i < length; i++) tiles.push({ x: from.x + i, y: from.y });
  for (const tile of order === "downstream" ? tiles : [...tiles].reverse()) {
    world.placeMachine("conveyor", tile, "east");
  }
  return tiles;
}

/** Tick until the machine at `at` holds the item. Returns the tick it arrived. */
function tickUntilHeld(world: World, at: Vec, item: Item): number {
  for (let i = 0; i < 500; i++) {
    world.tick();
    if ((world.machineAt(at)?.inventory[item] ?? 0) > 0) return world.time;
  }
  throw new Error(`nothing arrived at ${at.x},${at.y} within 500 ticks`);
}

describe("belts carry", () => {
  it("takes the same time whichever end the line was built from", () => {
    // **Fact 2 of the milestone 6 plan.** The two worlds differ only in the ids
    // their belts hold, so a difference here means the step is reading state it
    // has already written, and an item is riding the whole line in one tick.
    const arrival = (order: "downstream" | "upstream"): number => {
      const w = beltWorld();
      w.research.unlocked.add("crate");
      const tiles = beltLine(w, { x: 10, y: 20 }, 5, order);
      w.placeMachine("crate", { x: 15, y: 20 });
      w.machineAt(tiles[0]!)!.inventory = { wheat: 1 };
      return tickUntilHeld(w, { x: 15, y: 20 }, "wheat");
    };

    expect(arrival("downstream")).toBe(arrival("upstream"));
  });

  it("crosses a five-tile line in exactly five steps", () => {
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const tiles = beltLine(w, { x: 10, y: 20 }, 5, "downstream");
    w.placeMachine("crate", { x: 15, y: 20 });
    w.machineAt(tiles[0]!)!.inventory = { wheat: 1 };

    // Five hand-offs: four between belts, one into the crate.
    expect(tickUntilHeld(w, { x: 15, y: 20 }, "wheat")).toBe(5 * CONVEYOR_TICKS);
  });

  it("moves one tile per step and no further", () => {
    const w = beltWorld();
    const tiles = beltLine(w, { x: 10, y: 20 }, 4, "downstream");
    w.machineAt(tiles[0]!)!.inventory = { wheat: 1 };

    ticks(w, CONVEYOR_TICKS);
    expect(w.machineAt(tiles[1]!)!.inventory).toEqual({ wheat: 1 });
    expect(w.machineAt(tiles[0]!)!.inventory).toEqual({});
    expect(w.machineAt(tiles[2]!)!.inventory).toEqual({});
  });

  it("advances a whole line at once when there is room", () => {
    const w = beltWorld();
    const tiles = beltLine(w, { x: 10, y: 20 }, 4, "downstream");
    for (const tile of tiles) w.machineAt(tile)!.inventory = { wheat: 1 };

    ticks(w, CONVEYOR_TICKS);
    // The last belt faces bare ground and keeps what it holds; the other three
    // each hand one tile along, so the line reads 0, 1, 1, 2.
    expect(tiles.map((t) => w.machineAt(t)!.inventory.wheat ?? 0)).toEqual([0, 1, 1, 2]);
  });

  it("drains a saturated line from the front", () => {
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const tiles = beltLine(w, { x: 10, y: 20 }, 3, "downstream");
    w.placeMachine("crate", { x: 13, y: 20 });
    const cap = capacityOf("conveyor");
    for (const tile of tiles) w.machineAt(tile)!.inventory = { wheat: cap };

    ticks(w, CONVEYOR_TICKS);
    // Only the belt at the front had anywhere to put anything.
    expect(tiles.map((t) => w.machineAt(t)!.inventory.wheat ?? 0)).toEqual([cap, cap, cap - 1]);
    ticks(w, CONVEYOR_TICKS);
    expect(tiles.map((t) => w.machineAt(t)!.inventory.wheat ?? 0)).toEqual([cap, cap - 1, cap - 1]);
  });

  it("holds its cargo when what it faces is full", () => {
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const belt = w.placeMachine("conveyor", { x: 10, y: 20 }, "east");
    const crate = w.placeMachine("crate", { x: 11, y: 20 });
    crate.inventory = { wheat: MACHINE_CAPACITY };
    belt.inventory = { wheat: 2 };

    ticks(w, CONVEYOR_TICKS * 3);
    expect(belt.inventory).toEqual({ wheat: 2 });
    expect(crate.inventory).toEqual({ wheat: MACHINE_CAPACITY });
  });

  it("keeps an item it has nowhere to put, rather than destroying it", () => {
    // The rule that matters most in the step. A belt pointed at the world's
    // edge, or at bare ground, holds what it has for as long as it has it.
    const w = beltWorld();
    const edge = w.placeMachine("conveyor", { x: 31, y: 20 }, "east");
    const nowhere = w.placeMachine("conveyor", { x: 10, y: 20 }, "east");
    edge.inventory = { wheat: 1 };
    nowhere.inventory = { wheat: 1 };

    ticks(w, CONVEYOR_TICKS * 5);
    expect(edge.inventory).toEqual({ wheat: 1 });
    expect(nowhere.inventory).toEqual({ wheat: 1 });
  });

  it("never lets two belts feeding one exceed its capacity", () => {
    const w = beltWorld();
    const target = w.placeMachine("conveyor", { x: 10, y: 20 }, "north");
    const west = w.placeMachine("conveyor", { x: 9, y: 20 }, "east");
    const east = w.placeMachine("conveyor", { x: 11, y: 20 }, "west");
    const cap = capacityOf("conveyor");
    target.inventory = { wheat: cap - 1 };
    west.inventory = { wheat: 2 };
    east.inventory = { wheat: 2 };

    ticks(w, CONVEYOR_TICKS);
    // The target faces bare ground, so it keeps what it has and has room for
    // exactly one. One feeder fills it; the other keeps what it was holding.
    expect(target.inventory.wheat).toBe(cap);
    expect((west.inventory.wheat ?? 0) + (east.inventory.wheat ?? 0)).toBe(3);
  });

  it("steps every belt on the same tick", () => {
    const w = beltWorld();
    const a = w.placeMachine("conveyor", { x: 10, y: 20 }, "east");
    const b = w.placeMachine("conveyor", { x: 10, y: 22 }, "east");
    w.placeMachine("conveyor", { x: 11, y: 20 }, "east");
    w.placeMachine("conveyor", { x: 11, y: 22 }, "east");
    a.inventory = { wheat: 1 };
    b.inventory = { wheat: 1 };

    ticks(w, CONVEYOR_TICKS - 1);
    expect(a.inventory).toEqual({ wheat: 1 });
    ticks(w, 1);
    expect(a.inventory).toEqual({});
    expect(b.inventory).toEqual({});
  });
});

describe("what a belt may take from behind it", () => {
  /** A mill, and a belt on `beltAt` facing away from it. */
  function millWithBelt(dir: Direction, beltAt: Vec, millAt: Vec) {
    const w = beltWorld();
    w.research.unlocked.add("mill");
    const mill = w.placeMachine("mill", millAt);
    const belt = w.placeMachine("conveyor", beltAt, dir);
    return { w, mill, belt };
  }

  it("takes what the machine makes", () => {
    const { w, mill, belt } = millWithBelt("south", { x: 18, y: 18 }, { x: 18, y: 17 });
    mill.inventory = { flour: 2 };
    ticks(w, CONVEYOR_TICKS);
    expect(belt.inventory).toEqual({ flour: 1 });
    expect(mill.inventory).toEqual({ flour: 1 });
  });

  it("never takes what the machine is about to consume", () => {
    // Decision 4 of the plan. Without it a belt behind a mill quietly drains the
    // wheat the mill was going to grind, and the player watches a machine that
    // is fed constantly and produces nothing.
    const { w, mill, belt } = millWithBelt("south", { x: 18, y: 18 }, { x: 18, y: 17 });
    mill.inventory = { wheat: 3 };
    ticks(w, CONVEYOR_TICKS * 2);
    expect(belt.inventory.wheat ?? 0).toBe(0);
  });

  it("takes nothing at all from a crate or a console", () => {
    // A crate makes nothing, so a belt behind one is not a way to empty it, and
    // a belt behind the console cannot eat the bread research is about to.
    const w = beltWorld();
    w.research.unlocked.add("crate");
    const crate = w.placeMachine("crate", { x: 18, y: 17 });
    crate.inventory = { wheat: 10 };
    const fromCrate = w.placeMachine("conveyor", { x: 18, y: 18 }, "south");
    const console = w.machineAt({ x: 16, y: 16 })!;
    console.inventory = { bread: 6 };
    const fromConsole = w.placeMachine("conveyor", { x: 16, y: 17 }, "south");

    ticks(w, CONVEYOR_TICKS * 3);
    expect(fromCrate.inventory).toEqual({});
    expect(fromConsole.inventory).toEqual({});
    expect(crate.inventory).toEqual({ wheat: 10 });
    expect(console.inventory).toEqual({ bread: 6 });
  });

  it("stops taking when it is full", () => {
    const { w, mill, belt } = millWithBelt("south", { x: 18, y: 18 }, { x: 18, y: 17 });
    mill.inventory = { flour: 10 };
    ticks(w, CONVEYOR_TICKS * 10);
    expect(belt.inventory.flour).toBe(capacityOf("conveyor"));
  });

  it("takes from what is behind it and not from what it happens to touch", () => {
    // A belt beside a mill is not a belt behind a mill. This is the thing a
    // player will get wrong, and it has to be wrong in a way that does nothing
    // rather than in a way that half works.
    const w = beltWorld();
    w.research.unlocked.add("mill");
    const mill = w.placeMachine("mill", { x: 18, y: 17 });
    const beside = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    mill.inventory = { flour: 3 };

    ticks(w, CONVEYOR_TICKS * 6);
    expect(beside.inventory).toEqual({});
    expect(mill.inventory).toEqual({ flour: 3 });
  });
});

describe("turning a belt", () => {
  it("cycles four ways and comes back", () => {
    // Beside DIR in world.ts for the same reason DIR is exported at all: the
    // renderer, the build menu and the builder arm all need to agree with the
    // sim about what turning means, and a second copy of this would drift.
    let dir: Direction = "north";
    const seen: Direction[] = [];
    for (let i = 0; i < 4; i++) {
      dir = CLOCKWISE[dir];
      seen.push(dir);
    }
    expect(seen).toEqual(["east", "south", "west", "north"]);
  });

  it("turns every direction into a different one", () => {
    for (const dir of ["north", "east", "south", "west"] as Direction[]) {
      expect(CLOCKWISE[dir]).not.toBe(dir);
    }
  });
});

describe("the step is deterministic", () => {
  it("runs two identical worlds to the same state", () => {
    const build = (): World => {
      const w = beltWorld();
      w.research.unlocked.add("crate");
      beltLine(w, { x: 10, y: 20 }, 4, "downstream");
      w.placeMachine("crate", { x: 14, y: 20 });
      w.machineAt({ x: 10, y: 20 })!.inventory = { wheat: 3 };
      return w;
    };
    const a = build();
    const b = build();
    ticks(a, 40);
    ticks(b, 40);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
