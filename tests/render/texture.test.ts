import { TERRAIN } from "../../src/render/palette";
import {
  GRAIN,
  SHADOW,
  VIGNETTE,
  fieldRim,
  groundShade,
  shadowRings,
  tileHash,
  tileNoise,
  vignetteBands,
} from "../../src/render/texture";
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

describe("shadows", () => {
  it("stacks from largest and faintest to smallest and darkest", () => {
    const rings = shadowRings(20, 0.66);
    expect(rings).toHaveLength(SHADOW.rings);
    for (let i = 1; i < rings.length; i++) {
      expect(rings[i]!.rx).toBeLessThan(rings[i - 1]!.rx);
      expect(rings[i]!.alpha).toBeGreaterThan(rings[i - 1]!.alpha);
    }
    // Drawn in this order, so the dark middle lands on top of the faint edge.
    expect(rings.at(-1)!.alpha).toBe(SHADOW.alpha);
  });

  it("is flatter than it is wide, because it lies on the ground", () => {
    for (const ring of shadowRings(20, 0.66)) expect(ring.ry).toBeLessThan(ring.rx);
  });

  it("scales with the tile, so it survives a resize", () => {
    const small = shadowRings(10, 0.66);
    const big = shadowRings(20, 0.66);
    small.forEach((ring, i) => expect(big[i]!.rx).toBeCloseTo(ring.rx * 2, 6));
  });

  it("is a crate's width for a crate and a bot's for a bot", () => {
    expect(shadowRings(20, 0.78)[0]!.rx).toBeGreaterThan(shadowRings(20, 0.66)[0]!.rx);
  });

  it("never reaches outside its own tile", () => {
    // A shadow wider than a tile puts a dark band under the machine beside it.
    const size = 20;
    for (const width of [0.66, 0.78, 0.86]) {
      for (const ring of shadowRings(size, width)) {
        expect(ring.rx).toBeLessThanOrEqual(size / 2);
      }
    }
  });
});

describe("the vignette", () => {
  const pane = { width: 800, height: 600 };

  it("fades from the edge inward and never brightens", () => {
    const bands = vignetteBands(pane);
    expect(bands.length).toBeGreaterThan(0);
    expect(bands[0]!.alpha).toBeCloseTo(VIGNETTE.strength, 6);
    let previous = Infinity;
    for (const band of bands) {
      expect(band.alpha).toBeLessThanOrEqual(previous + 1e-9);
      previous = band.alpha;
    }
    expect(bands.at(-1)!.alpha).toBeLessThan(VIGNETTE.strength * 0.05);
  });

  it("stays inside the pane it frames", () => {
    for (const band of vignetteBands(pane)) {
      expect(band.x).toBeGreaterThanOrEqual(0);
      expect(band.y).toBeGreaterThanOrEqual(0);
      expect(band.x + band.width).toBeLessThanOrEqual(pane.width + 1e-9);
      expect(band.y + band.height).toBeLessThanOrEqual(pane.height + 1e-9);
    }
  });

  it("leaves the middle of the pane alone", () => {
    // Unnoticeable when looked at directly is the whole brief. Nothing may be
    // drawn over the centre, where the player is looking.
    const cx = pane.width / 2;
    const cy = pane.height / 2;
    for (const band of vignetteBands(pane)) {
      const covers =
        cx > band.x && cx < band.x + band.width && cy > band.y && cy < band.y + band.height;
      expect(covers).toBe(false);
    }
  });

  it("draws nothing for a pane with no area", () => {
    // The page really does lay out a zero-height pane for a frame or two during
    // startup, which is the same hazard `fit` guards against.
    expect(vignetteBands({ width: 0, height: 600 })).toEqual([]);
    expect(vignetteBands({ width: 800, height: 0 })).toEqual([]);
  });
});
