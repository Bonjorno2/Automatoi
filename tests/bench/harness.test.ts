import { World } from "../../src/sim/world";
import { DemandClock } from "../../src/bridge/clock.ts";
import { measure, describeResult } from "./harness.ts";

/**
 * The harness's own bookkeeping, which is the half of it that can be tested
 * quickly.
 *
 * Every test here injects `DemandClock`, on purpose. What is under test is the
 * window arithmetic — where the measurement starts, what it counts, and whether
 * it notices a bot that did nothing — and none of that is about pacing. The
 * realtime clock is the *subject* of the benchmarks in `*.bench.ts`, which are
 * slow by construction and do not run in this suite.
 *
 * **Why the bands below are loose.** `colony.run()` starts a drive loop of its
 * own, paced by `setImmediate`, and the harness's loop is deliberately slower so
 * it does not starve the worker threads. So the world can advance several ticks
 * between two evaluations of `until`, and a window boundary overshoots its
 * predicate. Only the *boundary* is imprecise — the tick accounting either side
 * of it is exact, because it is read off `world.time` rather than counted by the
 * poller. Under a realtime clock the overshoot is under a tick anyway, since
 * wall time is what decides how many ticks are due.
 */

/** Burns ticks steadily and forever, one command at a time. */
const TICKER = `while (true) bot.wait(1);`;

describe("the benchmark harness", () => {
  it("counts the simulated ticks the window lasted", async () => {
    const world = new World({ seed: 1 });
    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      until: (w) => w.time >= 60,
      timeoutMs: 30_000,
    });

    expect(result.reachedTarget).toBe(true);
    // The window opened at tick 0, so its length is the world's own clock. The
    // ceiling is loose on purpose — see the note above — and proves only that
    // the window closed on the target rather than running to the deadline.
    expect(result.ticks).toBeGreaterThanOrEqual(60);
    expect(result.ticks).toBeLessThan(400);
    expect(result.warmUpTicks).toBe(0);
  }, 60_000);

  it("excludes the warm-up from the measured window", async () => {
    const world = new World({ seed: 1 });
    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      startWhen: (w) => w.time >= 40,
      until: (w) => w.time >= 100,
      timeoutMs: 30_000,
    });

    expect(result.reachedTarget).toBe(true);
    expect(result.warmUpTicks).toBeGreaterThanOrEqual(40);
    // The invariant that matters, rather than a tight band: the warm-up's ticks
    // came out of the window, and the two together cover the whole run.
    expect(result.ticks).toBeGreaterThan(0);
    expect(result.ticks).toBeLessThan(100);
    expect(result.warmUpTicks + result.ticks).toBeGreaterThanOrEqual(100);
  }, 60_000);

  it("counts commands per bot inside the window only", async () => {
    const world = new World({ seed: 1 });
    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      startWhen: (w) => w.time >= 40,
      until: (w) => w.time >= 100,
      timeoutMs: 30_000,
    });

    const bot1 = result.bots.find((b) => b.id === 1);
    expect(bot1).toBeDefined();
    // Roughly one command per tick, and strictly fewer than the whole run's
    // worth — the warm-up's commands belong to the warm-up.
    expect(bot1!.commands).toBeGreaterThan(0);
    expect(bot1!.commands).toBeLessThan(result.warmUpTicks + result.ticks);
    expect(bot1!.bootTick).not.toBeNull();
  }, 60_000);

  it("says so when a bot did nothing in the window", async () => {
    // The guard milestone 9's benchmark needed. A second bot exists in the world
    // and never runs a command, which is indistinguishable — to every earlier
    // benchmark — from a second bot that is pulling its weight.
    const world = new World({ seed: 1 });
    world.research.spareChassis = 1;
    const idle = world.deployBot({ x: 10, y: 10 });

    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      until: (w) => w.time >= 40,
      timeoutMs: 30_000,
    });

    expect(result.reachedTarget).toBe(true);
    expect(result.everyBotWorked).toBe(false);

    const passenger = result.bots.find((b) => b.id === idle.id);
    expect(passenger).toBeDefined();
    expect(passenger!.commands).toBe(0);
    expect(passenger!.bootTick).toBeNull();
  }, 60_000);

  it("reports a timeout rather than throwing, so the numbers survive it", async () => {
    const world = new World({ seed: 1 });
    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      until: () => false,
      timeoutMs: 300,
    });

    expect(result.reachedTarget).toBe(false);
    // The run still happened, so there is something to look at while working out
    // why the target was never reached.
    expect(result.ticks).toBeGreaterThan(0);
    expect(describeResult("timed out", result)).toContain("TIMED OUT");
  }, 60_000);

  it("summarises a result in one line", async () => {
    const world = new World({ seed: 1 });
    const result = await measure({
      world,
      script: TICKER,
      clock: new DemandClock(),
      until: (w) => w.time >= 20,
      timeoutMs: 30_000,
    });

    const line = describeResult("one bot", result);
    expect(line).toContain("one bot");
    expect(line).toContain("ticks");
    expect(line).toContain("bot 1");
    expect(line).not.toContain("TIMED OUT");
  }, 60_000);
});
