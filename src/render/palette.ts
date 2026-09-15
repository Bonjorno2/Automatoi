import { WHEAT_GROWTH_TICKS } from "../sim/config.ts";
import type { Item, MachineKind, ModuleName, Terrain } from "../sim/types.ts";

/**
 * Every colour in the game, and the arithmetic that picks between them.
 *
 * Per Decision 7 of the milestone 4 plan, anything keyed by a sim union is a
 * `Record` over that union rather than a chain of comparisons. The world has
 * one item today; milestone 5 adds flour and bread, and a `Record<Item, …>`
 * turns each of those into a row the compiler demands rather than a branch
 * somebody has to remember to write.
 */

/**
 * Two shades per terrain: the checkerboard is what stops a field reading as one
 * flat rectangle.
 *
 * The lifts are not equal, and that is deliberate rather than sloppy. An equal
 * RGB step on grass and on soil does not land as an equal step to the eye — the
 * first render used the same delta for both and the grass read as a loud tiling
 * pattern that pulled attention off the crops while the soil read as barely
 * textured. Grass is therefore lifted about half as far.
 */
export const TERRAIN: Record<Terrain, { base: number; alt: number }> = {
  grass: { base: 0x2f3a26, alt: 0x323d28 },
  soil: { base: 0x4a3a2a, alt: 0x51402f },
};

/**
 * Growing and ready. A crop lerps from `young` to `ripe` as it grows.
 *
 * `young` is a brighter green than a seedling deserves, for contrast rather
 * than realism: a just-planted field is a grid of three-pixel marks on brown
 * soil, and the honest dark green it started as was invisible at tile sizes
 * the game actually renders at. A player who cannot see what they planted
 * cannot tell a planted field from a bare one.
 */
export const ITEM: Record<Item, { young: number; ripe: number }> = {
  wheat: { young: 0x74a047, ripe: 0xc8b84a },
};

/**
 * One row per machine kind. Milestone 5's mill and oven are two more rows.
 */
export const MACHINE: Record<MachineKind, { body: number; trim: number }> = {
  console: { body: 0x3f6f8f, trim: 0x86c5e0 },
  crate: { body: 0x8a6a3a, trim: 0xc9a76a },
};

/** One row per chassis module, for the pips along a bot's edge. */
export const MODULE: Record<ModuleName, number> = {
  harvester: 0xd8703c,
  planter: 0x6fbf5a,
  scanner: 0x5aa8d8,
  radio: 0xc07fd0,
};

export const COLOR = {
  bot: 0xe0c060,
  botIdle: 0x8d8055,
  botOutline: 0x141409,
  /** The arc a machine draws while it is working on something. */
  progress: 0x9be06a,
  /** The same arc when the machine wants input it does not have. */
  starved: 0xd8a03c,
  selection: 0xf0f0e0,
} as const;

/** Height of a crop as a fraction of its tile, indexed by stage. */
export const CROP_HEIGHT = [0.26, 0.45, 0.63, 0.8] as const;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** How far along a crop is, in [0, 1]. */
const ripeness = (growth: number): number => clamp01(growth / WHEAT_GROWTH_TICKS);

/**
 * Four buckets, because geometry has to change in steps to be noticed at all —
 * a shoot one pixel taller than last tick reads as nothing.
 */
export function cropStage(growth: number): 0 | 1 | 2 | 3 {
  const s = Math.min(3, Math.floor(ripeness(growth) * 4));
  return s as 0 | 1 | 2 | 3;
}

/**
 * Colour is continuous where height is stepped. Together they mean a field
 * planted in one pass ripens as a visible wave rather than four simultaneous
 * jumps, which is the thing that makes the planter feel like an investment.
 */
export function cropColor(item: Item, growth: number): number {
  const { young, ripe } = ITEM[item];
  return lerpColor(young, ripe, ripeness(growth));
}

/** Component-wise lerp between two 0xRRGGBB values. */
export function lerpColor(from: number, to: number, t: number): number {
  const k = clamp01(t);
  const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * k);
  const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * k);
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * k);
  return (r << 16) | (g << 8) | b;
}
