import type { Item, ResearchName } from "./types";

/** Ticks each command takes before it resolves. */
export const TICK_COST = {
  move: 2,
  harvest: 3,
  plant: 3,
  scan: 1,
  deposit: 1,
  withdraw: 1,
  send: 1,
  receive: 1,
} as const;

/**
 * Ticks to maturity, per item. **An item absent from this table cannot be
 * planted at all**, which is the only rule that follows from there being more
 * than one item.
 *
 * It is a table rather than a constant for a reason worth keeping: when `Item`
 * grew from one member to three, the compiler demanded rows in every table
 * keyed by it and said nothing about `doPlant`, because plantability was a bare
 * constant with nothing keyed by `Item` to demand a row of.
 */
export const CROP_GROWTH: Partial<Record<Item, number>> = { wheat: 30 };

/** Kept as a named export: milestone 1-4 tests import it directly. */
export const WHEAT_GROWTH_TICKS = 30;

export const BOT_CAPACITY = 10;

/** Wheat the console must consume to complete each research. */
export const RESEARCH_COST: Record<ResearchName, number> = {
  planter: 10,
  scanner: 10,
  crate: 15,
  chassis: 25,
  radio: 20,
};

/** Chebyshev radius of the soil field around the console. */
export const FIELD_RADIUS = 6;
/** Probability a soil tile starts with mature wild wheat. */
export const WILD_WHEAT_CHANCE = 0.7;
