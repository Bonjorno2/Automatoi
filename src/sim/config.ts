import type { Item, MachineKind, ResearchName } from "./types";

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

/**
 * One input stack, one output stack, a duration. A property of a machine
 * *kind*, not of a machine.
 *
 * Deliberately single-input: multi-ingredient recipes are a whole system and
 * none of what this milestone proves needs one. A machine kind absent from this
 * table does not convert anything, which is how the console and the crate stay
 * untouched by the conversion step.
 */
export interface Recipe {
  input: Partial<Record<Item, number>>;
  output: Partial<Record<Item, number>>;
  ticks: number;
}

export const RECIPE: Partial<Record<MachineKind, Recipe>> = {
  mill: { input: { wheat: 3 }, output: { flour: 1 }, ticks: 20 },
  oven: { input: { flour: 2 }, output: { bread: 1 }, ticks: 30 },
};

/**
 * How much of **each item** a machine can hold. Per item type, not in total.
 *
 * The distinction is the whole reason a jam can happen at all, and it was found
 * by a test rather than by thinking. Under a shared total capacity, a machine
 * running `3 wheat -> 1 flour` always ends a conversion holding *fewer* items
 * than it started with, so it can never run out of room for its own output —
 * every recipe in this game is net-negative in item count, which made jamming
 * mathematically unreachable and Decision 4 of the plan unjustifiable.
 *
 * Per-item, a mill that nobody collects from fills up with flour while its
 * wheat keeps arriving, which is exactly the Factorio experience of a furnace
 * backing up. It also replaces the invented CRATE_DISPLAY_FULL the renderer was
 * guessing with (milestone 4 finding 5).
 *
 * 16 is a guess: that is 16 uncollected flour, or about 48 wheat delivered and
 * forgotten. Task 9 measures whether it is the right guess.
 */
export const MACHINE_CAPACITY = 16;

/** Wheat the console must consume to complete each research. */
export const RESEARCH_COST: Record<ResearchName, number> = {
  planter: 10,
  scanner: 10,
  crate: 15,
  mill: 20,
  oven: 25,
  chassis: 25,
  radio: 20,
};

/** Chebyshev radius of the soil field around the console. */
export const FIELD_RADIUS = 6;
/** Probability a soil tile starts with mature wild wheat. */
export const WILD_WHEAT_CHANCE = 0.7;
