import { World } from "../../src/sim/world";
import {
  CAPACITY,
  MACHINE_CAPACITY,
  capacityOf,
  RESEARCH_ITEM,
} from "../../src/sim/config";
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

  it("is never reported as starved or jammed", () => {
    const w = beltWorld();
    const belt = w.placeMachine("conveyor", { x: 18, y: 18 }, "east");
    ticks(w, 10);
    const snap = w.snapshot().machines.find((m) => m.id === belt.id)!;
    expect(snap.starved).toBe(false);
    expect(snap.jammed).toBe(false);
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
