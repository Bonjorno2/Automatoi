import { Container, Graphics } from "pixi.js";
import { DIR } from "../sim/world.ts";
import { total } from "../sim/inventory.ts";
import type { MachineSnapshot, WorldSnapshot } from "../sim/types.ts";
import { toPixel, type Geometry } from "./geometry.ts";
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

interface BeltSprite {
  root: Container;
  tread: Graphics;
  mask: Graphics;
  /** Whether it was last drawn as carrying something. */
  loaded: boolean;
}

export function createAnimatedLayer(layer: Container, geometry: Geometry): AnimatedLayer {
  let geo = geometry;
  const belts = new Map<number, BeltSprite>();

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

  return {
    update(snapshot, nowMs) {
      const seen = new Set<number>();
      for (const machine of snapshot.machines) {
        if (machine.kind !== "conveyor") continue;
        seen.add(machine.id);
        let sprite = belts.get(machine.id);
        if (!sprite) {
          sprite = build(machine);
          belts.set(machine.id, sprite);
        }
        drawTread(sprite, machine, nowMs);
      }
      for (const [id, sprite] of belts) {
        if (seen.has(id)) continue;
        sprite.root.destroy({ children: true });
        belts.delete(id);
      }
    },
    resize(next) {
      geo = next;
      // Every sprite is positioned and drawn in pixels, so a new fit invalidates
      // all of it. The same reasoning, and the same cheapness, as `actors.ts`.
      for (const [, sprite] of belts) sprite.root.destroy({ children: true });
      belts.clear();
    },
  };
}
