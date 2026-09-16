import { TERRAIN } from "../../src/render/palette";
import { GRAIN, fieldRim, groundShade, tileHash, tileNoise } from "../../src/render/texture";
import type { Terrain } from "../../src/sim/types";

const channels = (c: number): [number, number, number] => [
  (c >> 16) & 0xff,
  (c >> 8) & 0xff,
  c & 0xff,
];

/** How far apart two colours are, per channel, at their worst. */
const distance = (a: number, b: number): number => {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.max(Math.abs(ar - br), Math.abs(ag - bg), Math.abs(ab - bb));
};

describe("the ground's grain", () => {
  it("gives a coordinate the same shade every time it is asked", () => {
    // The property the whole module exists for. A field that reshuffles itself
    // on resize is noise dressed up as texture, and a player learns the shape
    // of their own field.
    for (const [x, y] of [[0, 0], [7, 3], [31, 31], [12, 20]] as const) {
      expect(tileHash(x, y)).toBe(tileHash(x, y));
      expect(groundShade("soil", x, y)).toBe(groundShade("soil", x, y));
    }
  });

  it("differs between every pair of neighbours on a 32x32 grid", () => {
    // A hash that agrees with its neighbour brings the flatness back one patch
    // at a time, so this checks the whole grid rather than a sample.
    const same: string[] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (x + 1 < 32 && tileHash(x, y) === tileHash(x + 1, y)) same.push(`${x},${y} east`);
        if (y + 1 < 32 && tileHash(x, y) === tileHash(x, y + 1)) same.push(`${x},${y} south`);
      }
    }
    expect(same).toEqual([]);
  });

  it("is not the checkerboard wearing a hash", () => {
    // Two values in a regular pattern read as a pattern; the point of this
    // change is a spread. The bar is deliberately low — many more than two —
    // because what matters is the distribution below, not the count.
    for (const terrain of ["grass", "soil"] as Terrain[]) {
      const shades = new Set<number>();
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) shades.add(groundShade(terrain, x, y));
      }
      expect(shades.size).toBeGreaterThan(8);
    }
  });

  it("keeps every shade inside its terrain's grain", () => {
    // No tile may come out as a bright speck. The bound is GRAIN, which this
    // module picks for itself rather than inheriting from the checkerboard —
    // the reason that lift was tiny was that a pattern is loud at any
    // amplitude, and grain has no pattern to be loud with.
    for (const terrain of ["grass", "soil"] as Terrain[]) {
      const { base } = TERRAIN[terrain];
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          expect(distance(groundShade(terrain, x, y), base)).toBeLessThanOrEqual(GRAIN[terrain]);
        }
      }
    }
  });

  it("shifts value without touching hue, which is what tells the terrains apart", () => {
    // Measured while writing this, and worth recording because it is not what
    // the two colours look like: grass and soil are only about 8.5 apart in
    // luma (52.4 against 60.9). They read as different ground because of hue —
    // a green against a brown — not because one is lighter.
    //
    // So the grain must leave hue alone. A uniform shift on all three channels
    // does, by keeping the differences between them, and that is the reason it
    // is a value shift rather than three independent ones. An earlier version
    // of this test asserted that the brightest grass stays darker than the
    // darkest soil; it fails at any visible amplitude, and it was the wrong
    // property to ask for.
    for (const terrain of ["grass", "soil"] as Terrain[]) {
      const [br, bg, bb] = channels(TERRAIN[terrain].base);
      for (let y = 0; y < 32; y++) {
        for (let x = 0; x < 32; x++) {
          const [r, g, b] = channels(groundShade(terrain, x, y));
          expect(r - g).toBe(br - bg);
          expect(g - b).toBe(bg - bb);
        }
      }
    }
  });

  it("spreads its noise over the whole range rather than bunching", () => {
    const values: number[] = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) values.push(tileNoise(x, y));
    expect(Math.min(...values)).toBeLessThan(0.1);
    expect(Math.max(...values)).toBeGreaterThan(0.9);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.4);
    expect(mean).toBeLessThan(0.6);
  });
});

describe("the field's edge", () => {
  // A 4x4 world with a 2x2 patch of soil at (1,1)-(2,2).
  const width = 4;
  const height = 4;
  const tiles = Array.from({ length: 16 }, (_, i) => {
    const x = i % 4;
    const y = Math.floor(i / 4);
    const soil = x >= 1 && x <= 2 && y >= 1 && y <= 2;
    return { terrain: (soil ? "soil" : "grass") as Terrain };
  });

  it("rims a soil tile on the sides that face grass", () => {
    expect(fieldRim(tiles, width, height, 1, 1)).toEqual({
      north: true,
      west: true,
      south: false,
      east: false,
    });
    expect(fieldRim(tiles, width, height, 2, 2)).toEqual({
      north: false,
      west: false,
      south: true,
      east: true,
    });
  });

  it("gives grass no rim at all, so the seam is drawn once", () => {
    // Both sides rimming their shared edge would darken it twice and put a line
    // around the whole world as well as around the field.
    expect(fieldRim(tiles, width, height, 0, 0)).toEqual({
      north: false,
      south: false,
      east: false,
      west: false,
    });
  });

  it("gives a soil tile with no grass neighbour no rim", () => {
    const all = Array.from({ length: 9 }, () => ({ terrain: "soil" as Terrain }));
    expect(fieldRim(all, 3, 3, 1, 1)).toEqual({
      north: false,
      south: false,
      east: false,
      west: false,
    });
  });

  it("does not rim against the edge of the world", () => {
    // There is nothing on the other side to be a boundary with, and a field that
    // ran to the world's edge would otherwise be fenced by one.
    const all = Array.from({ length: 9 }, () => ({ terrain: "soil" as Terrain }));
    expect(fieldRim(all, 3, 3, 0, 0)).toEqual({
      north: false,
      south: false,
      east: false,
      west: false,
    });
  });
});
