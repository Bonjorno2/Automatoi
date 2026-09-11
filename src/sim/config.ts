import type { ResearchName } from "./types";

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
