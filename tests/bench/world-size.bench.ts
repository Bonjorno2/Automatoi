import { World } from "../../src/sim/world";

/**
 * **What a bigger map costs, measured rather than guessed at.**
 *
 * The design doc's last open question says the renderer was 1.71ms of a 16.6ms
 * budget at 32x32 — 0.17 sim, 0.65 scene update, 0.89 render — and to "revisit
 * if the world grows by an order of magnitude". This is the revisit, and it is
 * the half that needs no browser: the sim's own per-frame work.
 *
 * Two things in the frame path are O(map area) and both are on the *frame*
 * clock rather than the tick clock:
 *
 * 1. `World.snapshot()`, called once per frame by `draw()` in `main.ts`, which
 *    allocates **a fresh object per tile** every time it is called. At 32x32
 *    that is 1,024 objects a frame; the question is what it is at 128x128.
 * 2. `World.tick()`, which is on the tick clock and therefore runs up to 4x per
 *    frame at the game's top speed.
 *
 * The field stays 13x13 whatever the map is (`FIELD_RADIUS` is 6), so this
 * isolates the cost of *area* from the cost of *content*. A bigger map with a
 * bigger field costs both, and the second is a separate measurement.
 *
 * Run with `npm run bench`.
 */

const SIZES = [32, 64, 128, 256] as const;

/** A 60fps frame. Every number here is worth reading as a share of this. */
const FRAME_BUDGET_MS = 16.6;

/**
 * Time one call, as the best of several batches.
 *
 * Best rather than mean: the thing being measured is what the work costs, and a
 * batch that happened to catch a GC pause or the OS scheduler measures the
 * machine. The worst case matters too and is reported beside it.
 */
function timeCall(label: string, fn: () => void, batches = 7, per = 200): {
  label: string;
  best: number;
  worst: number;
} {
  // Warm up: the first hundred calls are the JIT's, not the game's.
  for (let i = 0; i < 100; i++) fn();

  const means: number[] = [];
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < per; i++) fn();
    means.push((performance.now() - t0) / per);
  }
  means.sort((a, b) => a - b);
  return { label, best: means[0]!, worst: means[means.length - 1]! };
}

const pct = (ms: number): string => `${((ms / FRAME_BUDGET_MS) * 100).toFixed(1)}% of a frame`;

describe("what a bigger map costs the sim", () => {
  it("measures snapshot and tick against map area", () => {
    const rows: string[] = [];

    for (const size of SIZES) {
      const world = new World({ seed: 1, width: size, height: size });
      const tiles = size * size;

      const snap = timeCall(`snapshot ${size}`, () => void world.snapshot());
      const tick = timeCall(`tick ${size}`, () => world.tick());

      rows.push(
        `  ${String(size).padStart(3)}x${size} (${String(tiles).padStart(6)} tiles)  ` +
          `snapshot ${snap.best.toFixed(3)}ms (worst ${snap.worst.toFixed(3)})  ` +
          `tick ${tick.best.toFixed(4)}ms  ` +
          `| one frame's snapshot = ${pct(snap.best)}`,
      );
    }

    console.log("\n  cost of map area, per call:");
    for (const row of rows) console.log(row);
    console.log(
      "\n  snapshot() runs once per frame in draw(); tick() runs up to 4x per\n" +
        "  frame at the game's top speed. Renderer cost is measured separately,\n" +
        "  on the page, because it needs a canvas.\n",
    );

    // Not an assertion about speed — an assertion that the measurement ran on
    // the worlds it says it did, so a silently-32x32 run cannot be read as good
    // news about 256x256.
    for (const size of SIZES) {
      expect(new World({ seed: 1, width: size, height: size }).snapshot().tiles.length).toBe(
        size * size,
      );
    }
  }, 180_000);
});
