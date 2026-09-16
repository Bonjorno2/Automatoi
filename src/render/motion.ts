import { CROP_HEIGHT } from "./palette.ts";

/**
 * Wind: the cheapest way to make a static grid look alive.
 *
 * Decision 1 of the milestone 7 plan in one function. A swaying crop costs one
 * `rotation` write against a `Graphics` that already exists; a crop drawn with
 * three stalks and a shadow costs a rebuild of every crop sprite on a field of
 * up to 1024 of them. This module therefore spends the milestone's frame budget
 * on a transform and none of it on new geometry.
 *
 * Pure, with no Pixi import, so the thing that can be wrong in a way a test
 * catches — Fact 2, that a leaning crop must not read as a shorter one — is
 * checked rather than eyeballed.
 *
 * Real time, per Decision 4. A mark is feedback to a human and a human's eye
 * does not speed up at 4x; neither does weather.
 */

const TAU = Math.PI * 2;

export const WIND = {
  /**
   * Two periods in milliseconds, deliberately not multiples of one another.
   *
   * One sine is a field breathing in unison, which reads as a pulse rather than
   * as air. Two that never line up give a gust that arrives and passes.
   */
  periods: [2600, 4100] as const,
  /** How much of each, summing to one so the amplitude below is the real bound. */
  mix: [0.62, 0.38] as const,
  /**
   * Phase added per tile, in radians. This is what makes the wind a wave that
   * crosses the field rather than a field that moves as one body.
   *
   * More along x than y, so the gust has a direction. Not a whole fraction of
   * TAU per tile, or the wave would repeat on a short period and read as stripes.
   */
  phase: { x: 0.85, y: 0.31 },
  /**
   * Greatest lean, in radians, per crop stage.
   *
   * Falling with stage, which is Fact 2's own fix as well as the physical
   * answer: a heavy ripe head should move less than a young shoot, and less
   * lean at a taller stage is exactly the direction that keeps a leaning crop
   * from reading as a shorter upright one.
   */
  amplitude: [0.17, 0.14, 0.11, 0.08] as const,
} as const;

/**
 * How far a crop on this tile leans, right now, in radians.
 *
 * The crop sprites are anchored at the bottom-centre of their tile and drawn
 * relative to that, which is already the pivot a stalk rotates about — that is
 * why wind is one write per crop rather than a redraw.
 */
export function sway(x: number, y: number, nowMs: number, stage: number): number {
  // Not null: `clampStage` returns an index this table has.
  const amplitude = WIND.amplitude[clampStage(stage)]!;
  const phase = x * WIND.phase.x + y * WIND.phase.y;
  const a = Math.sin((nowMs / WIND.periods[0]) * TAU + phase);
  // A different phase slope as well as a different period, so the two waves
  // cross the field at different speeds instead of travelling locked together.
  const b = Math.sin((nowMs / WIND.periods[1]) * TAU + phase * 0.57);
  return amplitude * (a * WIND.mix[0] + b * WIND.mix[1]);
}

function clampStage(stage: number): number {
  const n = WIND.amplitude.length;
  return stage < 0 ? 0 : stage >= n ? n - 1 : Math.floor(stage);
}

/**
 * How tall a crop at this stage appears when it is leaning as far as it can.
 *
 * Fact 2 made checkable. A stalk of height `h` leaning by `t` stands `h·cos t`
 * high, and the thing that must never happen is that number dropping to what an
 * upright crop of the stage below already reads as.
 */
export function leanedHeight(stage: number): number {
  const s = clampStage(stage);
  return CROP_HEIGHT[s]! * Math.cos(WIND.amplitude[s]!);
}
