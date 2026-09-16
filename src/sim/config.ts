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
  /**
   * Building costs time, which is the only thing this milestone charges for it.
   *
   * It is deliberately *not* an answer to milestone 5's finding 5 — machines are
   * still free and unlimited, because a build cost needs a material to be
   * denominated in and every item in this game is food. What this does buy is
   * that a hundred-tile belt run is a real expense in a script's own budget.
   */
  place: 4,
  remove: 4,
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

/**
 * Machine kinds that have a front. A kind absent here has no facing and ignores
 * one offered to it.
 *
 * Partial for the same reason `CROP_GROWTH` is: only a kind that differs from
 * the default needs a row, and the absence is the rule rather than an omission.
 */
export const FACES: Partial<Record<MachineKind, true>> = { conveyor: true };

/**
 * How much of each item a kind holds, where it differs from `MACHINE_CAPACITY`.
 *
 * A belt holding sixteen wheat would be a crate with an arrow on it. Four is
 * enough to see a belt backing up and little enough that a line is a line rather
 * than a warehouse — a guess, and Task 9 measures whether it is a good one.
 */
export const CAPACITY: Partial<Record<MachineKind, number>> = { conveyor: 4 };

/** How much of each item this kind of machine can hold. */
export function capacityOf(kind: MachineKind): number {
  return CAPACITY[kind] ?? MACHINE_CAPACITY;
}

/**
 * Ticks between belt steps. Every belt in the world steps at once.
 *
 * A guess until Task 9 measures it against milestone 5's hand-hauled baseline.
 * The ratio that matters is not speed over a tile — a bot walks a tile in two
 * ticks and a belt moves one in four — but throughput over a whole round, and a
 * belt never walks back empty.
 */
export const CONVEYOR_TICKS = 4;

/**
 * Every item, in the order anything that has to choose one chooses.
 *
 * A belt holding both wheat and flour hands on exactly one item per step, and
 * which one cannot be left to whatever order the keys happen to be in: two
 * worlds built by the same script would diverge on a detail nobody chose.
 *
 * Derived from a `Record<Item, true>` rather than written as a list, so growing
 * `Item` is a compiler error here rather than an item that silently never moves.
 */
const EVERY_ITEM: Record<Item, true> = { wheat: true, flour: true, bread: true };
export const ITEMS: readonly Item[] = Object.keys(EVERY_ITEM) as Item[];

/** Wheat the console must consume to complete each research. */
export const RESEARCH_COST: Record<ResearchName, number> = {
  planter: 10,
  scanner: 10,
  crate: 15,
  mill: 20,
  oven: 25,
  conveyor: 5,
  chassis: 6,
  radio: 4,
  builder: 10,
  // The design holds `import` back until one file per bot is genuinely
  // miserable, so the library is priced past the second bot rather than beside
  // it: a player who has not yet wanted two scripts cannot buy the thing that
  // makes three bearable.
  library: 12,
  fabricator: 15,
};

/**
 * What the console eats for each research. Absent means wheat.
 *
 * This is the decision that makes the chain load-bearing rather than
 * decorative. The second bot — the thing the design's veteran playtest is meant
 * to time — costs bread, so reaching it *requires* building a mill, building an
 * oven, and hauling between them. A chain that fed an optional score would be a
 * side quest.
 *
 * The first three researches stay priced in raw wheat so that the opening ten
 * minutes, which milestone 3 measured and pinned, are untouched.
 *
 * Six bread is thirty-six wheat and four hundred and twenty ticks of machine
 * time. That is a guess; Task 9 measures it.
 */
export const RESEARCH_ITEM: Partial<Record<ResearchName, Item>> = {
  chassis: "bread",
  radio: "bread",
  // The belt is bought with what the chain makes. Priced in wheat it would be a
  // way to automate the chain without ever having run it.
  conveyor: "bread",
  // And the arm that lays belts by script costs twice what laying them by hand
  // does, because it is the second half of the same lesson rather than a
  // replacement for the first.
  builder: "bread",
  // Cycle 4 is bought with what cycle 3 produced.
  library: "bread",
  fabricator: "bread",
};

/** Chebyshev radius of the soil field around the console. */
export const FIELD_RADIUS = 6;
/** Probability a soil tile starts with mature wild wheat. */
export const WILD_WHEAT_CHANCE = 0.7;
