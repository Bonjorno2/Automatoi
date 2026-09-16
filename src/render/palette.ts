import { CROP_GROWTH, WHEAT_GROWTH_TICKS } from "../sim/config.ts";
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
 * Growing and ready, for items that grow. A crop lerps from `young` to `ripe`.
 *
 * **Partial, and that is the point.** Flour has no ripeness. When `Item` grew
 * past wheat this was a total `Record` and the compiler demanded a ripeness for
 * bread, which is how the split below got found.
 *
 * `young` is a brighter green than a seedling deserves, for contrast rather
 * than realism: a just-planted field is a grid of three-pixel marks on brown
 * soil, and the honest dark green it started as was invisible at tile sizes
 * the game actually renders at. A player who cannot see what they planted
 * cannot tell a planted field from a bare one.
 */
export const CROP: Partial<Record<Item, { young: number; ripe: number }>> = {
  wheat: { young: 0x74a047, ripe: 0xc8b84a },
};

/**
 * One colour per item, for an item as cargo or sitting on the ground — which
 * every item has, crop or not.
 */
export const ITEM_COLOR: Record<Item, number> = {
  wheat: 0xc8b84a,
  flour: 0xe8e0cc,
  bread: 0xb07038,
};

/**
 * One row per machine kind. Milestone 5's mill and oven are two more rows.
 */
export const MACHINE: Record<MachineKind, { body: number; trim: number }> = {
  console: { body: 0x3f6f8f, trim: 0x86c5e0 },
  crate: { body: 0x8a6a3a, trim: 0xc9a76a },
  mill: { body: 0x7a6a52, trim: 0xe8e0cc },
  oven: { body: 0x8a4a38, trim: 0xf0a860 },
  // Darker than anything else on the field, because a belt is floor: it has to
  // read as something the eye passes over on the way to what it feeds.
  conveyor: { body: 0x3e4038, trim: 0x8e9484 },
};

/** One row per chassis module, for the pips along a bot's edge. */
export const MODULE: Record<ModuleName, number> = {
  harvester: 0xd8703c,
  planter: 0x6fbf5a,
  scanner: 0x5aa8d8,
  radio: 0xc07fd0,
};

/**
 * One body colour per bot, in the order they were deployed.
 *
 * Milestone 4's finding 6, re-recorded as milestone 5's: two bots on the canvas
 * were distinguishable only by the selection ring, which answers "which one am
 * I editing" and not "which one is that". This is the cheap half of the answer.
 * The design's Overseer fleet view is the rest of it.
 *
 * **Indexed by position in the world's bot list, not by bot id.** Ids are shared
 * with machines: place three crates before deploying and the second bot is id 6,
 * which collides with bot 1 under any modulo of the id. The price is that
 * colours would shift if a bot were ever removed, which nothing can do today.
 *
 * The first entry is the bot gold from milestone 4, so the bot a player has been
 * watching for two milestones does not change colour under them.
 */
export const BOT_BODY: readonly number[] = [
  0xe0c060, // gold
  0x58c8b0, // teal
  0xc888e0, // violet
  0xe08a58, // amber
  0x7fb0f0, // ice
];

/** What an idle body is mixed toward, and how far. */
const IDLE_SHADE = 0x0a0c08;
const IDLE_MIX = 0.42;

/**
 * A bot's body colour: which bot it is, and whether it is doing anything.
 *
 * Brightness carried busy-or-idle before this table existed and still does. What
 * changed is that dimming now happens per bot rather than to one shared grey, so
 * an idle teal bot is still visibly the teal one.
 */
export function botColor(index: number, active: boolean): number {
  const n = BOT_BODY.length;
  const base = BOT_BODY[((index % n) + n) % n]!;
  return active ? base : lerpColor(base, IDLE_SHADE, IDLE_MIX);
}

/**
 * Below this tile size the id is not drawn at all.
 *
 * Measured rather than guessed, the same way the crop `young` colour was: the
 * pane renders at 7 pixels per tile when the browser window is narrow and 20 at
 * a 1600x900 one. A bot body is two thirds of a tile, so at 7 a digit is a
 * smudge that costs contrast and says nothing. Colour works at every size; the
 * number is what larger windows buy.
 */
export const MIN_ID_SIZE = 14;

export const COLOR = {
  botOutline: 0x141409,
  /** The arc a machine draws while it is working on something. */
  progress: 0x9be06a,
  /** The same arc when the machine wants input it does not have. */
  starved: 0xd8a03c,
  /** And when it has output it cannot put down. Starved's opposite, and read as its pair. */
  jammed: 0xe0584a,
  selection: 0xf0f0e0,
} as const;

/** Height of a crop as a fraction of its tile, indexed by stage. */
export const CROP_HEIGHT = [0.26, 0.45, 0.63, 0.8] as const;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

/** How far along a crop is, in [0, 1]. */
const ripeness = (item: Item, growth: number): number =>
  clamp01(growth / (CROP_GROWTH[item] ?? WHEAT_GROWTH_TICKS));

/**
 * Four buckets, because geometry has to change in steps to be noticed at all —
 * a shoot one pixel taller than last tick reads as nothing.
 */
export function cropStage(growth: number, item: Item = "wheat"): 0 | 1 | 2 | 3 {
  const s = Math.min(3, Math.floor(ripeness(item, growth) * 4));
  return s as 0 | 1 | 2 | 3;
}

/**
 * Colour is continuous where height is stepped. Together they mean a field
 * planted in one pass ripens as a visible wave rather than four simultaneous
 * jumps, which is the thing that makes the planter feel like an investment.
 */
export function cropColor(item: Item, growth: number): number {
  const crop = CROP[item];
  // An item that does not grow has one colour, which is the honest answer for
  // anything that somehow ends up drawn on a tile without being a crop.
  if (!crop) return ITEM_COLOR[item];
  return lerpColor(crop.young, crop.ripe, ripeness(item, growth));
}

/** Component-wise lerp between two 0xRRGGBB values. */
export function lerpColor(from: number, to: number, t: number): number {
  const k = clamp01(t);
  const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * k);
  const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * k);
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * k);
  return (r << 16) | (g << 8) | b;
}
