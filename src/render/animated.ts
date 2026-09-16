import { Container, Graphics } from "pixi.js";
import { DIR } from "../sim/world.ts";
import { total } from "../sim/inventory.ts";
import type { MachineKind, MachineSnapshot, WorldSnapshot } from "../sim/types.ts";
import { toCentre, toPixel, type Geometry } from "./geometry.ts";
import { MACHINE } from "./palette.ts";

/**
 * The one layer that genuinely redraws per frame.
 *
 * Decision 2 says animation rides on a transform wherever a transform will do,
 * and the belt tread is the exception it names: a scrolling pattern clipped to
 * a tile is not something `rotation` or `alpha` can express. It is affordable
 * because it is bounded by the number of conveyors, which is tens — milestone 6
 * measured 65 loaded belts at 0.015 ms a frame to draw at all.
 *
 * Per Decision 3 the tread says nothing the arrow does not already say. A player
 * who screenshots the game, or who is looking at the editor when something
 * happens, loses nothing: the arrow gives the facing and the pips give the
 * cargo, both drawn by `actors.ts` and both still there.
 *
 * Per Decision 4 it runs on the wall clock. **At 4x the belts do not visibly run
 * four times faster**, and that is deliberate rather than an oversight: tread
 * speed says "this is a belt", not "this is how fast the belt is going".
 * Milestone 6's Decision 5 made items on a belt a count rather than positions,
 * so there is no rate here for the tread to be honest about in the first place.
 */
export interface AnimatedLayer {
  /** Sync sprites to the world, then draw this instant of it. */
  update(snapshot: WorldSnapshot, nowMs: number): void;
  resize(geometry: Geometry): void;
}

export const TREAD = {
  /** Distance between chevrons, as a fraction of a tile. */
  spacing: 0.5,
  /** Tiles per second the pattern scrolls. Decoration; see Decision 4 above. */
  speed: 0.9,
  /** How far back the arms of a chevron sweep, as a fraction of a tile. */
  depth: 0.16,
  /** Half the width of a chevron, as a fraction of a tile. */
  reach: 0.26,
  /** A belt with cargo scrolls at full contrast; an empty one is dimmer. */
  alpha: { loaded: 0.45, empty: 0.2 },
} as const;

/**
 * How far the chevron pattern has slid, in pixels, within one spacing.
 *
 * Pure and tested: the drawing around it is not. Wrapped into `[0, spacing)` so
 * the pattern is seamless — a tread that grew without bound would eventually
 * lose precision and stutter, and one that reset to zero would visibly jump.
 */
export function treadOffset(nowMs: number, size: number): number {
  const spacing = size * TREAD.spacing;
  if (!(spacing > 0) || !Number.isFinite(nowMs)) return 0;
  const travelled = (nowMs / 1000) * TREAD.speed * size;
  return ((travelled % spacing) + spacing) % spacing;
}

/**
 * What a machine that is doing something looks like.
 *
 * All three of these are one write per frame against a `Graphics` drawn once —
 * `rotation` for the mill, `alpha` for the other two — which is Decision 2 kept
 * rather than bent. Only the belt tread genuinely redraws.
 *
 * All three are also **strictly decoration**, per Decision 3. The progress arc
 * `actors.ts` draws is what actually says a machine is working, and it is still
 * there; a screenshot loses a flicker and loses no fact. The identity of each
 * machine — the mill's stones, the oven's mouth, the console's screen — stays in
 * `MachineStyle.body` where it is drawn once and cannot go missing.
 */
export const WORKING = {
  /** Turns per second of the mill's grind. */
  millTurns: 0.42,
  /**
   * Largest frame gap that still advances the grind.
   *
   * The spin accumulates rather than being read off the wall clock, so that
   * stopping and restarting does not jump. Accumulating means a backgrounded
   * tab returning after ten seconds would otherwise spin the stones a hundred
   * times in one frame.
   */
  maxStepMs: 100,
  /** The oven's flicker: two fast periods that never line up, and a floor. */
  ovenPeriods: [170, 290] as const,
  ovenAlpha: { min: 0.22, max: 0.62 },
  /** The console's pulse while research is queued. Slow: it is a thing to notice, not a warning. */
  consolePeriod: 1900,
  consoleAlpha: { min: 0.05, max: 0.4 },
} as const;

/** How far the mill's stones turn in one frame. Clamped, and never backwards. */
export function spinStep(dtMs: number): number {
  if (!Number.isFinite(dtMs) || dtMs <= 0) return 0;
  const dt = Math.min(dtMs, WORKING.maxStepMs);
  return (dt / 1000) * WORKING.millTurns * Math.PI * 2;
}

/** The oven's glow, in [ovenAlpha.min, ovenAlpha.max]. Never dark: a lit oven stays lit. */
export function ovenGlow(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return WORKING.ovenAlpha.min;
  const [p, q] = WORKING.ovenPeriods;
  const wave = 0.6 * Math.sin((nowMs / p) * Math.PI * 2) + 0.4 * Math.sin((nowMs / q) * Math.PI * 2);
  const { min, max } = WORKING.ovenAlpha;
  return min + ((wave + 1) / 2) * (max - min);
}

/** The console's pulse, in [consoleAlpha.min, consoleAlpha.max]. */
export function consolePulse(nowMs: number): number {
  if (!Number.isFinite(nowMs)) return WORKING.consoleAlpha.min;
  const wave = Math.sin((nowMs / WORKING.consolePeriod) * Math.PI * 2);
  const { min, max } = WORKING.consoleAlpha;
  return min + ((wave + 1) / 2) * (max - min);
}

interface BeltSprite {
  root: Container;
  tread: Graphics;
  mask: Graphics;
  /** Whether it was last drawn as carrying something. */
  loaded: boolean;
}

/** A machine whose busy-ness is drawn as movement. */
interface WorkSprite {
  g: Graphics;
  /** Accumulated radians, for the mill. Held so a stop and start does not jump. */
  spin: number;
}

/**
 * The moving part of each machine that has one, drawn once into its own
 * `Graphics` at the tile's centre.
 *
 * A machine kind absent from this table has nothing that moves.
 */
const WORK_PART: Partial<Record<MachineKind, (g: Graphics, size: number) => void>> = {
  mill: (g, size) => {
    // Spokes over the stones that `body` already drew, rather than the stones
    // themselves. The plan said "the mill's stones rotate"; moving them here
    // would put the thing that says *this is a mill* in a layer that is only
    // drawn while it happens to be working.
    const s = size * 0.84;
    const r = s * 0.2;
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      g.moveTo(0, 0).lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.stroke({ width: Math.max(1, size * 0.045), color: MACHINE.mill.body, cap: "round" });
  },
  oven: (g, size) => {
    // Over the mouth `body` drew, in the same place and a little larger.
    const s = size * 0.84;
    g.roundRect(-s * 0.26, -s * 0.05, s * 0.52, s * 0.3, s * 0.06).fill(MACHINE.oven.trim);
  },
  console: (g, size) => {
    const s = size * 0.86;
    g.rect(-s * 0.28, -s * 0.3, s * 0.56, s * 0.34).fill(MACHINE.console.trim);
  },
};

export function createAnimatedLayer(layer: Container, geometry: Geometry): AnimatedLayer {
  let geo = geometry;
  const belts = new Map<number, BeltSprite>();
  const working = new Map<number, WorkSprite>();
  /** Previous frame's instant, for the mill's accumulated spin. */
  let lastNow: number | null = null;

  function build(machine: MachineSnapshot): BeltSprite {
    const root = new Container();
    const tread = new Graphics();
    // A mask rather than skipping chevrons that would cross the edge: a belt at
    // the end of a run must not spill onto the tile beyond it, and dropping
    // whole chevrons instead would make them blink in and out at every border.
    const mask = new Graphics().rect(0, 0, geo.size, geo.size).fill(0xffffff);
    root.addChild(tread, mask);
    tread.mask = mask;
    const p = toPixel(geo, machine.pos);
    root.position.set(p.x, p.y);
    layer.addChild(root);
    return { root, tread, mask, loaded: false };
  }

  /**
   * Chevrons along the facing axis, in tile-local pixels.
   *
   * Drawn from one before the tile's start to one past its end, so the mask
   * always has a whole pattern to cut rather than an edge to reveal.
   */
  function drawTread(sprite: BeltSprite, machine: MachineSnapshot, nowMs: number): void {
    const size = geo.size;
    const v = DIR[machine.dir ?? "north"];
    const across = { x: -v.y, y: v.x };
    const spacing = size * TREAD.spacing;
    const offset = treadOffset(nowMs, size);
    const depth = size * TREAD.depth;
    const reach = size * TREAD.reach;
    const loaded = total(machine.inventory) > 0;

    const g = sprite.tread;
    g.clear();
    // Measured from the tile's centre, then shifted into the tile's own box.
    const half = size / 2;
    for (let along = -half - spacing + offset; along <= half + spacing; along += spacing) {
      const tipX = half + v.x * along;
      const tipY = half + v.y * along;
      const backX = tipX - v.x * depth;
      const backY = tipY - v.y * depth;
      g.moveTo(backX + across.x * reach, backY + across.y * reach)
        .lineTo(tipX, tipY)
        .lineTo(backX - across.x * reach, backY - across.y * reach);
    }
    g.stroke({
      width: Math.max(1, size * 0.07),
      color: MACHINE.conveyor.trim,
      alpha: loaded ? TREAD.alpha.loaded : TREAD.alpha.empty,
      cap: "round",
      join: "round",
    });
    sprite.loaded = loaded;
  }

  /**
   * Whether this machine is doing something, and how hard it is to say so.
   *
   * The console is the exception: it has no `progress` of its own, and what a
   * player looks at it to decide is whether research is running. Everything else
   * reads `progress`, which the snapshot already carries.
   */
  function busy(machine: MachineSnapshot, snapshot: WorldSnapshot): boolean {
    if (machine.kind === "console") return snapshot.research.queue.length > 0;
    return machine.progress > 0;
  }

  function syncWorking(snapshot: WorldSnapshot, nowMs: number, dtMs: number): Set<number> {
    const seen = new Set<number>();
    for (const machine of snapshot.machines) {
      const part = WORK_PART[machine.kind];
      if (!part) continue;
      seen.add(machine.id);

      let sprite = working.get(machine.id);
      if (!sprite) {
        const g = new Graphics();
        part(g, geo.size);
        const c = toCentre(geo, machine.pos);
        g.position.set(c.x, c.y);
        layer.addChild(g);
        sprite = { g, spin: 0 };
        working.set(machine.id, sprite);
      }

      const on = busy(machine, snapshot);
      // Stops dead, per the plan: a machine that looks busy while idle is a lie,
      // and the arc beside it would be saying the opposite.
      sprite.g.visible = on;
      if (!on) continue;

      if (machine.kind === "mill") {
        sprite.spin += spinStep(dtMs);
        sprite.g.rotation = sprite.spin;
      } else if (machine.kind === "oven") {
        sprite.g.alpha = ovenGlow(nowMs);
      } else {
        sprite.g.alpha = consolePulse(nowMs);
      }
    }
    return seen;
  }

  return {
    update(snapshot, nowMs) {
      const dtMs = lastNow === null ? 0 : nowMs - lastNow;
      lastNow = nowMs;

      const seenBelts = new Set<number>();
      for (const machine of snapshot.machines) {
        if (machine.kind !== "conveyor") continue;
        seenBelts.add(machine.id);
        let sprite = belts.get(machine.id);
        if (!sprite) {
          sprite = build(machine);
          belts.set(machine.id, sprite);
        }
        drawTread(sprite, machine, nowMs);
      }
      for (const [id, sprite] of belts) {
        if (seenBelts.has(id)) continue;
        sprite.root.destroy({ children: true });
        belts.delete(id);
      }

      const seenWorking = syncWorking(snapshot, nowMs, dtMs);
      for (const [id, sprite] of working) {
        if (seenWorking.has(id)) continue;
        sprite.g.destroy();
        working.delete(id);
      }
    },
    resize(next) {
      geo = next;
      // Every sprite is positioned and drawn in pixels, so a new fit invalidates
      // all of it. The same reasoning, and the same cheapness, as `actors.ts`.
      for (const [, sprite] of belts) sprite.root.destroy({ children: true });
      for (const [, sprite] of working) sprite.g.destroy();
      belts.clear();
      working.clear();
    },
  };
}
