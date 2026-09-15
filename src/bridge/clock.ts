/**
 * The clock seam: the policy deciding whether simulated time advances on a
 * given pass of the drive loop.
 *
 * Two policies have to coexist. The demand-driven one makes milestone 1 and 2's
 * balance assertions deterministic — a script that computes for a thousand
 * iterations advances the clock by exactly zero — and it is the reason the
 * reference harvest loop can be asserted tick for tick. The real-time one is
 * what makes a game: the world ages whether or not a bot asked it to.
 */
export interface Clock {
  /** How many times to call `world.tick()` on this pass. */
  ticksDue(anyInFlight: boolean): number;
  /**
   * Fraction of a tick elapsed since the last one, in [0, 1).
   *
   * Meaningless to the sim and meaningful only to a renderer, which uses it to
   * draw a bot part-way between two tiles instead of snapping it on the tick a
   * move resolves. Read after `ticksDue` on the same pass.
   */
  readonly alpha: number;
}

/**
 * Time is a side effect of bots asking for things. Exactly the behaviour the
 * host had before this seam existed, and the default everywhere but the page.
 */
export class DemandClock implements Clock {
  /** Demand-driven time has no wall clock to be part-way through. */
  readonly alpha = 0;

  ticksDue(anyInFlight: boolean): number {
    return anyInFlight ? 1 : 0;
  }
}

export interface RealtimeClockOptions {
  /** Simulated ticks per real second. */
  hz?: number;
  /** Most ticks one pass may run, however far behind the clock has fallen. */
  maxCatchUp?: number;
  /** Injectable for tests, which must not sleep. */
  now?: () => number;
}

/**
 * Wall-clock pacing with an accumulator, both halves of it: how many ticks are
 * due, and how far into the next one the wall clock has already travelled.
 */
export class RealtimeClock implements Clock {
  paused = false;
  /** Multiplier on simulated time. 2 runs the world twice as fast. */
  speed = 1;

  private readonly tickMs: number;
  private readonly maxCatchUp: number;
  private readonly now: () => number;
  private accumulator = 0;
  private last: number;
  private pendingSteps = 0;

  constructor(opts: RealtimeClockOptions = {}) {
    this.tickMs = 1000 / (opts.hz ?? 20);
    this.maxCatchUp = opts.maxCatchUp ?? 8;
    this.now = opts.now ?? (() => Date.now());
    this.last = this.now();
  }

  /** Advance exactly `count` ticks on the next pass, while paused. */
  step(count = 1): void {
    this.pendingSteps += count;
  }

  /**
   * How far into the current tick the wall clock has travelled, in [0, 1).
   *
   * Two of its readings matter more than the arithmetic, and both are
   * behavioural rather than cosmetic:
   *
   * - **Paused reads zero**, so a paused world does not hold a bot frozen
   *   two-thirds of the way between two tiles. A player pauses in order to look
   *   at something, and a thing standing between two tiles is harder to read
   *   than a thing standing on one.
   * - **Catch-up reads zero**, because `ticksDue` zeroes the accumulator when
   *   it clamps. A tab returning from the background lands its actors on tiles
   *   rather than sliding them out of positions that are minutes stale.
   */
  get alpha(): number {
    if (this.paused) return 0;
    return Math.min(this.accumulator / this.tickMs, 1);
  }

  /** `anyInFlight` is ignored here by design: a real clock does not wait to be asked. */
  ticksDue(_anyInFlight = false): number {
    const now = this.now();
    const elapsed = now - this.last;
    this.last = now;

    if (this.paused) {
      // Time spent paused is discarded rather than banked, so unpausing does
      // not immediately spend a lunch break's worth of ticks.
      this.accumulator = 0;
      const stepped = this.pendingSteps;
      this.pendingSteps = 0;
      return stepped;
    }

    // Stepping only means something while paused; a running clock discards it.
    this.pendingSteps = 0;

    this.accumulator += elapsed * this.speed;
    let ticks = Math.floor(this.accumulator / this.tickMs);
    this.accumulator -= ticks * this.tickMs;

    if (ticks > this.maxCatchUp) {
      // A backgrounded tab must not come back and simulate ten minutes in one
      // frame. The debt is forgiven, not deferred.
      ticks = this.maxCatchUp;
      this.accumulator = 0;
    }
    return ticks;
  }
}
