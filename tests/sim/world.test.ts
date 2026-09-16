import { CLOCKWISE, COUNTER_CLOCKWISE, World } from "../../src/sim/world";
import type { Direction } from "../../src/sim/types";
import { WHEAT_GROWTH_TICKS } from "../../src/sim/config";

describe("World generation", () => {
  it("defaults to a 32x32 grid", () => {
    const w = new World({ seed: 1 });
    expect(w.width).toBe(32);
    expect(w.height).toBe(32);
    expect(w.tiles).toHaveLength(32 * 32);
  });

  it("places the research console in the centre", () => {
    const w = new World({ seed: 1 });
    const console = w.machineAt({ x: 16, y: 16 });
    expect(console?.kind).toBe("console");
    expect(w.tileAt({ x: 16, y: 16 })?.crop).toBeNull();
  });

  it("spawns one bot with a harvester east of the console", () => {
    const w = new World({ seed: 1 });
    expect(w.bots.size).toBe(1);
    const bot = w.getBot(1);
    expect(bot.pos).toEqual({ x: 17, y: 16 });
    expect(bot.modules.has("harvester")).toBe(true);
    expect(bot.inventory).toEqual({});
  });

  it("puts soil with some mature wild wheat inside the field radius", () => {
    const w = new World({ seed: 1 });
    const inField = w.tileAt({ x: 18, y: 16 });
    expect(inField?.terrain).toBe("soil");
    const mature = w.tiles.filter(
      (t) => t.crop && t.crop.growth >= WHEAT_GROWTH_TICKS,
    );
    expect(mature.length).toBeGreaterThan(50);
  });

  it("puts grass with no crop outside the field radius", () => {
    const w = new World({ seed: 1 });
    const corner = w.tileAt({ x: 0, y: 0 });
    expect(corner?.terrain).toBe("grass");
    expect(corner?.crop).toBeNull();
  });

  it("generates identical tiles for identical seeds", () => {
    const a = new World({ seed: 99 });
    const b = new World({ seed: 99 });
    expect(a.tiles).toEqual(b.tiles);
  });

  it("generates different tiles for different seeds", () => {
    const a = new World({ seed: 1 });
    const b = new World({ seed: 2 });
    expect(a.tiles).not.toEqual(b.tiles);
  });

  it("returns undefined for out-of-bounds tiles", () => {
    const w = new World({ seed: 1 });
    expect(w.tileAt({ x: -1, y: 0 })).toBeUndefined();
    expect(w.tileAt({ x: 32, y: 0 })).toBeUndefined();
  });
});

/**
 * Milestone 6's finding 4: `R` turned one way, so north to west was three
 * presses. The second table is derived from the first rather than written out,
 * and this is what makes that safe.
 */
describe("the two quarter turns", () => {
  const DIRS: Direction[] = ["north", "east", "south", "west"];

  it("are inverses, for every direction", () => {
    for (const dir of DIRS) {
      expect(COUNTER_CLOCKWISE[CLOCKWISE[dir]], dir).toBe(dir);
      expect(CLOCKWISE[COUNTER_CLOCKWISE[dir]], dir).toBe(dir);
    }
  });

  it("return to where they started after four turns, either way", () => {
    for (const dir of DIRS) {
      let cw = dir;
      let ccw = dir;
      for (let i = 0; i < 4; i++) {
        cw = CLOCKWISE[cw];
        ccw = COUNTER_CLOCKWISE[ccw];
      }
      expect(cw, dir).toBe(dir);
      expect(ccw, dir).toBe(dir);
    }
  });

  it("goes north to west in one turn rather than three", () => {
    // The finding itself, stated as the case that prompted it.
    expect(COUNTER_CLOCKWISE.north).toBe("west");
  });

  it("covers all four directions rather than collapsing", () => {
    // A derived table built from the wrong half of each pair would be a valid
    // Record that mapped several directions to one.
    expect(new Set(Object.values(COUNTER_CLOCKWISE)).size).toBe(4);
  });
});
