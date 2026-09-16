import { TREAD, treadOffset } from "../../src/render/animated";

describe("the belt tread", () => {
  const size = 20;
  const spacing = size * TREAD.spacing;

  it("never leaves one chevron spacing", () => {
    // The pattern is seamless because the offset wraps. An offset that grew
    // without bound would lose precision and stutter after a long session, and
    // one that reset to zero would visibly jump.
    for (let t = 0; t < 120_000; t += 137) {
      const offset = treadOffset(t, size);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(spacing);
    }
  });

  it("advances with time", () => {
    expect(treadOffset(100, size)).not.toBe(treadOffset(0, size));
    // And in the direction it is meant to: within a single wrap it only grows.
    const step = (spacing / (TREAD.speed * size)) * 1000 * 0.2;
    for (let k = 0; k < 4; k++) {
      expect(treadOffset(step * (k + 1), size)).toBeGreaterThan(treadOffset(step * k, size));
    }
  });

  it("is the same value twice for the same instant", () => {
    // No hidden state: the perf loop draws the same frame more than once.
    for (const t of [0, 250, 1000, 9999]) expect(treadOffset(t, size)).toBe(treadOffset(t, size));
  });

  it("lands back where it started after a whole spacing", () => {
    const period = (spacing / (TREAD.speed * size)) * 1000;
    for (const t of [0, 400, 1234]) {
      expect(treadOffset(t + period, size)).toBeCloseTo(treadOffset(t, size), 6);
    }
  });

  it("scales with the tile, so the pattern survives a resize", () => {
    // Twice the tile is twice the spacing and twice the travel, so a belt looks
    // the same at every fit rather than scrolling faster in a bigger window.
    for (const t of [0, 300, 700, 2500]) {
      expect(treadOffset(t, 40)).toBeCloseTo(treadOffset(t, 20) * 2, 6);
    }
  });

  it("gives nothing to draw for a degenerate tile", () => {
    // `fit` really does produce size 0 during startup, and a NaN that reaches
    // Pixi disappears the whole canvas silently.
    expect(treadOffset(1000, 0)).toBe(0);
    expect(treadOffset(Number.NaN, 20)).toBe(0);
  });

  it("is dimmer when the belt is empty than when it is carrying", () => {
    // Decoration on top of the cargo pips, not a replacement for them.
    expect(TREAD.alpha.empty).toBeLessThan(TREAD.alpha.loaded);
  });
});
