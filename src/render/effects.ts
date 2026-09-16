import { Container, Graphics } from "pixi.js";
import { DIR } from "../sim/world.ts";
import type { WorldEvent } from "../sim/events.ts";
import type { Vec, WorldSnapshot } from "../sim/types.ts";
import { toCentre, type Geometry } from "./geometry.ts";
import { ITEM_COLOR } from "./palette.ts";
import { tileNoise } from "./texture.ts";

/**
 * Particles: the small bright things that make an action feel like it happened.
 *
 * Decaying in real time, for the same reason `marks.ts` does — a human's eye
 * does not speed up at 4x, and a tick-timed burst at high speed is a flicker
 * nobody can read.
 *
 * Three sources, and only one of them is an event:
 *
 * - **Harvest** rides `WorldEvent`, because a taken crop leaves nothing behind
 *   and the only way to notice from outside is to diff two snapshots.
 * - **Placement** is a machine id this layer has not seen before, which is the
 *   same test `actors.ts` already uses to decide it needs a new sprite.
 * - **Transfer** is a bot whose `action` says `deposit` or `withdraw`. That is
 *   already in the snapshot, with its direction and how many ticks are left, so
 *   the mote can travel for exactly as long as the action does instead of being
 *   a puff at one end of it.
 *
 * Deriving the last two is not laziness about events; it is the rule this
 * project keeps returning to. A fact the sim already publishes should be read,
 * not restated, and an event for something already visible in the snapshot is a
 * second copy of it that can disagree.
 */

export const EFFECTS = {
  /**
   * The hard cap, and the reason this is a pool at all.
   *
   * The one thing a particle system must never do is turn a fast-forwarded
   * harvest loop into a slideshow. At 4x with a sweeping script, harvests
   * arrive several per second; over the cap the oldest die early.
   */
  cap: 180,
  /** Motes per harvest. */
  harvestMotes: 7,
  /** Motes in a placement's dust ring. */
  dustMotes: 9,
  life: { harvest: 620, dust: 520, transfer: 240 },
  /** Tiles per second, at spawn. Drag and gravity are applied per step. */
  speed: { harvest: 1.5, dust: 1.1 },
  /** Tiles per second squared. Positive is downward, which is how a mote falls back. */
  gravity: 2.6,
  /** Fraction of velocity kept per second. Dust slows; harvest motes fly. */
  drag: 0.12,
  /** Radius as a fraction of a tile. */
  radius: { harvest: 0.09, dust: 0.07, transfer: 0.11 },
} as const;

/**
 * One mote. Position and velocity are in **tile** units, not pixels.
 *
 * So a resize mid-flight moves them with the grid rather than stranding them,
 * which is the bug `marks.ts` had to fix by throwing everything away — and
 * these are too short-lived for that to have looked like anything but a
 * glitch.
 */
export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Milliseconds lived so far. */
  age: number;
  life: number;
  colour: number;
  radius: number;
}

/** Eased-out opacity. Full for the first fifth, then away — as `markAlpha` is. */
export function particleAlpha(age: number, life: number): number {
  if (life <= 0) return 0;
  const t = age / life;
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return t < 0.2 ? 1 : 1 - (t - 0.2) / 0.8;
}

/**
 * Advance one mote by `dtMs`, in place, and say whether it is still alive.
 *
 * Pure in the sense that matters: the same particle and the same step always
 * give the same result, and nothing here reads a clock or a global.
 */
export function stepParticle(p: Particle, dtMs: number): boolean {
  if (!(dtMs > 0)) return p.age < p.life;
  const dt = dtMs / 1000;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.vy += EFFECTS.gravity * dt;
  // Exponential drag, so the result does not depend on how the frame was split.
  const kept = Math.pow(EFFECTS.drag, dt);
  p.vx *= kept;
  p.vy *= kept;
  p.age += dtMs;
  return p.age < p.life;
}

/**
 * A deterministic angle and speed for mote `i` of a burst at `at`.
 *
 * `tileNoise` rather than `Math.random`, so two runs of the same world draw the
 * same burst — which is what makes "step is deterministic for the same inputs"
 * a property of the whole system and not only of `stepParticle`.
 */
function scatter(at: Vec, i: number, spread: number): { vx: number; vy: number } {
  const a = tileNoise(at.x * 31 + i, at.y * 17 + i * 7) * Math.PI * 2;
  const r = 0.55 + tileNoise(at.y * 13 + i * 3, at.x * 29 + i) * 0.45;
  return { vx: Math.cos(a) * spread * r, vy: Math.sin(a) * spread * r - spread * 0.4 };
}

/** A burst of crop-coloured motes drifting up out of a harvested tile. */
export function harvestBurst(at: Vec, colour: number): Particle[] {
  return Array.from({ length: EFFECTS.harvestMotes }, (_, i) => ({
    x: at.x + 0.5,
    y: at.y + 0.5,
    ...scatter(at, i, EFFECTS.speed.harvest),
    age: 0,
    life: EFFECTS.life.harvest,
    colour,
    radius: EFFECTS.radius.harvest,
  }));
}

/** A ring of dust thrown outward where a machine landed. */
export function placementDust(at: Vec, colour: number): Particle[] {
  return Array.from({ length: EFFECTS.dustMotes }, (_, i) => {
    const a = (i / EFFECTS.dustMotes) * Math.PI * 2;
    return {
      x: at.x + 0.5,
      y: at.y + 0.5,
      // A ring is deliberately regular where a harvest is scattered: one is a
      // thing landing and the other is a thing coming apart.
      vx: Math.cos(a) * EFFECTS.speed.dust,
      vy: Math.sin(a) * EFFECTS.speed.dust * 0.5,
      age: 0,
      life: EFFECTS.life.dust,
      colour,
      radius: EFFECTS.radius.dust,
    };
  });
}

/** One mote crossing the gap between a bot and the machine it is loading. */
export function transferMote(from: Vec, dir: Vec, colour: number, outward: boolean): Particle {
  const start = outward ? 0.5 : 1.3;
  const speed = (outward ? 1 : -1) * 3.4;
  return {
    x: from.x + 0.5 + dir.x * start,
    y: from.y + 0.5 + dir.y * start,
    vx: dir.x * speed,
    vy: dir.y * speed,
    age: 0,
    life: EFFECTS.life.transfer,
    colour,
    radius: EFFECTS.radius.transfer,
  };
}

/**
 * A fixed-capacity pool. Over the cap the oldest die early.
 *
 * An array with a cap rather than a ring buffer: the cap is small, the whole
 * list is walked every frame anyway, and a ring buffer would make "retire the
 * oldest" the subtlest code in the module for no measurable gain.
 */
export class ParticlePool {
  private readonly items: Particle[] = [];

  constructor(private readonly cap: number = EFFECTS.cap) {}

  get live(): readonly Particle[] {
    return this.items;
  }

  get count(): number {
    return this.items.length;
  }

  add(particles: readonly Particle[]): void {
    for (const p of particles) this.items.push(p);
    // Trimmed from the front, which is oldest-first because nothing reorders.
    if (this.items.length > this.cap) this.items.splice(0, this.items.length - this.cap);
  }

  step(dtMs: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      if (!stepParticle(this.items[i]!, dtMs)) this.items.splice(i, 1);
    }
  }
}

export interface EffectLayer {
  update(events: WorldEvent[], snapshot: WorldSnapshot, nowMs: number, geometry: Geometry): void;
}

/** Dust is the colour of what landed, muted toward the ground it landed on. */
const DUST_COLOR = 0xc8bda6;

export function createEffectLayer(parent: Container): EffectLayer {
  const layer = new Container();
  parent.addChild(layer);
  const g = new Graphics();
  layer.addChild(g);

  const pool = new ParticlePool();
  /** Machine ids already seen, so a placement is an id that is new. */
  const known = new Set<number>();
  /** Bot ids already spitting a mote for the transfer they are part-way through. */
  const transferring = new Set<number>();
  let first = true;
  let lastNow: number | null = null;

  return {
    update(events, snapshot, nowMs, geometry) {
      const dtMs = lastNow === null ? 0 : Math.min(nowMs - lastNow, 100);
      lastNow = nowMs;

      for (const event of events) {
        if (event.kind !== "harvest") continue;
        pool.add(harvestBurst(event.pos, ITEM_COLOR[event.item]));
      }

      // A machine id this layer has not seen. The first frame seeds the set
      // instead of spraying dust over every machine the world started with.
      for (const machine of snapshot.machines) {
        if (known.has(machine.id)) continue;
        known.add(machine.id);
        if (!first) pool.add(placementDust(machine.pos, DUST_COLOR));
      }
      for (const id of known) {
        if (!snapshot.machines.some((m) => m.id === id)) known.delete(id);
      }
      first = false;

      // One mote per transfer, at the moment it starts, travelling the way the
      // goods are going. The set is what keeps it to one rather than one a frame.
      const active = new Set<number>();
      for (const bot of snapshot.bots) {
        const action = bot.action;
        if (!action?.dir || (action.kind !== "deposit" && action.kind !== "withdraw")) continue;
        active.add(bot.id);
        if (transferring.has(bot.id)) continue;
        transferring.add(bot.id);
        const carried = Object.entries(bot.inventory).find(([, n]) => (n ?? 0) > 0);
        const colour = carried ? ITEM_COLOR[carried[0] as keyof typeof ITEM_COLOR] : DUST_COLOR;
        pool.add([transferMote(bot.pos, DIR[action.dir], colour, action.kind === "deposit")]);
      }
      for (const id of transferring) if (!active.has(id)) transferring.delete(id);

      pool.step(dtMs);

      g.clear();
      for (const p of pool.live) {
        const c = toCentre(geometry, { x: p.x - 0.5, y: p.y - 0.5 });
        g.circle(c.x, c.y, Math.max(0.5, p.radius * geometry.size)).fill({
          color: p.colour,
          alpha: particleAlpha(p.age, p.life),
        });
      }
    },
  };
}
