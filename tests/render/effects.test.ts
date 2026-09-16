import {
  EFFECTS,
  ParticlePool,
  harvestBurst,
  particleAlpha,
  placementDust,
  stepParticle,
  transferMote,
  type Particle,
} from "../../src/render/effects";

const mote = (over: Partial<Particle> = {}): Particle => ({
  x: 4,
  y: 5,
  vx: 1,
  vy: -1,
  age: 0,
  life: 500,
  colour: 0xffffff,
  radius: 0.1,
  ...over,
});

describe("one particle", () => {
  it("is retired at the end of its life and not before", () => {
    const p = mote({ life: 100 });
    expect(stepParticle(p, 90)).toBe(true);
    expect(stepParticle(p, 20)).toBe(false);
  });

  it("is deterministic for the same inputs", () => {
    const a = mote();
    const b = mote();
    for (let i = 0; i < 10; i++) {
      stepParticle(a, 16);
      stepParticle(b, 16);
    }
    expect(a).toEqual(b);
  });

  it("keeps velocity and age independent of how the frame was split", () => {
    // Drag is exponential rather than a per-frame multiply for exactly this: a
    // stuttering frame rate must not leave a burst moving at a different speed.
    // Velocity and age are therefore exact under any split.
    const one = mote();
    const many = mote();
    stepParticle(one, 100);
    for (let i = 0; i < 10; i++) stepParticle(many, 10);
    expect(many.vx).toBeCloseTo(one.vx, 12);
    expect(many.age).toBeCloseTo(one.age, 12);
  });

  it("lands a mote in nearly the same place however the frame was split", () => {
    // Nearly, not exactly. Position is Euler-integrated, so a coarse step lags
    // a fine one by a first-order term — measured at 0.009 tiles for a single
    // 100 ms step against ten of 10 ms, on a particle that lives 620 ms. That
    // is a hundredth of a tile and it converges as frames get shorter; an exact
    // integrator here would be arithmetic nobody can see the result of.
    const one = mote();
    const many = mote();
    stepParticle(one, 100);
    for (let i = 0; i < 10; i++) stepParticle(many, 10);
    expect(Math.abs(many.x - one.x)).toBeLessThan(0.02);
  });

  it("falls back down, so a burst arcs instead of flying away", () => {
    const p = mote({ vx: 0, vy: -2 });
    for (let i = 0; i < 40; i++) stepParticle(p, 16);
    expect(p.vy).toBeGreaterThan(-2);
  });

  it("does nothing at all for a frame that took no time", () => {
    const p = mote();
    const before = { ...p };
    stepParticle(p, 0);
    expect(p).toEqual(before);
  });
});

describe("fading", () => {
  it("holds full opacity briefly and then falls to nothing", () => {
    expect(particleAlpha(0, 500)).toBe(1);
    expect(particleAlpha(50, 500)).toBe(1);
    expect(particleAlpha(500, 500)).toBe(0);
    expect(particleAlpha(9999, 500)).toBe(0);
  });

  it("never climbs back up", () => {
    let previous = Infinity;
    for (let age = 0; age <= 600; age += 7) {
      const a = particleAlpha(age, 500);
      expect(a).toBeLessThanOrEqual(previous + 1e-9);
      previous = a;
    }
  });

  it("gives nothing for a particle with no life", () => {
    expect(particleAlpha(0, 0)).toBe(0);
  });
});

describe("the pool", () => {
  it("never exceeds its cap however many arrive in one frame", () => {
    // The one thing a particle system must never do is turn a fast-forwarded
    // harvest loop into a slideshow.
    const pool = new ParticlePool(10);
    for (let i = 0; i < 50; i++) pool.add(harvestBurst({ x: i % 8, y: 3 }, 0xffffff));
    expect(pool.count).toBe(10);
  });

  it("kills the oldest first when it is over the cap", () => {
    const pool = new ParticlePool(2);
    pool.add([mote({ x: 1 }), mote({ x: 2 }), mote({ x: 3 })]);
    expect(pool.live.map((p) => p.x)).toEqual([2, 3]);
  });

  it("steps nothing when nothing was spawned", () => {
    const pool = new ParticlePool();
    pool.step(16);
    expect(pool.count).toBe(0);
  });

  it("drops particles as they expire", () => {
    const pool = new ParticlePool();
    pool.add(harvestBurst({ x: 2, y: 2 }, 0xffffff));
    expect(pool.count).toBe(EFFECTS.harvestMotes);
    for (let i = 0; i < 100; i++) pool.step(16);
    expect(pool.count).toBe(0);
  });
});

describe("the three bursts", () => {
  it("rings a placement evenly", () => {
    // Regular where a harvest is scattered: a thing landing, not a thing coming
    // apart. The ring is flattened on screen — dust lies on the ground — so the
    // vertical squash is undone here to measure the ring it is a squash of.
    const dust = placementDust({ x: 3, y: 3 }, 0xffffff);
    expect(dust).toHaveLength(EFFECTS.dustMotes);
    dust.forEach((p, i) => {
      const angle = Math.atan2(p.vy * 2, p.vx);
      const expected = (i / EFFECTS.dustMotes) * Math.PI * 2;
      const wrapped = ((expected + Math.PI) % (Math.PI * 2)) - Math.PI;
      expect(angle).toBeCloseTo(wrapped, 6);
    });
  });

  it("scatters a harvest unevenly", () => {
    const angles = harvestBurst({ x: 3, y: 3 }, 0xffffff)
      .map((p) => Math.atan2(p.vy, p.vx))
      .sort((a, b) => a - b);
    const gaps = angles.slice(1).map((v, i) => v - angles[i]!);
    // An even fan would have every gap the same; this wants the opposite.
    expect(Math.max(...gaps) / Math.min(...gaps)).toBeGreaterThan(1.5);
  });

  it("draws the same burst for the same tile every run", () => {
    // tileNoise rather than Math.random, so two runs of one world look alike.
    expect(harvestBurst({ x: 6, y: 9 }, 0xffffff)).toEqual(harvestBurst({ x: 6, y: 9 }, 0xffffff));
    expect(harvestBurst({ x: 6, y: 9 }, 0xffffff)).not.toEqual(
      harvestBurst({ x: 7, y: 9 }, 0xffffff),
    );
  });

  it("sends a deposit away from the bot and a withdrawal toward it", () => {
    const east = { x: 1, y: 0 };
    const out = transferMote({ x: 4, y: 4 }, east, 0xffffff, true);
    const back = transferMote({ x: 4, y: 4 }, east, 0xffffff, false);
    expect(out.vx).toBeGreaterThan(0);
    expect(back.vx).toBeLessThan(0);
    // And starts at the far end when it is coming back, so it crosses the gap
    // in both cases rather than starting where it means to end.
    expect(back.x).toBeGreaterThan(out.x);
  });

  it("starts every mote inside the tile it came from", () => {
    for (const p of [...harvestBurst({ x: 5, y: 5 }, 0), ...placementDust({ x: 5, y: 5 }, 0)]) {
      expect(p.x).toBeCloseTo(5.5, 6);
      expect(p.y).toBeCloseTo(5.5, 6);
    }
  });
});
