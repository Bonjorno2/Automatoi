import { CROP_HEIGHT } from "../../src/render/palette";
import { WIND, leanedHeight, sway } from "../../src/render/motion";

/** Every instant a test wants to look at, so a bad period cannot hide between them. */
const INSTANTS = Array.from({ length: 400 }, (_, i) => i * 37);
const STAGES = [0, 1, 2, 3];

describe("Fact 2: sway must not make a crop lie about its stage", () => {
  it("keeps a fully leaning crop taller than an upright one of the stage below", () => {
    // The check the plan asks for before any of this ships. `cropStage` buckets
    // growth into four heights because geometry has to change in steps to be
    // noticed at all; a lean that eats a whole step would undo that.
    for (let stage = 1; stage < CROP_HEIGHT.length; stage++) {
      expect(leanedHeight(stage)).toBeGreaterThan(CROP_HEIGHT[stage - 1]!);
    }
  });

  it("keeps 98% of each stage's height even at full lean", () => {
    // The stronger version, and the one that does the work. The stage steps are
    // far enough apart that the test above passes at absurd amplitudes — a
    // stage-1 crop could lean 54 degrees and still out-measure an upright
    // stage 0 — so this pins the lean as a lean rather than as a crop falling
    // over. At the amplitudes in WIND the worst case is stage 0 keeping 98.6%.
    for (const stage of STAGES) {
      expect(leanedHeight(stage)).toBeGreaterThan(CROP_HEIGHT[stage]! * 0.98);
    }
  });

  it("sways a heavy ripe head less than a young shoot", () => {
    for (let stage = 1; stage < WIND.amplitude.length; stage++) {
      expect(WIND.amplitude[stage]!).toBeLessThan(WIND.amplitude[stage - 1]!);
    }
  });
});

describe("sway", () => {
  it("stays inside its stage's amplitude at every instant", () => {
    for (const stage of STAGES) {
      for (const t of INSTANTS) {
        for (const [x, y] of [[0, 0], [5, 9], [31, 31]] as const) {
          expect(Math.abs(sway(x, y, t, stage))).toBeLessThanOrEqual(WIND.amplitude[stage]! + 1e-12);
        }
      }
    }
  });

  it("actually reaches most of that amplitude, so the bound is not theoretical", () => {
    let peak = 0;
    for (const t of INSTANTS) peak = Math.max(peak, Math.abs(sway(3, 4, t, 0)));
    expect(peak).toBeGreaterThan(WIND.amplitude[0]! * 0.8);
  });

  it("is the same value twice for the same tile and instant", () => {
    // No hidden state. A frame drawn twice — which the perf loop does — must not
    // show the field in two places.
    for (const t of INSTANTS.slice(0, 20)) {
      expect(sway(7, 11, t, 2)).toBe(sway(7, 11, t, 2));
    }
  });

  it("differs between neighbours at the same instant", () => {
    // Otherwise the field moves as one body, which reads as a pulse and not as
    // wind crossing it.
    for (const t of INSTANTS.slice(0, 40)) {
      expect(sway(4, 4, t, 1)).not.toBe(sway(5, 4, t, 1));
      expect(sway(4, 4, t, 1)).not.toBe(sway(4, 5, t, 1));
    }
  });

  it("moves with time", () => {
    const first = sway(6, 6, 0, 1);
    const later = sway(6, 6, 700, 1);
    expect(later).not.toBe(first);
  });

  it("does not repeat on a short period, so the field never marches in step", () => {
    // Two sines whose periods share a factor would lock, and a field that
    // repeats every few seconds reads as an animation loop.
    const a = sway(2, 3, 0, 1);
    let matches = 0;
    for (let t = 1000; t < 60000; t += 1000) {
      if (Math.abs(sway(2, 3, t, 1) - a) < 1e-6) matches++;
    }
    expect(matches).toBe(0);
  });

  it("treats a stage outside the table as the nearest one it has", () => {
    // `cropStage` cannot return these, but a caller passing a raw growth could,
    // and an undefined amplitude would put NaN into a sprite's rotation — which
    // Pixi does not report, it just stops drawing.
    for (const stage of [-3, 4, 99, 1.7]) {
      expect(Number.isFinite(sway(1, 1, 500, stage))).toBe(true);
    }
    expect(sway(1, 1, 500, -3)).toBe(sway(1, 1, 500, 0));
    expect(sway(1, 1, 500, 99)).toBe(sway(1, 1, 500, 3));
  });
});
