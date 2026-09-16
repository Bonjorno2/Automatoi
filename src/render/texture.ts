import type { Terrain } from "../sim/types.ts";
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
