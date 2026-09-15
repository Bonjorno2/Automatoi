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
}

/**
 * Time is a side effect of bots asking for things. Exactly the behaviour the
 * host had before this seam existed, and the default everywhere but the page.
 */
export class DemandClock implements Clock {
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
 * Wall-clock pacing with an accumulator.
 *
 * No interpolation alpha: that half of the usual accumulator only means
 * something to a renderer, and there is not one yet. Milestone 4 adds it.
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
