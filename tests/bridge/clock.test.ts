import { DemandClock, RealtimeClock } from "../../src/bridge/clock.ts";

/** A clock driven by a number we control, so no test ever sleeps. */
function fakeClock(opts: { hz?: number; maxCatchUp?: number } = {}) {
  let t = 0;
  const clock = new RealtimeClock({ ...opts, now: () => t });
  return { clock, advance: (ms: number) => { t += ms; } };
}

describe("DemandClock", () => {
  it("ticks only while something is counting down", () => {
    const clock = new DemandClock();
    expect(clock.ticksDue(true)).toBe(1);
    expect(clock.ticksDue(false)).toBe(0);
  });
});

describe("RealtimeClock", () => {
  it("runs at its configured rate", () => {
    // maxCatchUp raised out of the way; the cap has its own test below.
    const { clock, advance } = fakeClock({ hz: 20, maxCatchUp: 1000 });
    advance(1000);
    expect(clock.ticksDue(false)).toBe(20);
  });

  it("keeps the remainder rather than drifting", () => {
    const { clock, advance } = fakeClock({ hz: 20 }); // 50ms per tick
    advance(30);
    expect(clock.ticksDue(false)).toBe(0);
    advance(30); // 60ms banked: one tick due, 10ms carried
    expect(clock.ticksDue(false)).toBe(1);
    advance(40); // 50ms exactly
    expect(clock.ticksDue(false)).toBe(1);
  });

  it("caps catch-up so a backgrounded tab does not stampede", () => {
    const { clock, advance } = fakeClock({ hz: 20, maxCatchUp: 8 });
    advance(5000); // 100 ticks' worth
    expect(clock.ticksDue(false)).toBe(8);
    // The debt is forgiven, not deferred: the next pass starts clean.
    advance(50);
    expect(clock.ticksDue(false)).toBe(1);
  });

  it("advances the world whether or not a bot asked", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    advance(100);
    expect(clock.ticksDue(false)).toBe(2); // anyInFlight is false, still ticks
  });

  it("stops while paused and does not bank the time", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    clock.paused = true;
    advance(10_000);
    expect(clock.ticksDue(false)).toBe(0);
    clock.paused = false;
    advance(50);
    expect(clock.ticksDue(false)).toBe(1); // not 200
  });

  it("steps exactly once while paused", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    clock.paused = true;
    clock.step();
    expect(clock.ticksDue(false)).toBe(1);
    advance(10_000);
    expect(clock.ticksDue(false)).toBe(0);
  });

  it("scales with speed", () => {
    const { clock, advance } = fakeClock({ hz: 20, maxCatchUp: 1000 });
    clock.speed = 4;
    advance(1000);
    expect(clock.ticksDue(false)).toBe(80);
  });
});

describe("interpolation alpha", () => {
  it("starts at zero", () => {
    const { clock } = fakeClock({ hz: 20 });
    expect(clock.alpha).toBe(0);
  });

  it("reports how far into the current tick the wall clock has travelled", () => {
    const { clock, advance } = fakeClock({ hz: 20 }); // 50ms per tick
    advance(25);
    expect(clock.ticksDue(false)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5, 10);
  });

  it("carries only the remainder past a tick boundary", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    advance(75); // one tick due, 25ms carried
    expect(clock.ticksDue(false)).toBe(1);
    expect(clock.alpha).toBeCloseTo(0.5, 10);
  });

  it("never reaches one", () => {
    const { clock, advance } = fakeClock({ hz: 20, maxCatchUp: 1000 });
    for (const ms of [49.9, 50, 99.999, 1234.5]) {
      advance(ms);
      clock.ticksDue(false);
      expect(clock.alpha).toBeLessThan(1);
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
    }
  });

  it("advances at the clock's speed", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    clock.speed = 2;
    advance(12.5); // 25ms of simulated time at 2x
    clock.ticksDue(false);
    expect(clock.alpha).toBeCloseTo(0.5, 10);
  });

  it("reads zero while paused, so actors rest on tiles", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    advance(25);
    clock.ticksDue(false);
    expect(clock.alpha).toBeCloseTo(0.5, 10);
    clock.paused = true;
    expect(clock.alpha).toBe(0);
  });

  it("does not resume mid-tick after a pause", () => {
    const { clock, advance } = fakeClock({ hz: 20 });
    advance(25);
    clock.ticksDue(false);
    clock.paused = true;
    advance(10_000); // a lunch break
    clock.ticksDue(false);
    clock.paused = false;
    expect(clock.alpha).toBe(0);
  });

  it("reads zero after a clamped catch-up", () => {
    // The debt is forgiven rather than deferred, so there is no partial tick
    // left over to slide a returning tab's actors out of.
    const { clock, advance } = fakeClock({ hz: 20, maxCatchUp: 8 });
    advance(5000);
    expect(clock.ticksDue(false)).toBe(8);
    expect(clock.alpha).toBe(0);
  });

  it("is zero on a DemandClock", () => {
    expect(new DemandClock().alpha).toBe(0);
  });
});
