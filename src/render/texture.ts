import type { Terrain } from "../sim/types.ts";
import type { Size } from "./geometry.ts";
import { TERRAIN, lerpColor } from "./palette.ts";

/**
 * Grain: what makes a tile look like ground rather than like a cell.
 *
 * Pure functions over a tile coordinate, with no Pixi import, for the same
 * reason `geometry.ts` is a module of its own — this is arithmetic that can be
 * wrong in a way a test can catch, and the drawing around it is not.
 *
 * Nothing here is random. A hash of the coordinate means the same tile is the
 * same shade on every run, across a resize, and after a reload, which matters
 * more than it sounds: a player learns the shape of their field, and a field
 * that reshuffles itself whenever the window changes is noise wearing the
 * costume of texture.
 */

/**
 * A stable 32-bit hash of a tile coordinate.
 *
 * `Math.imul` throughout, because plain `*` on values this size silently leaves
 * the range where integers are exact and the "hash" becomes a smooth ramp with
 * visible banding across the field.
 */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** The same hash as a fraction in [0, 1). */
export function tileNoise(x: number, y: number): number {
  return tileHash(x, y) / 0x100000000;
}

/**
 * How far a tile may stray from its terrain's base colour, per channel.
 *
 * **Not inherited from the checkerboard's lift, and that is a decision.**
 * `palette.ts` lifts grass about half as far as soil because an equal RGB step
 * does not land as an equal step to the eye, and because at a larger delta "the
 * grass read as a loud tiling pattern that pulled attention off the crops".
 * That second reason is about a *pattern*: two values alternating on a grid is
 * legible as a grid however small the step is, so the step had to be tiny.
 *
 * Grain has no pattern to be loud with, so it can afford an amplitude that is
 * actually visible — inheriting the checkerboard's bound instead yielded eleven
 * shades across the whole field, of which about four were distinguishable.
 * Soil carries more than grass because it is the worked ground the player is
 * looking at, and because a brown tolerates it better than a green does.
 */
export const GRAIN: Record<Terrain, number> = {
  grass: 6,
  soil: 9,
};

/**
 * The shade one tile of ground is drawn in.
 *
 * This replaces milestone 4's checkerboard, which was honest — it stopped a
 * field reading as one flat rectangle — and was also the flattest thing on the
 * screen, because two values in a regular pattern read as a pattern.
 *
 * A value shift, applied equally to all three channels, rather than three
 * independent ones: ground varies in how much light it catches, and jittering
 * the channels apart at this amplitude tints tiles faintly pink and green and
 * reads as dirt on the screen rather than dirt in the world.
 *
 * Bounded by construction, which is the property worth testing: no hash value
 * can push a tile further than `GRAIN`, so no tile can come out as a bright
 * speck in a dark field.
 */
export function groundShade(terrain: Terrain, x: number, y: number): number {
  const shift = Math.round((tileNoise(x, y) * 2 - 1) * GRAIN[terrain]);
  return shiftValue(TERRAIN[terrain].base, shift);
}

/** A colour moved `by` on every channel, clamped. */
function shiftValue(colour: number, by: number): number {
  const ch = (at: number): number => {
    const v = ((colour >> at) & 0xff) + by;
    return v < 0 ? 0 : v > 255 ? 255 : v;
  };
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** Which sides of a tile face ground of a different kind. */
export interface Rim {
  north: boolean;
  south: boolean;
  east: boolean;
  west: boolean;
}

const NO_RIM: Rim = { north: false, south: false, east: false, west: false };

/**
 * The boundary of the worked field.
 *
 * Soil is a rectangle of a different colour, which reads as a stain rather than
 * as a place someone cleared. A darker line on the sides that face grass is the
 * cheapest thing that turns it into an edge.
 *
 * Only soil carries one: the rim belongs to the field, and drawing it from both
 * sides would double every line and darken the seam twice.
 *
 * Computed from the snapshot's own tiles, so it cannot disagree with what is
 * drawn. Out of bounds counts as the same terrain — a field that ran to the edge
 * of the world would get no rim there, which is right, because there is nothing
 * on the other side of it to be a boundary with.
 */
export function fieldRim(
  tiles: readonly { terrain: Terrain }[],
  width: number,
  height: number,
  x: number,
  y: number,
): Rim {
  const at = (tx: number, ty: number): Terrain | undefined =>
    tx < 0 || ty < 0 || tx >= width || ty >= height ? undefined : tiles[ty * width + tx]?.terrain;

  const self = at(x, y);
  if (self !== "soil") return NO_RIM;
  const differs = (tx: number, ty: number): boolean => {
    const other = at(tx, ty);
    return other !== undefined && other !== self;
  };
  return {
    north: differs(x, y - 1),
    south: differs(x, y + 1),
    east: differs(x + 1, y),
    west: differs(x - 1, y),
  };
}

/** How far the rim is darkened from the soil it edges. */
const RIM_DARKEN = 0.38;

/** The colour of that boundary line. */
export const RIM_COLOR = lerpColor(TERRAIN.soil.base, 0x000000, RIM_DARKEN);

/** Thickness of the rim, as a fraction of a tile. */
export const RIM_WIDTH = 0.14;

/**
 * One ellipse of a shadow. A stack of them fakes softness.
 *
 * Pixi can blur, and a blur filter is a render target and a shader pass per
 * sprite. Three ellipses of falling alpha cost one `Graphics` drawn once and
 * look the same at the sizes this game renders at. That is the whole trick.
 */
export interface ShadowRing {
  /** Half-width and half-height, in pixels. */
  rx: number;
  ry: number;
  /** How far below the sprite's centre this sits. */
  y: number;
  alpha: number;
}

export const SHADOW = {
  color: 0x000000,
  /** Darkest alpha, at the middle of the stack. */
  alpha: 0.3,
  /** Half-width of the innermost ellipse, as a fraction of the tile. */
  rx: 0.36,
  /** Ellipses are flat: this is a shadow on the ground, seen from above and in front. */
  flatten: 0.42,
  /** How far below centre the shadow sits, as a fraction of the tile. */
  drop: 0.3,
  rings: 3,
  /** How much larger and fainter each ring beyond the first is. */
  spread: 0.26,
} as const;

/**
 * The ellipses that make up one shadow, largest and faintest first.
 *
 * `width` is the sprite's own width as a fraction of its tile, so a crate's
 * shadow is a crate's width rather than every machine sharing one.
 */
export function shadowRings(size: number, width: number): ShadowRing[] {
  const rings: ShadowRing[] = [];
  for (let i = SHADOW.rings - 1; i >= 0; i--) {
    const scale = 1 + i * SHADOW.spread;
    const rx = size * SHADOW.rx * width * scale;
    rings.push({
      rx,
      ry: rx * SHADOW.flatten,
      y: size * SHADOW.drop,
      alpha: SHADOW.alpha / (i + 1),
    });
  }
  return rings;
}

/** One rectangle of the vignette. Screen space: these frame the pane, not the grid. */
export interface VignetteBand {
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
}

export const VIGNETTE = {
  color: 0x05060a,
  /** How far in from the edge the darkening reaches, as a fraction of the pane's short side. */
  reach: 0.34,
  /**
   * Alpha at the very edge.
   *
   * Tuned by looking, not chosen: 0.4 over a 0.4 reach read as a dark frame
   * around the canvas rather than as light falling off, which is the thing the
   * plan warned this task is easiest to overdo. Switching it off is the test —
   * at this value the grass loses its depth when it goes, and nothing about the
   * corners announces itself while it is on.
   */
  strength: 0.26,
  /** Rings. More is smoother and costs only build time, since this is drawn once. */
  steps: 24,
} as const;

/**
 * A frame of nested rings, darkest at the pane's edge and gone by `reach` in.
 *
 * Rings rather than stacked full rectangles, so the alpha at a given depth is
 * that ring's alpha rather than a sum — which makes the falloff something this
 * function decides and a test can read, instead of an accident of how many
 * shapes happened to overlap.
 *
 * Per Decision 7 this is screen space. It frames the pane, and Task 7's camera
 * must not slide it off the corner of the screen.
 */
export function vignetteBands(pane: Size): VignetteBand[] {
  const short = Math.min(pane.width, pane.height);
  if (short <= 0) return [];
  const step = (short * VIGNETTE.reach) / VIGNETTE.steps;
  const bands: VignetteBand[] = [];

  for (let i = 0; i < VIGNETTE.steps; i++) {
    const inset = i * step;
    const w = pane.width - inset * 2;
    const h = pane.height - inset * 2;
    if (w <= 0 || h <= 0) break;
    // Quadratic, because a linear ramp reads as a grey border with an edge to it.
    const t = 1 - i / VIGNETTE.steps;
    const alpha = VIGNETTE.strength * t * t;
    const side = Math.max(0, h - step * 2);
    bands.push({ x: inset, y: inset, width: w, height: Math.min(step, h), alpha });
    if (h > step) {
      bands.push({ x: inset, y: inset + h - step, width: w, height: step, alpha });
    }
    if (side > 0) {
      bands.push({ x: inset, y: inset + step, width: Math.min(step, w), height: side, alpha });
      if (w > step) {
        bands.push({ x: inset + w - step, y: inset + step, width: step, height: side, alpha });
      }
    }
  }
  return bands;
}
