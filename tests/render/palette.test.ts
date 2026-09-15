import {
  CROP_HEIGHT,
  ITEM,
  MACHINE,
  MODULE,
  TERRAIN,
  cropColor,
  cropStage,
} from "../../src/render/palette";
import { WHEAT_GROWTH_TICKS } from "../../src/sim/config";

const isColor = (n: number): boolean => Number.isInteger(n) && n >= 0 && n <= 0xffffff;

describe("the palette covers every sim union", () => {
  // Record<Terrain, …> and Record<Item, …> make the compiler the thing that
  // notices milestone 5's flour and bread. These assert the values are usable
  // colours, which the type cannot.
  it("gives every terrain a base and an alternate", () => {
    for (const [name, pair] of Object.entries(TERRAIN)) {
      expect(isColor(pair.base), name).toBe(true);
      expect(isColor(pair.alt), name).toBe(true);
      expect(pair.base, name).not.toBe(pair.alt);
    }
    expect(Object.keys(TERRAIN).sort()).toEqual(["grass", "soil"]);
  });

  it("gives every item a young and a ripe colour", () => {
    for (const [name, pair] of Object.entries(ITEM)) {
      expect(isColor(pair.young), name).toBe(true);
      expect(isColor(pair.ripe), name).toBe(true);
    }
    expect(Object.keys(ITEM)).toContain("wheat");
  });

  it("gives every machine kind a body and a trim", () => {
    for (const [name, pair] of Object.entries(MACHINE)) {
      expect(isColor(pair.body), name).toBe(true);
      expect(isColor(pair.trim), name).toBe(true);
    }
    expect(Object.keys(MACHINE).sort()).toEqual(["console", "crate"]);
  });

  it("gives every module a pip colour, and no two the same", () => {
    const values = Object.values(MODULE);
    for (const [name, c] of Object.entries(MODULE)) expect(isColor(c), name).toBe(true);
    // Pips are read by colour alone; two modules sharing one is unreadable.
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(MODULE).sort()).toEqual(["harvester", "planter", "radio", "scanner"]);
  });
});

describe("cropStage", () => {
  it("is 0 when just planted and 3 when mature", () => {
    expect(cropStage(0)).toBe(0);
    expect(cropStage(WHEAT_GROWTH_TICKS)).toBe(3);
  });

  it("never decreases across the whole range", () => {
    let last = 0;
    for (let g = 0; g <= WHEAT_GROWTH_TICKS; g++) {
      const s = cropStage(g);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });

  it("uses all four stages", () => {
    const seen = new Set<number>();
    for (let g = 0; g <= WHEAT_GROWTH_TICKS; g++) seen.add(cropStage(g));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("clamps rather than overflowing past maturity", () => {
    // Nothing grows past maturity today, but a longer-growing crop in a later
    // milestone would index a height table off the end.
    expect(cropStage(WHEAT_GROWTH_TICKS * 10)).toBe(3);
    expect(cropStage(-5)).toBe(0);
  });
});

describe("cropColor", () => {
  it("is the young colour when planted and the ripe colour when mature", () => {
    expect(cropColor("wheat", 0)).toBe(ITEM.wheat.young);
    expect(cropColor("wheat", WHEAT_GROWTH_TICKS)).toBe(ITEM.wheat.ripe);
  });

  it("lerps continuously in between, so a field ripens as a wave", () => {
    const mid = cropColor("wheat", WHEAT_GROWTH_TICKS / 2);
    expect(mid).not.toBe(ITEM.wheat.young);
    expect(mid).not.toBe(ITEM.wheat.ripe);
    expect(isColor(mid)).toBe(true);
  });

  it("stays a valid colour outside the growth range", () => {
    expect(isColor(cropColor("wheat", -10))).toBe(true);
    expect(isColor(cropColor("wheat", WHEAT_GROWTH_TICKS * 10))).toBe(true);
    expect(cropColor("wheat", WHEAT_GROWTH_TICKS * 10)).toBe(ITEM.wheat.ripe);
  });
});

describe("CROP_HEIGHT", () => {
  it("has one entry per stage and grows with it", () => {
    expect(CROP_HEIGHT).toHaveLength(4);
    for (let i = 1; i < CROP_HEIGHT.length; i++) {
      expect(CROP_HEIGHT[i]!).toBeGreaterThan(CROP_HEIGHT[i - 1]!);
    }
    for (const h of CROP_HEIGHT) expect(h).toBeGreaterThan(0);
    expect(CROP_HEIGHT[3]!).toBeLessThanOrEqual(1);
  });
});
