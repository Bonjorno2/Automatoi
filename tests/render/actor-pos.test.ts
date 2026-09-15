import { actorPos } from "../../src/render/actor-pos";
import { World } from "../../src/sim/world";
import { TICK_COST } from "../../src/sim/config";
import type { ActionSnapshot, BlockedOn, BotSnapshot } from "../../src/sim/types";

function bot(over: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    id: 1,
    pos: { x: 5, y: 5 },
    inventory: {},
    modules: ["harvester"],
    busy: false,
    blockedOn: null,
    action: null,
    ...over,
  };
}

function moving(dir: "north" | "south" | "east" | "west", remaining: number, total = 2): ActionSnapshot {
  return { kind: "move", dir, remaining, total };
}

describe("actorPos", () => {
  it("is the bot's own tile when it has no action", () => {
    expect(actorPos(bot(), 0.7)).toEqual({ x: 5, y: 5 });
  });

  it("is the bot's own tile for actions that are not travel", () => {
    for (const kind of ["harvest", "plant", "scan", "deposit", "wait"] as const) {
      const b = bot({ action: { kind, dir: null, remaining: 1, total: 3 } });
      expect(actorPos(b, 0.9), kind).toEqual({ x: 5, y: 5 });
    }
  });

  it("slides across the move, reaching the far side as it resolves", () => {
    const start = actorPos(bot({ action: moving("east", 2) }), 0);
    const quarter = actorPos(bot({ action: moving("east", 2) }), 0.5);
    const half = actorPos(bot({ action: moving("east", 1) }), 0);
    const nearly = actorPos(bot({ action: moving("east", 1) }), 0.99);

    expect(start.x).toBe(5);
    expect(quarter.x).toBeCloseTo(5.25, 6);
    expect(half.x).toBeCloseTo(5.5, 6);
    expect(nearly.x).toBeGreaterThan(5.9);
    expect(nearly.y).toBe(5);
  });

  it("never reaches the destination tile, which the sim itself occupies", () => {
    // Reaching 1 draws the destination a frame before the sim moves the bot
    // there, which lands as a double-step.
    const b = bot({ action: moving("east", 0) });
    expect(actorPos(b, 0.999).x).toBeLessThan(6);
  });

  it("moves the right way for every direction", () => {
    const at = (dir: Parameters<typeof moving>[0]) => actorPos(bot({ action: moving(dir, 1) }), 0);
    expect(at("east")).toEqual({ x: 5.5, y: 5 });
    expect(at("west")).toEqual({ x: 4.5, y: 5 });
    expect(at("south")).toEqual({ x: 5, y: 5.5 });
    expect(at("north")).toEqual({ x: 5, y: 4.5 });
  });

  it("does not interpolate a blocked bot, whatever its action says", () => {
    // The retry path resets `remaining` to 1 every tick a bot waits, so an
    // interpolated blocked move lunges at the tile it cannot enter, forever.
    for (const on of ["bot", "radio"] as BlockedOn[]) {
      const b = bot({ action: moving("east", 1), blockedOn: on });
      expect(actorPos(b, 0.9), String(on)).toEqual({ x: 5, y: 5 });
    }
  });

  it("survives a zero-tick action without dividing by zero", () => {
    const b = bot({ action: { kind: "wait", dir: null, remaining: 0, total: 0 } });
    expect(actorPos(b, 0.5)).toEqual({ x: 5, y: 5 });
    const m = bot({ action: moving("east", 0, 0) });
    expect(actorPos(m, 0.5)).toEqual({ x: 5, y: 5 });
  });

  it("is monotonic across a real move driven by the real sim", () => {
    // The guard against an off-by-one in the progress formula: drive an actual
    // move and assert the drawn position only ever goes forward, and lands.
    const w = new World({ seed: 1 });
    const startX = w.getBot(1).pos.x;
    w.issue(1, { kind: "move", dir: "east" });

    let last = -Infinity;
    for (let t = 0; t < TICK_COST.move; t++) {
      for (const alpha of [0, 0.25, 0.5, 0.75, 0.99]) {
        const x = actorPos(w.snapshot().bots[0]!, alpha).x;
        expect(x).toBeGreaterThanOrEqual(last);
        expect(x).toBeLessThan(startX + 1);
        last = x;
      }
      w.tick();
    }
    expect(actorPos(w.snapshot().bots[0]!, 0).x).toBe(startX + 1);
  });
});
