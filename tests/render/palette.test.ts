import {
  BOT_BODY,
  CROP,
  CROP_HEIGHT,
  ITEM_COLOR,
  MACHINE,
  MODULE,
  TERRAIN,
  botColor,
  cropColor,
  cropStage,
} from "../../src/render/palette";
import { CROP_GROWTH, WHEAT_GROWTH_TICKS } from "../../src/sim/config";
import type { Item } from "../../src/sim/types";

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

  it("gives every item a colour", () => {
    // Was "every item has a young and a ripe colour", which was true when the
    // only item was a crop. Flour has no ripeness, so the claim splits in two.
    for (const [name, c] of Object.entries(ITEM_COLOR)) {
      expect(isColor(c), name).toBe(true);
    }
    expect(Object.keys(ITEM_COLOR).sort()).toEqual(["bread", "flour", "wheat"]);
  });

  it("gives every plantable item a young and a ripe colour", () => {
    for (const item of Object.keys(CROP_GROWTH) as Item[]) {
      const pair = CROP[item];
      expect(pair, item).toBeDefined();
      expect(isColor(pair!.young), item).toBe(true);
      expect(isColor(pair!.ripe), item).toBe(true);
    }
    expect(Object.keys(CROP)).toEqual(["wheat"]);
  });

  it("gives a non-crop item a flat colour rather than a ripeness", () => {
    expect(cropColor("flour", 0)).toBe(ITEM_COLOR.flour);
    expect(cropColor("flour", 999)).toBe(ITEM_COLOR.flour);
  });

  it("gives every machine kind a body and a trim", () => {
    for (const [name, pair] of Object.entries(MACHINE)) {
      expect(isColor(pair.body), name).toBe(true);
      expect(isColor(pair.trim), name).toBe(true);
    }
    expect(Object.keys(MACHINE).sort()).toEqual(["console", "crate", "mill", "oven"]);
  });

  it("gives every module a pip colour, and no two the same", () => {
    const values = Object.values(MODULE);
    for (const [name, c] of Object.entries(MODULE)) expect(isColor(c), name).toBe(true);
    // Pips are read by colour alone; two modules sharing one is unreadable.
    expect(new Set(values).size).toBe(values.length);
    expect(Object.keys(MODULE).sort()).toEqual(["harvester", "planter", "radio", "scanner"]);
  });
});

/** Perceived brightness, for asserting one colour is darker than another. */
const luma = (c: number): number =>
  0.299 * ((c >> 16) & 0xff) + 0.587 * ((c >> 8) & 0xff) + 0.114 * (c & 0xff);

describe("botColor", () => {
  it("gives every entry a usable colour, and no two the same", () => {
    // Bots are told apart by colour alone at the tile sizes this game renders
    // at, so two sharing one is two bots the player cannot distinguish.
    for (const c of BOT_BODY) expect(isColor(c)).toBe(true);
    expect(new Set(BOT_BODY).size).toBe(BOT_BODY.length);
  });

  it("gives the first bot the gold it has had since milestone 4", () => {
    // A player who has watched one bot for two milestones should not find it
    // recoloured by the arrival of a second.
    expect(botColor(0, true)).toBe(0xe0c060);
  });

  it("gives two bots two colours, and a third a third", () => {
    const colours = [botColor(0, true), botColor(1, true), botColor(2, true)];
    expect(new Set(colours).size).toBe(3);
  });

  it("dims an idle bot without changing which bot it is", () => {
    // Brightness carried busy-or-idle before this table existed and still does;
    // what changed is that it now says it about a specific bot.
    for (let i = 0; i < BOT_BODY.length; i++) {
      expect(luma(botColor(i, false))).toBeLessThan(luma(botColor(i, true)));
    }
    // Two idle bots are still two bots.
    expect(botColor(0, false)).not.toBe(botColor(1, false));
  });

  it("wraps rather than running out for a fleet larger than the table", () => {
    expect(botColor(BOT_BODY.length, true)).toBe(botColor(0, true));
    expect(isColor(botColor(99, true))).toBe(true);
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
    expect(cropColor("wheat", 0)).toBe(CROP.wheat!.young);
    expect(cropColor("wheat", WHEAT_GROWTH_TICKS)).toBe(CROP.wheat!.ripe);
  });

  it("lerps continuously in between, so a field ripens as a wave", () => {
    const mid = cropColor("wheat", WHEAT_GROWTH_TICKS / 2);
    expect(mid).not.toBe(CROP.wheat!.young);
    expect(mid).not.toBe(CROP.wheat!.ripe);
    expect(isColor(mid)).toBe(true);
  });

  it("stays a valid colour outside the growth range", () => {
    expect(isColor(cropColor("wheat", -10))).toBe(true);
    expect(isColor(cropColor("wheat", WHEAT_GROWTH_TICKS * 10))).toBe(true);
    expect(cropColor("wheat", WHEAT_GROWTH_TICKS * 10)).toBe(CROP.wheat!.ripe);
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
