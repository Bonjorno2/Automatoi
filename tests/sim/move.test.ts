import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
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
