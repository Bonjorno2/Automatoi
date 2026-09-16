import { TREAD, WORKING, consolePulse, ovenGlow, spinStep, treadOffset } from "../../src/render/animated";

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

describe("machines that look like they are working", () => {
  it("advances the grind in proportion to the frame it was given", () => {
    expect(spinStep(32)).toBeCloseTo(spinStep(16) * 2, 9);
  });

  it("clamps a long frame, so a backgrounded tab does not spin a hundred turns", () => {
    // The spin accumulates rather than being read off the wall clock, so that
    // stopping and restarting does not jump. That is what makes a ten-second
    // gap dangerous here and harmless for the tread.
    expect(spinStep(10_000)).toBe(spinStep(WORKING.maxStepMs));
  });

  it("never runs backwards or on a frame that took no time", () => {
    for (const dt of [0, -16, Number.NaN, -0]) expect(spinStep(dt)).toBe(0);
  });

  it("keeps the oven lit rather than blinking it off", () => {
    // A flicker that reaches zero reads as a fault light. The floor is what
    // makes it a fire.
    let low = Infinity;
    let high = 0;
    for (let t = 0; t < 20_000; t += 7) {
      const a = ovenGlow(t);
      low = Math.min(low, a);
      high = Math.max(high, a);
    }
    expect(low).toBeGreaterThanOrEqual(WORKING.ovenAlpha.min - 1e-9);
    expect(high).toBeLessThanOrEqual(WORKING.ovenAlpha.max + 1e-9);
    expect(low).toBeLessThan(high);
  });

  it("flickers faster than the console pulses", () => {
    // They are different signals and must not be mistaken for each other: a
    // fire is jittery and a thing worth noticing is slow.
    expect(Math.max(...WORKING.ovenPeriods)).toBeLessThan(WORKING.consolePeriod);
  });

  it("holds the console's pulse inside its band", () => {
    for (let t = 0; t < 20_000; t += 13) {
      expect(consolePulse(t)).toBeGreaterThanOrEqual(WORKING.consoleAlpha.min - 1e-9);
      expect(consolePulse(t)).toBeLessThanOrEqual(WORKING.consoleAlpha.max + 1e-9);
    }
  });

  it("is the same value twice for the same instant", () => {
    for (const t of [0, 333, 5000]) {
      expect(ovenGlow(t)).toBe(ovenGlow(t));
      expect(consolePulse(t)).toBe(consolePulse(t));
    }
  });

  it("gives a finite answer for a nonsense instant", () => {
    // A NaN alpha does not throw in Pixi; the sprite just stops being drawn.
    expect(Number.isFinite(ovenGlow(Number.NaN))).toBe(true);
    expect(Number.isFinite(consolePulse(Number.NaN))).toBe(true);
  });
});
