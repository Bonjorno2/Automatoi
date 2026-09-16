import { World } from "../../src/sim/world";
import { TICK_COST, capacityOf } from "../../src/sim/config";
import { run, ticks } from "./helpers";

describe("move", () => {
  it("moves one tile and costs TICK_COST.move ticks", () => {
    const w = new World({ seed: 1 });
    const r = run(w, 1, { kind: "move", dir: "east" });
    expect(r).toEqual({ ok: true, value: true });
    expect(w.getBot(1).pos).toEqual({ x: 18, y: 16 });
    expect(w.time).toBe(TICK_COST.move);
  });

  it("supports all four directions", () => {
    const w = new World({ seed: 1 });
    run(w, 1, { kind: "move", dir: "south" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 17 });
    run(w, 1, { kind: "move", dir: "north" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
    run(w, 1, { kind: "move", dir: "east" });
    run(w, 1, { kind: "move", dir: "west" });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
  });

  it("returns false and stays put at the world edge", () => {
    const w = new World({ seed: 1, width: 4, height: 4 });
    // 4x4: centre is (2,2), bot starts at (3,2), the east edge.
    const r = run(w, 1, { kind: "move", dir: "east" });
    expect(r).toEqual({ ok: true, value: false });
    expect(w.getBot(1).pos).toEqual({ x: 3, y: 2 });
  });

  it("returns false when the target tile holds a machine", () => {
    const w = new World({ seed: 1 });
    // Console is directly west of the bot.
    const r = run(w, 1, { kind: "move", dir: "west" });
    expect(r).toEqual({ ok: true, value: false });
    expect(w.getBot(1).pos).toEqual({ x: 17, y: 16 });
  });

  it("waits when another bot is on the target tile, then proceeds", () => {
    const w = new World({ seed: 1 });
    w.research.spareChassis = 1;
    const other = w.deployBot({ x: 18, y: 16 });

    w.issue(1, { kind: "move", dir: "east" });
    ticks(w, TICK_COST.move + 2);
    expect(w.takeResult(1)).toBeNull();
    expect(w.getBot(1).blockedOn).toBe("bot");

    w.issue(other.id, { kind: "move", dir: "east" });
    ticks(w, TICK_COST.move);
    expect(w.takeResult(other.id)).toEqual({ ok: true, value: true });

    w.tick();
    expect(w.takeResult(1)).toEqual({ ok: true, value: true });
    expect(w.getBot(1).pos).toEqual({ x: 18, y: 16 });
    expect(w.getBot(1).blockedOn).toBeNull();
  });
});

/**
 * Milestone 8's finding 3: a bot walled in by belts read "idle", exactly like
 * one whose script had ended.
 *
 * A count rather than a `blockedOn` value, per Decision 5 of the milestone 9
 * plan: bot-on-bot and radio are *waiting*, and this is not — the move resolves,
 * answers false, and the script runs on.
 */
describe("a bot counts what got it nowhere", () => {
  function walled(): World {
    const w = new World({ seed: 1 });
    w.research.unlocked.add("conveyor");
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    for (const d of [{ x: 0, y: -1 }, { x: 0, y: 1 }, { x: 1, y: 0 }, { x: -1, y: 0 }]) {
      w.placeMachine("conveyor", { x: 20 + d.x, y: 20 + d.y }, "north");
    }
    return w;
  }

  it("starts at zero", () => {
    expect(new World({ seed: 1 }).getBot(1).stalled).toBe(0);
  });

  it("rises with every move that goes nowhere", () => {
    const w = walled();
    for (let i = 1; i <= 3; i++) {
      expect(run(w, 1, { kind: "move", dir: "north" })).toEqual({ ok: true, value: false });
      expect(w.getBot(1).stalled).toBe(i);
    }
  });

  it("resets the moment something works", () => {
    const w = walled();
    run(w, 1, { kind: "move", dir: "north" });
    expect(w.getBot(1).stalled).toBe(1);

    w.removeMachine({ x: 20, y: 19 });
    expect(run(w, 1, { kind: "move", dir: "north" })).toEqual({ ok: true, value: true });
    expect(w.getBot(1).stalled).toBe(0);
  });

  it("counts a transfer that transferred nothing, and not one that did", () => {
    // The rule is the command's own answer rather than a list of command kinds,
    // so a partial deposit of zero is stuck and a partial deposit of three is
    // progress, without either being named anywhere.
    const w = new World({ seed: 1 });
    w.research.unlocked.add("crate");
    const bot = w.getBot(1);
    bot.pos = { x: 20, y: 20 };
    bot.inventory = { wheat: 3 };
    const crate = w.placeMachine("crate", { x: 21, y: 20 });
    crate.inventory = { wheat: capacityOf("crate") };

    run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 3 });
    expect(w.getBot(1).stalled).toBe(1);

    crate.inventory = {};
    run(w, 1, { kind: "deposit", dir: "east", item: "wheat", count: 3 });
    expect(w.getBot(1).stalled).toBe(0);
  });

  it("does not count waiting, which is a thing a script does on purpose", () => {
    const w = walled();
    run(w, 1, { kind: "move", dir: "north" });
    expect(w.getBot(1).stalled).toBe(1);
    run(w, 1, { kind: "wait", ticks: 2 });
    expect(w.getBot(1).stalled).toBe(0);
  });

  it("carries into the snapshot, which is where the panel reads it", () => {
    const w = walled();
    run(w, 1, { kind: "move", dir: "north" });
    run(w, 1, { kind: "move", dir: "north" });
    expect(w.snapshot().bots[0]!.stalled).toBe(2);
  });
});
